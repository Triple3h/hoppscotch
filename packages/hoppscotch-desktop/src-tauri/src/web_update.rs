//! Incremental web-bundle updates.
//!
//! The desktop app is a Rust shell that loads a web bundle through the appload
//! plugin. A release ships two things: the shell (dmg / nsis / AppImage, ~26MB)
//! and the web bundle (~12MB). Shell changes are rare — most releases only touch
//! the frontend — so for those, replacing the web bundle alone is enough, and
//! this module is that path.
//!
//! It fetches the bundle's signed manifest from the release assets, verifies it,
//! and produces the archive the next launch will use. Files the installed copy
//! already holds — same path, same blake3 — are taken from it; the rest are
//! fetched one HTTP Range request at a time, against the compressed extents the
//! manifest records for the published zip, and the whole set is written back out
//! as a fresh archive. A frontend-only release usually costs a few hundred KB
//! that way instead of the full ~12MB. Downloading the archive whole stays the
//! path for a first install, and the fallback whenever anything about the
//! incremental one cannot be trusted.
//!
//! The copy compiled into the binary stays the baseline: appload installs
//! whatever sits at `path::bundle_path()` / `path::manifest_path()` during
//! startup, so overlaying the newer pair onto those paths between
//! `write_vendored` and the plugin's setup is all it takes. The plugin never
//! learns that an update exists, and nothing in it has to change.
//!
//! Trust chain, in the order the checks run:
//!
//! 1. minisign over `manifest.json`, with the same key pair the Tauri updater
//!    uses (its public half lives in `tauri.conf.json`). Nothing from the
//!    download is read before this passes.
//! 2. `shell_min_version` from the manifest against the running shell, so a
//!    bundle can refuse a shell too old to run it.
//! 3. per-file blake3 over the inflated bytes, on the way into the archive:
//!    whatever a Range request returns is checked against the signed manifest
//!    before it is written, and every reused file is checked the same way.
//! 4. `bundle.size` and `bundle.blake3` against the archive as downloaded. Only
//!    the full-download path can satisfy these: an assembled archive is
//!    equivalent to the published one file for file, not byte for byte.
//!
//! appload's own per-file check does not apply to a vendored bundle — it only
//! requires that the files the manifest names are present in the archive — so
//! the checks above are what keeps a bad bundle from being laid down at all.
//!
//! A version applied twice without the loaded app reporting in is assumed broken
//! and rolled back to the one it replaced, so a bad bundle costs one restart
//! instead of a reinstall.

use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime};
use thiserror::Error;
use tokio::task::JoinSet;

use crate::path;

/// Serializes installs into the layout below; see [`apply_inner`].
static INSTALL_LOCK: std::sync::LazyLock<tokio::sync::Mutex<()>> =
    std::sync::LazyLock::new(|| tokio::sync::Mutex::new(()));

const ACTIVE_DIR_NAME: &str = "active";
const PREVIOUS_DIR_NAME: &str = "previous";
const STATE_FILE_NAME: &str = "state.json";
const BUNDLE_FILE_NAME: &str = "bundle.zip";
const MANIFEST_FILE_NAME: &str = "manifest.json";
const SIGNATURE_FILE_NAME: &str = "manifest.json.sig";

/// How many launches an applied-but-unconfirmed version gets before it is
/// treated as broken. One is the normal path; the second tolerates a crash on
/// the very first start rather than blaming the bundle for it.
const MAX_UNCONFIRMED_BOOTS: u32 = 2;

/// First bundle version that reports in through `web_update_report_healthy`.
///
/// Older bundles predate the command, so their silence says nothing about
/// whether they work, and holding them to probation would roll a perfectly good
/// bundle back on every launch. Anything at or after this version does report,
/// so probation means something for it.
const HEALTH_REPORT_SINCE: &str = "1.1.3";

/// Generous, because this is a background transfer of ~12MB on whatever
/// connection the user has. Failing here only means trying again next launch.
const HTTP_TIMEOUT_SECS: u64 = 180;

#[derive(Debug, Error)]
pub enum WebUpdateError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("HTTP error: {0}")]
    Http(#[from] reqwest::Error),

    #[error("Base64 error: {0}")]
    Base64(#[from] base64::DecodeError),

    #[error("{0} is not valid UTF-8")]
    Utf8(&'static str),

    #[error("Signature verification failed: {0}")]
    Signature(String),

    #[error("Bundle does not match its manifest: {0}")]
    Mismatch(String),

    #[error("Could not fetch a bundle entry: {0}")]
    Fetch(String),

    #[error("Missing configuration: {0}")]
    Config(&'static str),
}

/// What the shell remembers about the bundle it should run next.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledState {
    /// Version that will be laid down on the next launch.
    #[serde(default)]
    pub active_version: Option<String>,
    /// `shell_min_version` recorded when it was installed; kept for diagnostics.
    #[serde(default)]
    pub shell_min_version: Option<String>,
    /// Version displaced by `active_version`, kept so a bad bundle can be undone.
    #[serde(default)]
    pub previous_version: Option<String>,
    /// Launches since `active_version` was written without a health report.
    #[serde(default)]
    pub boot_attempts: u32,
    /// Whether the loaded bundle has reported in for `active_version`.
    #[serde(default)]
    pub confirmed: bool,
}

/// Answer to `check_web_update` / `apply_web_update`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebUpdateStatus {
    /// `up-to-date`, `available`, `installed` or `needs-shell-update`.
    pub state: String,
    /// Version the app will actually run: the installed bundle when it is newer
    /// than the embedded one, otherwise the embedded one.
    pub current_version: String,
    pub available_version: Option<String>,
    pub shell_min_version: Option<String>,
    pub download_size: Option<u64>,
    pub message: Option<String>,
}

/// The parts of the published manifest this module needs.
#[derive(Debug, Clone, Deserialize)]
struct SignedManifest {
    version: String,
    #[serde(default)]
    shell_min_version: Option<String>,
    #[serde(default)]
    bundle: Option<BundleFacts>,
    /// Published order is the order the bundler wrote the archive in, so an
    /// assembled archive keeps it.
    #[serde(default)]
    files: Vec<ManifestFile>,
}

/// One entry as the published manifest describes it.
///
/// The uncompressed identity (`size` / `hash`) is what decides whether the
/// installed copy already has this file, and where an assembled archive gets
/// its content from. `offset` / `length` / `method` locate this entry's
/// *compressed* bytes inside the published zip, which is what a Range request
/// has to ask for.
#[derive(Debug, Clone, Deserialize)]
struct ManifestFile {
    path: String,
    size: u64,
    #[serde(with = "hash_base64")]
    hash: blake3::Hash,
    offset: u64,
    length: u64,
    /// ZIP compression method: 0 = stored, 8 = deflate.
    method: u16,
}

/// Whole-archive facts, so a truncated or swapped download is caught before
/// appload is asked to extract anything.
#[derive(Debug, Clone, Deserialize)]
struct BundleFacts {
    size: u64,
    #[serde(with = "hash_base64")]
    blake3: blake3::Hash,
}

mod hash_base64 {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    use serde::{de::Error, Deserialize, Deserializer};

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<blake3::Hash, D::Error> {
        let encoded = String::deserialize(d)?;
        let bytes = STANDARD.decode(&encoded).map_err(D::Error::custom)?;
        let bytes: [u8; 32] = bytes
            .try_into()
            .map_err(|_| D::Error::custom("blake3 hash must be 32 bytes"))?;

        Ok(blake3::Hash::from_bytes(bytes))
    }
}

// ---------------------------------------------------------------------------
// Startup: lay down whatever an earlier run installed
// ---------------------------------------------------------------------------

/// Overlays an installed web-bundle update on top of the copy in the binary.
///
/// Called after `write_vendored` has laid the embedded bundle down at
/// `bundle_path` / `manifest_path` and before appload reads those paths: the
/// plugin installs whatever it finds there as its vendored bundle, so writing
/// the newer pair over them is the entire mechanism.
///
/// Never fails hard on the update path — a missing, unreadable or obsolete
/// install simply leaves the embedded bundle in place, which is what would have
/// happened anyway.
pub fn apply_installed_update(
    bundle_path: &Path,
    manifest_path: &Path,
    embedded_version: Option<&str>,
) -> Result<(), WebUpdateError> {
    let layout = Layout::resolve()?;
    let Some(mut state) = layout.read_state() else {
        return Ok(());
    };

    // Undo a version that never reported in before anything else, so a broken
    // bundle cannot be applied again.
    let on_probation = state
        .active_version
        .as_deref()
        .is_some_and(|version| !is_newer(HEALTH_REPORT_SINCE, version));

    if !state.confirmed
        && on_probation
        && state.boot_attempts >= MAX_UNCONFIRMED_BOOTS
        && layout.has_previous()
    {
        tracing::warn!(
            version = ?state.active_version,
            attempts = state.boot_attempts,
            "Installed web bundle never reported in; rolling back"
        );
        state = layout.rollback()?;
    }

    if !layout.has_active() {
        return Ok(());
    }

    let Some(active_version) = state.active_version.clone() else {
        return Ok(());
    };

    // A shell update ships a bundle of its own. When that copy is at least as
    // new as the install, the install is obsolete and is dropped so it cannot
    // resurface behind a newer binary later.
    if let Some(embedded) = embedded_version {
        if !is_newer(&active_version, embedded) {
            tracing::info!(
                installed = %active_version,
                embedded = %embedded,
                "Embedded web bundle is at least as new as the installed one; discarding the install"
            );
            layout.clear()?;
            return Ok(());
        }
    }

    layout.overlay(bundle_path, manifest_path)?;

    state.boot_attempts = state.boot_attempts.saturating_add(1);
    layout.write_state(&state)?;

    tracing::info!(
        version = %active_version,
        attempt = state.boot_attempts,
        "Applied installed web bundle update"
    );

    Ok(())
}

/// Records that the loaded bundle came up.
///
/// Issued by the bundle's own entry point once the app has mounted, which makes
/// it a signal only a working bundle can send: the launcher window runs a
/// different entry point and a bundle that cannot render itself never reaches
/// the call. (It deliberately is *not* wired to `set_desktop_config`, which the
/// launcher calls before any bundle is loaded — that would confirm a broken
/// bundle without it ever having started.)
///
/// Cheap and idempotent: it returns immediately unless an install is pending.
#[tauri::command]
pub fn web_update_report_healthy() {
    let Ok(layout) = Layout::resolve() else {
        return;
    };
    let Some(mut state) = layout.read_state() else {
        return;
    };

    if state.confirmed || state.active_version.is_none() {
        return;
    }

    state.confirmed = true;
    state.boot_attempts = 0;

    match layout.write_state(&state) {
        Ok(()) => tracing::info!(
            version = ?state.active_version,
            "Web bundle update reported in and is now confirmed"
        ),
        Err(e) => tracing::warn!(error = %e, "Failed to record web bundle health"),
    }
}

/// Version of the web bundle compiled into this binary, read from the manifest
/// embedded next to it.
pub fn embedded_version() -> Option<String> {
    let bytes = include_bytes!("../../manifest.json");

    match serde_json::from_slice::<SignedManifest>(bytes) {
        Ok(manifest) => Some(manifest.version),
        Err(e) => {
            tracing::warn!(error = %e, "Could not read the embedded web bundle manifest");
            None
        }
    }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Reports whether a newer web bundle is published.
///
/// Errors are deliberately returned as `Err` rather than folded into a status:
/// the caller treats them as "no update right now", and the distinction is
/// useful when debugging a proxy or a rate limit.
#[tauri::command]
pub async fn check_web_update<R: Runtime>(app: AppHandle<R>) -> Result<WebUpdateStatus, String> {
    check_inner(&app).await.map_err(|e| {
        tracing::warn!(error = %e, "Web bundle update check failed");
        e.to_string()
    })
}

/// Downloads and installs the published web bundle.
///
/// The running app keeps using the bundle it started with; the new one is
/// picked up on the next launch. That is a deliberate trade: swapping the live
/// bundle would mean reloading a webview the user may have unsaved work in.
#[tauri::command]
pub async fn apply_web_update<R: Runtime>(app: AppHandle<R>) -> Result<WebUpdateStatus, String> {
    apply_inner(&app).await.map_err(|e| {
        tracing::warn!(error = %e, "Web bundle update failed");
        e.to_string()
    })
}

/// Reports a web bundle that has been downloaded and staged, but is not the
/// one this session is running.
///
/// Nothing about it can fail from here — the download, the signature and the
/// per-file hashes were all checked when it was installed — so the only step
/// left is the restart that makes [`apply_installed_update`] lay it down. That
/// is what the settings page turns into a restart button, instead of leaving
/// the update to appear on whatever launch happens next.
#[tauri::command]
pub fn pending_web_update() -> Option<String> {
    let staged = Layout::resolve().ok()?.read_state()?.active_version?;
    let running = running_version()?;

    is_newer(&staged, &running).then_some(staged)
}

/// Version of the web bundle this session is running.
///
/// `write_vendored` rewrites `path::manifest_path()` from the binary on every
/// launch and [`apply_installed_update`] overlays the staged copy on it right
/// after, so that file describes the bundle appload loaded — as opposed to the
/// staged one, which only describes the bundle the *next* launch will load.
fn running_version() -> Option<String> {
    let bytes = fs::read(path::manifest_path()).ok()?;

    match serde_json::from_slice::<SignedManifest>(&bytes) {
        Ok(manifest) => Some(manifest.version),
        Err(e) => {
            tracing::warn!(error = %e, "Could not read the running web bundle manifest");
            None
        }
    }
}

async fn check_inner<R: Runtime>(app: &AppHandle<R>) -> Result<WebUpdateStatus, WebUpdateError> {
    let current = effective_version();
    let (endpoint, public_key) = update_endpoint(app)?;
    let client = http_client()?;

    let (_, manifest) = fetch_manifest(&client, &endpoint, &public_key).await?;

    status_for(app, &manifest, current)
}

async fn apply_inner<R: Runtime>(app: &AppHandle<R>) -> Result<WebUpdateStatus, WebUpdateError> {
    // One install at a time: two of them would write the same `active/`
    // directory at once, and a half-written staged bundle is a bundle the next
    // launch would lay down. The second caller waits and then finds nothing to
    // do, since `current` is read after the wait.
    let _installing = INSTALL_LOCK.lock().await;

    let current = effective_version();
    let (endpoint, public_key) = update_endpoint(app)?;
    let client = http_client()?;

    let (manifest_bytes, manifest) = fetch_manifest(&client, &endpoint, &public_key).await?;

    let status = status_for(app, &manifest, current)?;
    if status.state != "available" {
        return Ok(status);
    }

    let archive = match incremental_archive(&client, &endpoint, &manifest).await {
        Ok(Some(archive)) => archive,
        // Nothing local to diff against: a first install, or a manifest that
        // predates the incremental channel.
        Ok(None) => download_archive(&client, &endpoint, &manifest).await?,
        Err(e) => {
            tracing::warn!(error = %e, "Incremental assembly failed; downloading the whole archive");
            download_archive(&client, &endpoint, &manifest).await?
        }
    };

    let layout = Layout::resolve()?;
    layout.install(&manifest, &manifest_bytes, &archive)?;

    tracing::info!(
        version = %manifest.version,
        bytes = archive.len(),
        "Installed web bundle update; it takes effect on the next launch"
    );

    Ok(WebUpdateStatus {
        state: "installed".into(),
        download_size: Some(archive.len() as u64),
        message: Some("The update will be used the next time Hoppscotch starts.".into()),
        ..status
    })
}

/// Turns a verified manifest into a status, applying the checks that decide
/// whether it may be installed at all.
fn status_for<R: Runtime>(
    app: &AppHandle<R>,
    manifest: &SignedManifest,
    current: String,
) -> Result<WebUpdateStatus, WebUpdateError> {
    let base = WebUpdateStatus {
        state: "up-to-date".into(),
        current_version: current.clone(),
        available_version: None,
        shell_min_version: manifest.shell_min_version.clone(),
        download_size: manifest.bundle.as_ref().map(|b| b.size),
        message: None,
    };

    if !is_newer(&manifest.version, &current) {
        return Ok(base);
    }

    if let Some(minimum) = manifest.shell_min_version.as_deref() {
        let shell = app.package_info().version.to_string();
        if is_newer(minimum, &shell) {
            tracing::info!(
                bundle = %manifest.version,
                required_shell = %minimum,
                shell = %shell,
                "Web bundle needs a newer shell; a full app update is required"
            );

            return Ok(WebUpdateStatus {
                state: "needs-shell-update".into(),
                available_version: Some(manifest.version.clone()),
                message: Some(format!(
                    "Version {} needs a newer Hoppscotch shell (>= {}); update the app instead.",
                    manifest.version, minimum
                )),
                ..base
            });
        }
    }

    Ok(WebUpdateStatus {
        state: "available".into(),
        available_version: Some(manifest.version.clone()),
        ..base
    })
}

// ---------------------------------------------------------------------------
// Incremental assembly
// ---------------------------------------------------------------------------

/// File fetches in flight at once. Enough that a release touching a hundred
/// files is not a hundred round trips in series, low enough to stay a guest on
/// the release host.
const FETCH_CONCURRENCY: usize = 8;

/// Attempts per entry. A body that ends early now and then is a fact of the
/// release host rather than a sign of anything wrong with the bundle, and a
/// retried GET for a byte range costs nothing but itself.
const FETCH_ATTEMPTS: u32 = 3;

/// Downloads the published archive whole and checks it against the signed
/// whole-archive facts.
async fn download_archive(
    client: &reqwest::Client,
    endpoint: &str,
    manifest: &SignedManifest,
) -> Result<Vec<u8>, WebUpdateError> {
    let archive = client
        .get(format!("{}/{}", endpoint, BUNDLE_FILE_NAME))
        .send()
        .await?
        .error_for_status()?
        .bytes()
        .await?
        .to_vec();

    verify_archive(&archive, manifest.bundle.as_ref())?;

    Ok(archive)
}

/// Rebuilds the published archive from the installed one plus whatever
/// changed, without downloading it whole.
///
/// `Ok(None)` means the incremental path does not apply to this release —
/// no local copy to diff against, or a manifest without compressed extents —
/// and is not an error: the caller downloads the archive the usual way.
async fn incremental_archive(
    client: &reqwest::Client,
    endpoint: &str,
    manifest: &SignedManifest,
) -> Result<Option<Vec<u8>>, WebUpdateError> {
    // An entry the manifest gives no compressed extent for cannot be asked
    // for by Range. One is enough to make the whole manifest unusable here,
    // and it is also how a manifest published before this channel existed
    // looks.
    if manifest.files.is_empty() || manifest.files.iter().any(|f| f.length == 0 && f.size > 0) {
        tracing::info!("Published manifest carries no usable compressed extents");
        return Ok(None);
    }

    let Some(base) = read_base_bundle() else {
        tracing::info!("No installed archive to diff against");
        return Ok(None);
    };

    let local = local_file_contents(&base)?;
    let (mut slots, pending) = plan_reuse(&local, manifest);

    tracing::info!(
        entries = manifest.files.len(),
        reused = manifest.files.len() - pending.len(),
        to_fetch = pending.len(),
        "Assembling the published bundle from the installed one"
    );

    let url = format!("{}/{}", endpoint, BUNDLE_FILE_NAME);
    let fetched_bytes = fetch_pending(client, &url, manifest, &mut slots, &pending).await?;

    let mut contents = Vec::with_capacity(slots.len());
    for slot in slots {
        contents.push(
            slot.ok_or_else(|| WebUpdateError::Mismatch("an entry was never filled".into()))?,
        );
    }

    let archive = build_archive(manifest, &contents)?;

    tracing::info!(
        downloaded_bytes = fetched_bytes,
        archive_bytes = archive.len(),
        "Assembled the new bundle locally"
    );

    Ok(Some(archive))
}

/// The archive the running app was loaded from, if it is still on disk.
///
/// `temp_dir` is the OS's to wipe, which is why this answers `Option` and the
/// caller falls back to a full download rather than failing.
fn read_base_bundle() -> Option<Vec<u8>> {
    if let Ok(bytes) = fs::read(path::bundle_path()) {
        return Some(bytes);
    }

    // An installed update also lives in the channel's own directory, which
    // survives a wipe of the scratch copy.
    let active = Layout::resolve().ok()?.active.join(BUNDLE_FILE_NAME);

    fs::read(active).ok()
}

/// Every entry in `archive`, by path, inflated.
///
/// The reuse decision is a hash over uncompressed bytes — the value the
/// manifest carries — so the archive has to be opened up to answer it.
fn local_file_contents(archive: &[u8]) -> Result<HashMap<String, Vec<u8>>, WebUpdateError> {
    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(archive)).map_err(|e| {
        WebUpdateError::Mismatch(format!("installed archive is not a readable zip: {e}"))
    })?;

    let mut files = HashMap::with_capacity(zip.len());

    for index in 0..zip.len() {
        let mut file = zip
            .by_index(index)
            .map_err(|e| WebUpdateError::Mismatch(format!("installed archive entry: {e}")))?;

        if !file.is_file() {
            continue;
        }

        let name = file.name().to_string();
        let mut content = Vec::with_capacity(file.size() as usize);
        file.read_to_end(&mut content)?;

        files.insert(name, content);
    }

    Ok(files)
}

/// Splits the manifest's entries into the ones the installed copy already has
/// and the ones that have to be fetched.
///
/// Reuse is decided on content, never on the path alone: an unchanged file
/// passes the manifest's own hash, while a path that survived a rebuild with
/// different bytes is fetched like any other.
fn plan_reuse(
    local: &HashMap<String, Vec<u8>>,
    manifest: &SignedManifest,
) -> (Vec<Option<Vec<u8>>>, Vec<usize>) {
    let mut slots: Vec<Option<Vec<u8>>> = vec![None; manifest.files.len()];
    let mut pending = Vec::new();

    for (index, entry) in manifest.files.iter().enumerate() {
        // An empty file's content is known without asking anyone for it, and a
        // stored one has no compressed extent a Range request could name.
        if entry.size == 0 {
            slots[index] = Some(Vec::new());
            continue;
        }

        match local.get(&entry.path) {
            Some(content)
                if content.len() as u64 == entry.size && blake3::hash(content) == entry.hash =>
            {
                slots[index] = Some(content.clone());
            }
            _ => pending.push(index),
        }
    }

    (slots, pending)
}

/// A run of the published archive that one request can bring back.
struct Extent {
    start: u64,
    /// Exclusive.
    end: u64,
    /// Indices into the manifest, in archive order.
    entries: Vec<usize>,
}

/// How much unchanged data an extent may swallow to join the one before it.
///
/// A few KB of extra bytes is cheaper than the request it saves: every request
/// is a redirect, a handshake and a slot against the release host's patience.
const EXTENT_GAP: u64 = 8 * 1024;

/// Groups the entries that have to be fetched into as few extents as possible.
///
/// A release's changed files tend to arrive in runs — a directory's worth of
/// chunks — and it is the merging here that keeps a hundred changed files from
/// being a hundred requests.
fn merge_extents(manifest: &SignedManifest, pending: &[usize]) -> Vec<Extent> {
    let mut ordered = pending.to_vec();
    ordered.sort_by_key(|&index| manifest.files[index].offset);

    let mut extents: Vec<Extent> = Vec::new();

    for index in ordered {
        let entry = &manifest.files[index];
        let end = entry.offset + entry.length;

        match extents.last_mut() {
            Some(last) if entry.offset <= last.end + EXTENT_GAP => {
                last.end = last.end.max(end);
                last.entries.push(index);
            }
            _ => extents.push(Extent {
                start: entry.offset,
                end,
                entries: vec![index],
            }),
        }
    }

    extents
}

/// Fetches one contiguous run of the published archive.
///
/// The request goes against the archive as published, never against the local
/// copy: the offsets describe the published layout, which an assembled archive
/// no longer shares.
async fn fetch_extent(
    client: &reqwest::Client,
    url: &str,
    start: u64,
    length: u64,
) -> Result<Vec<u8>, WebUpdateError> {
    let response = client
        .get(url)
        .header(
            reqwest::header::RANGE,
            format!("bytes={}-{}", start, start + length - 1),
        )
        // Offsets only address the bytes as stored: a body that arrived
        // transparently decompressed would be the wrong alphabet to index into.
        .header(reqwest::header::ACCEPT_ENCODING, "identity")
        .send()
        .await?
        .error_for_status()?;

    if response.status() != reqwest::StatusCode::PARTIAL_CONTENT {
        return Err(WebUpdateError::Fetch(format!(
            "bytes {start}-: expected a partial response, got {}",
            response.status()
        )));
    }

    let bytes = response.bytes().await?;
    if bytes.len() as u64 != length {
        return Err(WebUpdateError::Mismatch(format!(
            "bytes {start}-: expected {length} bytes, got {}",
            bytes.len()
        )));
    }

    Ok(bytes.to_vec())
}

/// [`fetch_extent`], retried: see [`FETCH_ATTEMPTS`].
async fn fetch_extent_with_retries(
    client: &reqwest::Client,
    url: &str,
    start: u64,
    length: u64,
) -> Result<Vec<u8>, WebUpdateError> {
    let mut last = None;

    for attempt in 1..=FETCH_ATTEMPTS {
        match fetch_extent(client, url, start, length).await {
            Ok(bytes) => return Ok(bytes),
            Err(e) => {
                tracing::warn!(start, length, attempt, error = %e, "Archive extent fetch failed");
                last = Some(e);
            }
        }
    }

    Err(last.unwrap_or_else(|| WebUpdateError::Fetch("no attempt was made".into())))
}

/// The content one entry holds inside a fetched extent, checked against the
/// manifest.
fn unpack_entry(
    extent: &[u8],
    extent_start: u64,
    entry: &ManifestFile,
) -> Result<Vec<u8>, WebUpdateError> {
    let start = (entry.offset - extent_start) as usize;
    let compressed = &extent[start..start + entry.length as usize];

    let content = inflate(compressed, entry.method)?;

    if content.len() as u64 != entry.size {
        return Err(WebUpdateError::Mismatch(format!(
            "{}: expected {} bytes, got {}",
            entry.path,
            entry.size,
            content.len()
        )));
    }

    let actual = blake3::hash(&content);
    if actual != entry.hash {
        return Err(WebUpdateError::Mismatch(format!(
            "{}: blake3 mismatch (expected {}, got {})",
            entry.path,
            entry.hash.to_hex(),
            actual.to_hex()
        )));
    }

    Ok(content)
}

/// Fetches every pending entry into its slot, and answers the compressed bytes
/// that came over the wire.
///
/// The one place the download loop lives, so the app and the end-to-end test
/// over a real release run the same one.
async fn fetch_pending(
    client: &reqwest::Client,
    url: &str,
    manifest: &SignedManifest,
    slots: &mut [Option<Vec<u8>>],
    pending: &[usize],
) -> Result<u64, WebUpdateError> {
    let extents = merge_extents(manifest, pending);

    tracing::info!(
        entries = pending.len(),
        extents = extents.len(),
        "Fetching the changed entries"
    );

    let mut fetched = 0u64;

    for chunk in extents.chunks(FETCH_CONCURRENCY) {
        let mut tasks = JoinSet::new();

        for extent in chunk {
            let client = client.clone();
            let url = url.to_string();
            let start = extent.start;
            let length = extent.end - extent.start;
            let entries = extent.entries.clone();

            tasks.spawn(async move {
                fetch_extent_with_retries(&client, &url, start, length)
                    .await
                    .map(|bytes| (start, length, entries, bytes))
            });
        }

        while let Some(joined) = tasks.join_next().await {
            let (start, length, entries, bytes) =
                joined.map_err(|e| WebUpdateError::Fetch(e.to_string()))??;

            fetched += length;

            for index in entries {
                slots[index] = Some(unpack_entry(&bytes, start, &manifest.files[index])?);
            }
        }
    }

    Ok(fetched)
}

/// The content behind a compressed extent, per the method's number in the
/// manifest.
fn inflate(compressed: &[u8], method: u16) -> Result<Vec<u8>, WebUpdateError> {
    match method {
        0 => Ok(compressed.to_vec()),
        8 => {
            let mut content = Vec::new();
            flate2::read::DeflateDecoder::new(compressed).read_to_end(&mut content)?;

            Ok(content)
        }
        other => Err(WebUpdateError::Mismatch(format!(
            "unsupported compression method {other}"
        ))),
    }
}

/// Writes the manifest's entries into a fresh archive, in manifest order.
///
/// Nothing here is byte-compatible with the published archive — a reused entry
/// may have been compressed by an earlier build — so the whole-archive blake3
/// does not apply. What does apply is every file's own hash, and every file has
/// passed it by the time it reaches this point: `fetch_file` checks what came
/// off the wire, `plan_reuse` checks what came off the disk.
fn build_archive(
    manifest: &SignedManifest,
    contents: &[Vec<u8>],
) -> Result<Vec<u8>, WebUpdateError> {
    let mut writer = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));

    for (entry, content) in manifest.files.iter().zip(contents) {
        // The options the bundler uses, so an assembled archive is drawn the
        // same way as a published one.
        let options = zip::write::SimpleFileOptions::default().unix_permissions(0o644);

        writer
            .start_file(entry.path.as_str(), options)
            .map_err(|e| WebUpdateError::Mismatch(format!("{}: {e}", entry.path)))?;

        writer
            .write_all(content)
            .map_err(|e| WebUpdateError::Mismatch(format!("{}: {e}", entry.path)))?;
    }

    let archive = writer
        .finish()
        .map_err(|e| WebUpdateError::Mismatch(format!("assembled archive: {e}")))?
        .into_inner();

    // A bundle appload cannot read is a launch that fails on the next start,
    // and the files it looks up by name are the whole of what it requires, so
    // reading the archive back once is the cheapest place to catch a bad one.
    verify_assembled(&archive, manifest)?;

    Ok(archive)
}

/// Reads the archive just written back and checks every entry against the
/// manifest: present under the name appload will ask for, and holding the bytes
/// the manifest hashes.
///
/// A bundle appload cannot open is a launch that fails on the next start. The
/// content half of this is not redundant with the checks on the way in: a
/// compressor can write a stream that is structurally fine and wrong, which is
/// exactly what an arithmetic overflow in miniz_oxide 0.8.1 did to some inputs.
fn verify_assembled(
    archive: &[u8],
    manifest: &SignedManifest,
) -> Result<(), WebUpdateError> {
    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(archive))
        .map_err(|e| WebUpdateError::Mismatch(format!("assembled archive is unreadable: {e}")))?;

    for entry in &manifest.files {
        let mut file = zip.by_name(&entry.path).map_err(|e| {
            WebUpdateError::Mismatch(format!("assembled archive is missing {}: {e}", entry.path))
        })?;

        let mut content = Vec::with_capacity(entry.size as usize);
        file.read_to_end(&mut content)
            .map_err(|e| WebUpdateError::Mismatch(format!("{}: {e}", entry.path)))?;

        let actual = blake3::hash(&content);
        if actual != entry.hash {
            return Err(WebUpdateError::Mismatch(format!(
                "{}: assembled blake3 mismatch (expected {}, got {})",
                entry.path,
                entry.hash.to_hex(),
                actual.to_hex()
            )));
        }
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Fetching and verification
// ---------------------------------------------------------------------------

fn http_client() -> Result<reqwest::Client, WebUpdateError> {
    // `reqwest` honours HTTPS_PROXY / HTTP_PROXY from the environment, the same
    // variables the updater reads, so a proxied machine works for both channels
    // without any extra configuration here.
    //
    // Connections are not reused (`http1_only`, no idle pool): across a run of
    // Range requests the release host drops bodies often enough that the
    // retries dominate the run's wall time, and a fresh handshake per request
    // costs far less than the retries it avoids. A dropped body fails an entry
    // and is retried, never a wrong result, so this is a choice about speed
    // rather than correctness.
    Ok(reqwest::Client::builder()
        .timeout(Duration::from_secs(HTTP_TIMEOUT_SECS))
        .http1_only()
        .pool_max_idle_per_host(0)
        .build()?)
}

/// Fetches `manifest.json` and its detached signature, verifies the signature
/// and only then parses the manifest.
async fn fetch_manifest(
    client: &reqwest::Client,
    endpoint: &str,
    public_key: &str,
) -> Result<(Vec<u8>, SignedManifest), WebUpdateError> {
    let manifest = client
        .get(format!("{}/{}", endpoint, MANIFEST_FILE_NAME))
        .send()
        .await?
        .error_for_status()?
        .bytes()
        .await?
        .to_vec();

    let signature = client
        .get(format!("{}/{}", endpoint, SIGNATURE_FILE_NAME))
        .send()
        .await?
        .error_for_status()?
        .bytes()
        .await?;

    verify_manifest_signature(&manifest, &signature, public_key)?;

    let parsed = serde_json::from_slice(&manifest)?;

    Ok((manifest, parsed))
}

/// Verifies the minisign signature over the manifest bytes.
///
/// Both inputs arrive base64-wrapped and both wrappers are unwrapped here:
/// `tauri.conf.json` stores the updater's public key as base64 of a minisign
/// public key file, and `tauri signer sign` writes the signature as base64 of a
/// minisign signature file. Those two layers are what make the key already
/// embedded in every install verify the assets CI produces, with no extra
/// secret and no second key to rotate.
fn verify_manifest_signature(
    manifest: &[u8],
    signature: &[u8],
    public_key: &str,
) -> Result<(), WebUpdateError> {
    let key_text = decode_to_text(public_key.trim(), "public key")?;
    let key = minisign_verify::PublicKey::decode(&key_text)
        .map_err(|e| WebUpdateError::Signature(e.to_string()))?;

    let signature_b64 = std::str::from_utf8(signature)
        .map_err(|_| WebUpdateError::Utf8("signature"))?
        .trim();
    let signature_text = decode_to_text(signature_b64, "signature")?;
    let signature = minisign_verify::Signature::decode(&signature_text)
        .map_err(|e| WebUpdateError::Signature(e.to_string()))?;

    // `allow_legacy` matches what tauri-plugin-updater passes when it verifies
    // release artifacts (`verify_signature` in its `updater.rs`), so both
    // channels accept exactly the same set of signatures.
    key.verify(manifest, &signature, true)
        .map_err(|e| WebUpdateError::Signature(e.to_string()))
}

/// Checks the archive as downloaded against the signed manifest.
fn verify_archive(
    archive: &[u8],
    facts: Option<&BundleFacts>,
) -> Result<(), WebUpdateError> {
    let Some(facts) = facts else {
        // Manifests older than the update channel have no archive facts. The
        // signature and appload's per-file hashes still cover the content, so
        // this is a warning rather than a refusal.
        tracing::warn!("Manifest carries no bundle facts; skipping the archive checks");
        return Ok(());
    };

    if archive.len() as u64 != facts.size {
        return Err(WebUpdateError::Mismatch(format!(
            "expected {} bytes, got {}",
            facts.size,
            archive.len()
        )));
    }

    let actual = blake3::hash(archive);
    if actual != facts.blake3 {
        return Err(WebUpdateError::Mismatch(format!(
            "blake3 mismatch (expected {}, got {})",
            facts.blake3.to_hex(),
            actual.to_hex()
        )));
    }

    Ok(())
}

/// Base URL and public key for the channel.
///
/// Derived from the updater's own configuration rather than a second block:
/// both channels publish from the same release and are signed with the same key
/// pair, so deriving them means a moved release host or a rotated key cannot
/// leave the two out of step.
fn update_endpoint<R: Runtime>(app: &AppHandle<R>) -> Result<(String, String), WebUpdateError> {
    let updater = app
        .config()
        .plugins
        .0
        .get("updater")
        .ok_or(WebUpdateError::Config("plugins.updater is not configured"))?;

    let endpoint = updater
        .get("endpoints")
        .and_then(|value| value.as_array())
        .and_then(|list| list.first())
        .and_then(|value| value.as_str())
        .ok_or(WebUpdateError::Config(
            "plugins.updater.endpoints is not configured",
        ))?;

    let public_key = updater
        .get("pubkey")
        .and_then(|value| value.as_str())
        .ok_or(WebUpdateError::Config("plugins.updater.pubkey is not configured"))?;

    // `.../latest/download/hoppscotch-desktop-latest.json` is the updater's own
    // manifest; the web assets are siblings of it.
    let base = endpoint
        .rsplit_once('/')
        .map(|(base, _)| base.to_string())
        .ok_or(WebUpdateError::Config(
            "plugins.updater.endpoints has no directory part",
        ))?;

    Ok((base, public_key.to_string()))
}

fn decode_to_text(encoded: &str, what: &'static str) -> Result<String, WebUpdateError> {
    let bytes = base64::engine::general_purpose::STANDARD.decode(encoded)?;

    String::from_utf8(bytes).map_err(|_| WebUpdateError::Utf8(what))
}

/// The version the app will actually run.
fn effective_version() -> String {
    let embedded = embedded_version();

    let installed = Layout::resolve()
        .ok()
        .and_then(|layout| layout.read_state())
        .and_then(|state| state.active_version);

    match (installed, embedded) {
        (Some(installed), Some(embedded)) => {
            if is_newer(&installed, &embedded) {
                installed
            } else {
                embedded
            }
        }
        (Some(installed), None) => installed,
        (None, Some(embedded)) => embedded,
        (None, None) => "0.0.0".to_string(),
    }
}

/// Whether `candidate` is a strictly newer semantic version than `base`.
///
/// Unparsable input answers `false` on purpose: declining to apply an update is
/// recoverable, applying one on a version comparison nobody could evaluate is
/// not.
fn is_newer(candidate: &str, base: &str) -> bool {
    match (
        semver::Version::parse(candidate),
        semver::Version::parse(base),
    ) {
        (Ok(candidate), Ok(base)) => candidate > base,
        _ => {
            tracing::warn!(candidate, base, "Unparsable version; treating as not newer");
            false
        }
    }
}

// ---------------------------------------------------------------------------
// On-disk layout
// ---------------------------------------------------------------------------

/// `{config_dir}/web-update` holding the active and previous bundles.
///
/// The previous copy exists purely so a bundle that turns out to be broken can
/// be undone without a reinstall.
struct Layout {
    active: PathBuf,
    previous: PathBuf,
    state: PathBuf,
}

impl Layout {
    fn resolve() -> Result<Self, WebUpdateError> {
        let root = path::web_update_dir()?;

        Ok(Self {
            active: root.join(ACTIVE_DIR_NAME),
            previous: root.join(PREVIOUS_DIR_NAME),
            state: root.join(STATE_FILE_NAME),
        })
    }

    fn read_state(&self) -> Option<InstalledState> {
        let contents = fs::read_to_string(&self.state).ok()?;

        match serde_json::from_str(&contents) {
            Ok(state) => Some(state),
            Err(e) => {
                tracing::warn!(error = %e, "Ignoring unreadable web update state");
                None
            }
        }
    }

    fn write_state(&self, state: &InstalledState) -> Result<(), WebUpdateError> {
        write_atomically(&self.state, &serde_json::to_vec_pretty(state)?)
    }

    fn has_active(&self) -> bool {
        bundle_files_exist(&self.active)
    }

    fn has_previous(&self) -> bool {
        bundle_files_exist(&self.previous)
    }

    /// Copies the active bundle over the paths appload reads at startup.
    fn overlay(&self, bundle_path: &Path, manifest_path: &Path) -> Result<(), WebUpdateError> {
        if let Some(parent) = bundle_path.parent() {
            fs::create_dir_all(parent)?;
        }
        if let Some(parent) = manifest_path.parent() {
            fs::create_dir_all(parent)?;
        }

        fs::copy(self.active.join(BUNDLE_FILE_NAME), bundle_path)?;
        fs::copy(self.active.join(MANIFEST_FILE_NAME), manifest_path)?;

        Ok(())
    }

    /// Stores a verified bundle, keeping the one it replaces.
    ///
    /// Order matters: the archive lands before the manifest, and the state file
    /// last, so a crash midway leaves the previous install in effect rather than
    /// a half-written pair.
    fn install(
        &self,
        manifest: &SignedManifest,
        manifest_bytes: &[u8],
        archive: &[u8],
    ) -> Result<InstalledState, WebUpdateError> {
        let previous_version = self.read_state().and_then(|state| state.active_version);

        if self.has_active() {
            fs::create_dir_all(&self.previous)?;
            for name in [BUNDLE_FILE_NAME, MANIFEST_FILE_NAME] {
                fs::copy(self.active.join(name), self.previous.join(name))?;
            }
        }

        fs::create_dir_all(&self.active)?;
        write_atomically(&self.active.join(BUNDLE_FILE_NAME), archive)?;
        write_atomically(&self.active.join(MANIFEST_FILE_NAME), manifest_bytes)?;

        let state = InstalledState {
            active_version: Some(manifest.version.clone()),
            shell_min_version: manifest.shell_min_version.clone(),
            previous_version,
            boot_attempts: 0,
            confirmed: false,
        };
        self.write_state(&state)?;

        Ok(state)
    }

    /// Restores the version that `active` replaced.
    fn rollback(&self) -> Result<InstalledState, WebUpdateError> {
        for name in [BUNDLE_FILE_NAME, MANIFEST_FILE_NAME] {
            fs::copy(self.previous.join(name), self.active.join(name))?;
        }

        let mut state = self.read_state().unwrap_or_default();
        let restored = state.previous_version.take();

        state.shell_min_version = fs::read(self.active.join(MANIFEST_FILE_NAME))
            .ok()
            .and_then(|bytes| serde_json::from_slice::<SignedManifest>(&bytes).ok())
            .and_then(|manifest| manifest.shell_min_version)
            .or(state.shell_min_version);

        state.active_version = restored.clone();
        state.previous_version = None;
        state.boot_attempts = 0;
        // The restored version was confirmed on an earlier launch, so it needs
        // no probation of its own.
        state.confirmed = true;

        self.write_state(&state)?;

        tracing::warn!(version = ?restored, "Rolled back to the previous web bundle");

        Ok(state)
    }

    /// Drops the install so the embedded bundle is used from now on.
    fn clear(&self) -> Result<(), WebUpdateError> {
        for dir in [&self.active, &self.previous] {
            if dir.exists() {
                fs::remove_dir_all(dir)?;
            }
        }

        if self.state.exists() {
            fs::remove_file(&self.state)?;
        }

        Ok(())
    }
}

fn bundle_files_exist(dir: &Path) -> bool {
    dir.join(BUNDLE_FILE_NAME).exists() && dir.join(MANIFEST_FILE_NAME).exists()
}

/// Writes via a sibling temporary file and a rename, so a reader never sees a
/// partial file.
fn write_atomically(path: &Path, contents: &[u8]) -> Result<(), WebUpdateError> {
    let temp = path.with_extension("tmp");

    fs::write(&temp, contents)?;
    fs::rename(&temp, path)?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn newer_versions_win_and_unparsable_input_loses() {
        assert!(is_newer("1.1.3", "1.1.2"));
        assert!(is_newer("1.2.0", "1.1.9"));
        assert!(!is_newer("1.1.2", "1.1.2"));
        assert!(!is_newer("1.1.1", "1.1.2"));
        // A version nobody can parse must never authorise an install.
        assert!(!is_newer("0.1.0", "not-a-version"));
        assert!(!is_newer("not-a-version", "1.1.2"));
    }

    #[test]
    fn state_round_trips_and_tolerates_missing_fields() {
        let dir = std::env::temp_dir().join(format!("hopp-web-update-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let state_path = dir.join(STATE_FILE_NAME);

        let layout = Layout {
            active: dir.join(ACTIVE_DIR_NAME),
            previous: dir.join(PREVIOUS_DIR_NAME),
            state: state_path.clone(),
        };

        // A state file written by an older build has no `confirmed` field and
        // must still load, defaulting to "not confirmed".
        fs::write(&state_path, br#"{"activeVersion":"1.1.3"}"#).unwrap();
        let state = layout.read_state().unwrap();
        assert_eq!(state.active_version.as_deref(), Some("1.1.3"));
        assert!(!state.confirmed);
        assert_eq!(state.boot_attempts, 0);

        layout.write_state(&state).unwrap();
        assert_eq!(layout.read_state().unwrap().active_version.as_deref(), Some("1.1.3"));

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_half_written_install_is_not_treated_as_complete() {
        let dir = std::env::temp_dir().join(format!("hopp-web-update-partial-{}", std::process::id()));
        let active = dir.join(ACTIVE_DIR_NAME);
        fs::create_dir_all(&active).unwrap();

        assert!(!bundle_files_exist(&active));

        // Only the archive: the pair is incomplete, so it must not be used.
        fs::write(active.join(BUNDLE_FILE_NAME), b"zip").unwrap();
        assert!(!bundle_files_exist(&active));

        fs::write(active.join(MANIFEST_FILE_NAME), b"{}").unwrap();
        assert!(bundle_files_exist(&active));

        fs::remove_dir_all(&dir).ok();
    }

    // -----------------------------------------------------------------------
    // Signature chain
    // -----------------------------------------------------------------------

    /// The public key exactly as the app reads it at runtime.
    ///
    /// Read from `tauri.conf.json` instead of copied into a constant on purpose:
    /// a hand-copied key can be subtly wrong and still look right — a dropped
    /// character near the end still base64-decodes to the expected 42 bytes and
    /// still carries the same key id, because the id sits near the start. Every
    /// signature then fails while the fixture appears sound, which is a very
    /// expensive thing to debug. Reading the real file also means this test
    /// fails if the config key is ever rotated without the pipeline following.
    fn configured_public_key() -> String {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).expect("tauri.conf.json");
        config["plugins"]["updater"]["pubkey"]
            .as_str()
            .expect("plugins.updater.pubkey")
            .to_string()
    }

    /// A payload signed by the release pipeline's own key, as produced by
    /// `tauri signer sign -k "$TAURI_SIGNING_PRIVATE_KEY"` in CI.
    const SIGNED_PAYLOAD: &[u8] = b"hello";

    /// The `.sig` asset that goes with [`SIGNED_PAYLOAD`].
    const PAYLOAD_SIGNATURE_ASSET: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVRSnROdHJBc2RiNzY0N05pcWZxRXEzeFFKR0syMktYWnJXbkNZL2FaVjZGbmxVTGRLelF6aVp4REg1d0g0MHdKSnl4MmY5T1U1b1dXQjVIL1NEU0xZVTJXaDRkWUZXMVFJPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzg5MjEzOTMzCWZpbGU6cGF5bG9hZC50eHQKbUJ2V0tDM1hEektlQ0ZCUGdySWtEeEQ4cis4RFFGMXZrT2Z4MTE3dlVvTmo0NFRXS3ZqNTUxYzNXVmdJR2ZuT25oVnZmS3QyaHY5VzFmQlJUcjAxQkE9PQo=";

    #[test]
    fn the_signature_chain_accepts_a_real_release_signature() {
        // End to end over the parts that only reality can pin down: base64 of a
        // minisign public key file, base64 of a minisign signature file, a
        // prehashed signature, and the key pair the release pipeline uses.
        verify_manifest_signature(
            SIGNED_PAYLOAD,
            PAYLOAD_SIGNATURE_ASSET.as_bytes(),
            &configured_public_key(),
        )
        .expect("the configured public key must accept signatures CI produces");
    }

    #[test]
    fn a_tampered_payload_is_rejected() {
        let error = verify_manifest_signature(
            b"hell0",
            PAYLOAD_SIGNATURE_ASSET.as_bytes(),
            &configured_public_key(),
        )
        .expect_err("a payload that was never signed must not verify");

        assert!(
            matches!(error, WebUpdateError::Signature(_)),
            "expected a signature error, got {error:?}"
        );
    }

    #[test]
    fn a_key_with_different_material_is_rejected() {
        // Same key id, different key bytes. Flipping a byte of the key material
        // (which sits after the id) keeps the key file well formed and keeps the
        // id matching, so the Ed25519 comparison is the only thing left that can
        // catch it — which is exactly the check that would be skipped if the id
        // comparison were ever mistaken for the whole verification.
        const STANDARD: base64::engine::general_purpose::GeneralPurpose =
            base64::engine::general_purpose::STANDARD;

        let decoded = STANDARD
            .decode(configured_public_key().trim())
            .expect("config pubkey is base64");
        let text = String::from_utf8(decoded).expect("config pubkey is text");
        let mut lines: Vec<String> = text.trim().lines().map(str::to_string).collect();

        let mut key_bytes = STANDARD.decode(lines[1].trim()).expect("key line is base64");
        let last = key_bytes.len() - 1;
        key_bytes[last] ^= 0x01;
        lines[1] = STANDARD.encode(&key_bytes);

        let tampered = STANDARD.encode(format!("{}\n", lines.join("\n")));

        let error = verify_manifest_signature(
            SIGNED_PAYLOAD,
            PAYLOAD_SIGNATURE_ASSET.as_bytes(),
            &tampered,
        )
        .expect_err("a key with different material must not verify a release signature");

        assert!(
            matches!(error, WebUpdateError::Signature(_)),
            "expected a signature error, got {error:?}"
        );
    }

    /// Opt-in positive path over a full release manifest, and the tool to reach
    /// for when a release starts failing verification: point
    /// `HOPP_WEB_UPDATE_FIXTURE` at a directory holding a `manifest.json` and
    /// its `manifest.json.sig` — release assets or a local `tauri signer sign`
    /// output both work — and set `HOPP_WEB_UPDATE_PUBKEY` when the key is not
    /// the one in `tauri.conf.json`.
    #[test]
    fn accepts_a_real_release_manifest_when_a_fixture_is_supplied() {
        let Ok(dir) = std::env::var("HOPP_WEB_UPDATE_FIXTURE") else {
            return;
        };
        let dir = Path::new(&dir);
        let public_key =
            std::env::var("HOPP_WEB_UPDATE_PUBKEY").unwrap_or_else(|_| configured_public_key());

        let manifest = fs::read(dir.join(MANIFEST_FILE_NAME)).expect("fixture manifest");
        let signature = fs::read(dir.join(SIGNATURE_FILE_NAME)).expect("fixture signature");

        // Report which file in the directory the signature actually covers: a
        // signature that matches a sibling instead of the manifest points at
        // the release pipeline rather than at the verification code, and that
        // distinction is the whole reason this test exists.
        for entry in fs::read_dir(dir).expect("fixture dir") {
            let path = entry.expect("entry").path();
            if path.file_name().and_then(|name| name.to_str()) == Some(SIGNATURE_FILE_NAME) {
                continue;
            }
            let Ok(bytes) = fs::read(&path) else {
                continue;
            };
            let verdict = verify_manifest_signature(&bytes, &signature, &public_key).is_ok();
            eprintln!("web_update fixture: {} verifies={verdict}", path.display());
        }

        verify_manifest_signature(&manifest, &signature, &public_key).expect("should verify");
    }

    // -----------------------------------------------------------------------
    // Incremental assembly
    // -----------------------------------------------------------------------

    /// A zip written the way the bundler writes one: same options, same order.
    fn zip_of(files: &[(&str, &[u8])]) -> Vec<u8> {
        let mut writer = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));

        for (path, content) in files {
            writer
                .start_file(
                    *path,
                    zip::write::SimpleFileOptions::default().unix_permissions(0o644),
                )
                .unwrap();
            writer.write_all(content).unwrap();
        }

        writer.finish().unwrap().into_inner()
    }

    fn encoded(hash: blake3::Hash) -> String {
        base64::engine::general_purpose::STANDARD.encode(hash.as_bytes())
    }

    /// The manifest a release of `archive` publishes: same fields, same names,
    /// compressed extents read back out of the archive the way the bundler's
    /// `index_zip` reads them.
    fn manifest_for(archive: &[u8], version: &str) -> SignedManifest {
        let mut zip = zip::ZipArchive::new(std::io::Cursor::new(archive)).unwrap();
        let mut files = Vec::new();

        for index in 0..zip.len() {
            let mut file = zip.by_index(index).unwrap();
            let mut content = Vec::new();
            file.read_to_end(&mut content).unwrap();

            files.push(serde_json::json!({
                "path": file.name(),
                "size": content.len(),
                "hash": encoded(blake3::hash(&content)),
                "offset": file.data_start(),
                "length": file.compressed_size(),
                "method": match file.compression() {
                    zip::CompressionMethod::Stored => 0,
                    _ => 8,
                },
            }));
        }

        serde_json::from_value(serde_json::json!({
            "version": version,
            "shell_min_version": "1.0.0",
            "files": files,
            "bundle": {
                "name": "bundle.zip",
                "size": archive.len(),
                "blake3": encoded(blake3::hash(archive)),
            },
        }))
        .unwrap()
    }

    /// A release: an unchanged file, an edited one, and a new one.
    fn release(base: &[u8]) -> (Vec<u8>, SignedManifest) {
        let head = zip_of(&[
            ("index.html", base),
            ("app.js", b"console.log('edited')"),
            ("assets/new.css", b"body { margin: 0 }"),
        ]);

        let manifest = manifest_for(&head, "1.2.0");

        (head, manifest)
    }

    #[test]
    fn unchanged_files_are_reused_and_changed_ones_are_pending() {
        let base = zip_of(&[
            ("index.html", b"<!doctype html>"),
            ("app.js", b"console.log('original')"),
        ]);
        let (_head, manifest) = release(b"<!doctype html>");

        let local = local_file_contents(&base).unwrap();
        let (slots, pending) = plan_reuse(&local, &manifest);

        // index.html is untouched, app.js was edited, assets/new.css is new.
        assert_eq!(slots[0].as_deref(), Some(&b"<!doctype html>"[..]));
        assert_eq!(pending, vec![1, 2]);
    }

    #[test]
    fn an_edited_file_with_an_unchanged_path_is_not_reused() {
        let base = zip_of(&[("index.html", b"<!doctype html>"), ("app.js", b"stale bytes")]);
        let (_head, manifest) = release(b"<!doctype html>");

        let local = local_file_contents(&base).unwrap();
        let (slots, pending) = plan_reuse(&local, &manifest);

        // Same path, different content: the hash is what decides, so the stale
        // copy must not be taken.
        assert!(slots[1].is_none());
        assert!(pending.contains(&1));
    }

    #[test]
    fn assembly_reproduces_every_file_the_manifest_names() {
        let base = zip_of(&[
            ("index.html", b"<!doctype html>"),
            ("app.js", b"console.log('original')"),
        ]);
        let (head, manifest) = release(b"<!doctype html>");

        let local = local_file_contents(&base).unwrap();
        let (mut slots, pending) = plan_reuse(&local, &manifest);

        // Stand in for `fetch_file`: what it returns is the published content,
        // already checked against the manifest's hash.
        let published = local_file_contents(&head).unwrap();
        for index in pending {
            slots[index] = Some(published[&manifest.files[index].path].clone());
        }

        let contents: Vec<Vec<u8>> = slots.into_iter().map(Option::unwrap).collect();
        let assembled = build_archive(&manifest, &contents).unwrap();

        // What appload does at startup: read every entry the manifest names.
        let mut zip = zip::ZipArchive::new(std::io::Cursor::new(&assembled)).unwrap();
        for entry in &manifest.files {
            let mut file = zip.by_name(&entry.path).unwrap();
            let mut content = Vec::new();
            file.read_to_end(&mut content).unwrap();

            assert_eq!(blake3::hash(&content), entry.hash, "{}", entry.path);
        }
    }

    #[test]
    fn a_changed_entry_pulled_by_range_inflates_to_its_manifest_hash() {
        // What `fetch_extent` asks the host for is the compressed bytes, so the
        // unpack step is the one thing between the wire and the hash check.
        let content = b"console.log('a bundle entry that compresses');".repeat(20);
        let head = zip_of(&[("app.js", content.as_slice())]);
        let manifest = manifest_for(&head, "1.2.0");

        let entry = &manifest.files[0];
        assert_eq!(entry.method, 8, "the fixture must exercise deflate");

        let mut zip = zip::ZipArchive::new(std::io::Cursor::new(&head)).unwrap();
        let file = zip.by_index(0).unwrap();
        assert_eq!(file.data_start(), entry.offset);
        assert_eq!(file.compressed_size(), entry.length);

        let extent = &head[entry.offset as usize..(entry.offset + entry.length) as usize];

        assert_eq!(inflate(extent, entry.method).unwrap(), content);
        assert_eq!(blake3::hash(&inflate(extent, entry.method).unwrap()), entry.hash);
    }

    #[test]
    fn a_stored_entry_needs_no_inflating() {
        assert_eq!(inflate(b"plain", 0).unwrap(), b"plain".to_vec());

        let error = inflate(b"plain", 12).expect_err("an unknown method must not be trusted");
        assert!(matches!(error, WebUpdateError::Mismatch(_)), "{error:?}");
    }

    #[test]
    fn nearby_entries_ride_in_one_extent_and_distant_ones_do_not() {
        // Incompressible filler on purpose: anything a deflater can shrink
        // collapses the gap to nothing and the test passes for the wrong
        // reason. Hashes of the index are the cheapest bytes nobody can shrink.
        let filler: Vec<u8> = (0..3_125u32)
            .flat_map(|i| *blake3::hash(&i.to_le_bytes()).as_bytes())
            .collect();

        let archive = zip_of(&[
            ("first.js", b"first"),
            ("filler.bin", filler.as_slice()),
            ("last.js", b"last"),
        ]);
        let manifest = manifest_for(&archive, "1.2.0");

        // The middle entry is not being fetched, so its ~100KB of filler stands
        // between the other two — too much to swallow, so two requests.
        let extents = merge_extents(&manifest, &[0, 2]);
        assert_eq!(extents.len(), 2, "a 100KB gap is not worth merging");
        assert_eq!(extents[0].entries, vec![0]);
        assert_eq!(extents[1].entries, vec![2]);

        // Nothing left out: one request, spanning both ends.
        let extents = merge_extents(&manifest, &[0, 1, 2]);
        assert_eq!(extents.len(), 1);
        assert_eq!(extents[0].entries, vec![0, 1, 2]);
        assert_eq!(extents[0].start, manifest.files[0].offset);
        assert_eq!(
            extents[0].end,
            manifest.files[2].offset + manifest.files[2].length
        );
    }

    /// Opt-in end-to-end against the release host, and the number to quote when
    /// this channel is tuned. Point `HOPP_WEB_UPDATE_RELEASE` at a directory
    /// holding a release's `manifest.json` and `HOPP_WEB_UPDATE_BASE` at a
    /// `bundle.zip` from an earlier release, then run with network access:
    ///
    /// ```sh
    /// HOPP_WEB_UPDATE_RELEASE=/tmp/release HOPP_WEB_UPDATE_BASE=/tmp/base \
    ///   cargo test incremental_assembly_against -- --nocapture
    /// ```
    ///
    /// The entry fetches are real Range requests against the published archive,
    /// so this is the whole incremental path bar the signature check and the
    /// write into the update directory.
    #[test]
    fn incremental_assembly_against_the_release_host_when_fixtures_are_supplied() {
        let Ok(release_dir) = std::env::var("HOPP_WEB_UPDATE_RELEASE") else {
            return;
        };
        let Ok(base_dir) = std::env::var("HOPP_WEB_UPDATE_BASE") else {
            return;
        };

        let manifest_bytes =
            fs::read(Path::new(&release_dir).join(MANIFEST_FILE_NAME)).expect("release manifest");
        let manifest: SignedManifest = serde_json::from_slice(&manifest_bytes).unwrap();
        let base = fs::read(Path::new(&base_dir).join(BUNDLE_FILE_NAME)).expect("base bundle");

        let local = local_file_contents(&base).unwrap();
        let (mut slots, pending) = plan_reuse(&local, &manifest);

        // The same URL the app derives from `plugins.updater.endpoints`.
        let url = "https://github.com/Triple3h/hoppscotch/releases/latest/download/bundle.zip";

        tauri::async_runtime::block_on(async {
            let client = http_client().unwrap();
            let fetched = fetch_pending(&client, url, &manifest, &mut slots, &pending)
                .await
                .expect("fetch");

            let whole = manifest.bundle.as_ref().unwrap().size;
            eprintln!(
                "incremental: {} of {} files reused, {} fetched in {} extents; {} KB over the wire against {} KB whole ({:.1}%)",
                manifest.files.len() - pending.len(),
                manifest.files.len(),
                pending.len(),
                merge_extents(&manifest, &pending).len(),
                fetched / 1024,
                whole / 1024,
                100.0 * fetched as f64 / whole as f64,
            );

            let contents: Vec<Vec<u8>> = slots.into_iter().map(Option::unwrap).collect();
            let assembled = build_archive(&manifest, &contents).unwrap();

            // Exactly what appload does with it at startup.
            let mut zip = zip::ZipArchive::new(std::io::Cursor::new(&assembled)).unwrap();
            for entry in &manifest.files {
                zip.by_name(&entry.path)
                    .unwrap_or_else(|e| panic!("{}: {e}", entry.path));
            }
        });
    }
}
