/// This is just `webapp-server`'s bundler part as a CLI
use std::collections::HashMap;
use std::fs::File;
use std::io::{Cursor, Write};
use std::path::PathBuf;

use clap::Parser;
use rayon::prelude::*;
use thiserror::Error;
use walkdir::WalkDir;
use zip::{ZipArchive, ZipWriter, write::SimpleFileOptions};

#[derive(Error, Debug)]
pub enum BundlerError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("ZIP error: {0}")]
    Zip(#[from] zip::result::ZipError),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("Invalid path: {0}")]
    InvalidPath(String),

    #[error("Configuration error: {0}")]
    Config(String),
}

type Result<T> = std::result::Result<T, BundlerError>;

#[derive(Parser, Debug)]
#[command(author, version, about = "Creates a bundle from a directory")]
struct Args {
    /// Path to the directory to bundle
    #[arg(short, long)]
    input: PathBuf,

    /// Output path for the bundle
    #[arg(short, long)]
    output: PathBuf,

    /// Path to save the manifest file (optional)
    #[arg(short, long)]
    manifest: Option<PathBuf>,

    /// Custom version for the bundle (defaults to CLI tool version)
    #[arg(short, long)]
    version: Option<String>,

    /// Lowest shell (desktop app) version that can load this bundle. A client
    /// running an older shell must take the full app-update path instead of
    /// applying this bundle incrementally.
    #[arg(long, default_value = "0.0.0")]
    shell_min_version: String,
}

#[derive(serde::Serialize)]
struct FileEntry {
    path: String,
    size: u64,
    #[serde(with = "hash_serde")]
    hash: blake3::Hash,
    mime_type: Option<String>,
    /// Byte offset of this entry's compressed data inside the zip. Together
    /// with `length` it lets an updating client fetch one file with a single
    /// HTTP Range request instead of downloading the whole bundle.
    offset: u64,
    /// Compressed size in bytes, i.e. what a Range request has to ask for.
    length: u64,
    /// ZIP compression method (0 = stored, 8 = deflate). The client needs it to
    /// inflate whatever a Range request hands back.
    method: u16,
}

#[derive(serde::Serialize)]
struct Manifest {
    files: Vec<FileEntry>,
    version: String,
    created_at: chrono::DateTime<chrono::Utc>,
    /// Compatibility gate for incremental updates; see `--shell-min-version`.
    shell_min_version: String,
    /// Whole-archive facts, used by the client's full-download fallback and by
    /// tooling that wants to check a bundle it has on disk.
    bundle: BundleInfo,
}

#[derive(serde::Serialize)]
struct BundleInfo {
    name: String,
    size: u64,
    #[serde(with = "hash_serde")]
    blake3: blake3::Hash,
}

mod hash_serde {
    use base64::{Engine, engine::general_purpose::STANDARD};
    use serde::Serializer;

    pub fn serialize<S>(hash: &blake3::Hash, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&STANDARD.encode(hash.as_bytes()))
    }
}

struct BundleBuilder {
    writer: ZipWriter<Cursor<Vec<u8>>>,
    files: Vec<FileEntry>,
}

impl BundleBuilder {
    fn new<P: AsRef<std::path::Path>>(input_path: P) -> Result<Self> {
        let input_path = input_path.as_ref();

        if !input_path.exists() {
            return Err(BundlerError::Config(format!(
                "Input path {} does not exist",
                input_path.display()
            )));
        }

        struct FileInfo {
            relative_path: String,
            content: Vec<u8>,
            hash: blake3::Hash,
            size: u64,
            mime_type: Option<String>,
        }

        let file_infos: Vec<FileInfo> = WalkDir::new(input_path)
            .into_iter()
            .filter_map(|entry| entry.ok())
            .filter(|entry| entry.file_type().is_file())
            .par_bridge()
            .map(|entry| {
                let path = entry.path();
                let relative_path = path
                    .strip_prefix(input_path)
                    .unwrap()
                    .components()
                    .map(|comp| comp.as_os_str().to_string_lossy())
                    .collect::<Vec<_>>()
                    .join("/");

                let content = std::fs::read(path).map_err(|e| {
                    BundlerError::Config(format!("Failed to read file {}: {}", path.display(), e))
                })?;

                let hash = blake3::hash(&content);
                let size = content.len() as u64;

                let mime_type = mime_guess::from_path(path)
                    .first()
                    .map(|mime| mime.to_string());

                Ok(FileInfo {
                    relative_path,
                    content,
                    hash,
                    size,
                    mime_type,
                })
            })
            .collect::<Result<Vec<_>>>()?;

        let mut builder = Self {
            writer: ZipWriter::new(Cursor::new(Vec::new())),
            files: Vec::with_capacity(file_infos.len()),
        };

        for file_info in file_infos {
            let options = SimpleFileOptions::default().unix_permissions(0o644);

            builder
                .writer
                .start_file(&file_info.relative_path, options)
                .map_err(|e| BundlerError::Config(format!("Failed to start file in zip: {}", e)))?;

            builder
                .writer
                .write_all(&file_info.content)
                .map_err(|e| BundlerError::Config(format!("Failed to write file to zip: {}", e)))?;

            builder.files.push(FileEntry {
                path: file_info.relative_path,
                size: file_info.size,
                hash: file_info.hash,
                mime_type: file_info.mime_type,
                // Filled in by `index_zip` once the archive is final; offsets
                // only exist after every entry has been written.
                offset: 0,
                length: 0,
                method: 0,
            });
        }

        Ok(builder)
    }

    fn finish(self) -> Result<(Vec<u8>, Vec<FileEntry>)> {
        let writer = self
            .writer
            .finish()
            .map_err(|e| BundlerError::Config(format!("Failed to finish zip archive: {}", e)))?;

        Ok((writer.into_inner(), self.files))
    }
}

/// ZIP spec compression method code (0 = stored, 8 = deflate). The crate's
/// `to_u16` is deprecated in favour of matching on constants, but an integer is
/// exactly what the manifest — and therefore the client's Range + inflate step
/// — needs, so the conversion stays in one place here.
#[allow(deprecated)]
fn method_code(method: zip::CompressionMethod) -> u16 {
    method.to_u16()
}

/// Fills in `offset` / `length` / `method` for every entry by reading the
/// finished archive back.
///
/// The values are read from the produced zip rather than predicted while
/// writing: local headers carry extra fields (unix permissions), so computing
/// where an entry's data starts is easy to get subtly wrong, and a wrong offset
/// would make a client's Range request return the wrong bytes.
fn index_zip(content: &[u8], files: &mut [FileEntry]) -> Result<()> {
    let index_by_path: HashMap<String, usize> = files
        .iter()
        .enumerate()
        .map(|(index, file)| (file.path.clone(), index))
        .collect();

    let mut archive = ZipArchive::new(Cursor::new(content))?;

    for archive_index in 0..archive.len() {
        let file = archive.by_index(archive_index)?;

        let Some(&index) = index_by_path.get(file.name()) else {
            continue;
        };

        let entry = &mut files[index];
        entry.offset = file.data_start();
        entry.length = file.compressed_size();
        entry.method = method_code(file.compression());
    }

    Ok(())
}

fn main() -> Result<()> {
    let args = Args::parse();

    if !args.input.exists() {
        return Err(BundlerError::InvalidPath(format!(
            "Input path does not exist: {}",
            args.input.display()
        )));
    }

    println!("Creating bundle from directory: {}", args.input.display());

    let builder = BundleBuilder::new(&args.input)?;
    let (content, mut files) = builder.finish()?;

    // Offsets are only knowable once the archive is complete.
    index_zip(&content, &mut files)?;

    let version = args.version
        .or_else(|| std::env::var("WEBAPP_BUNDLE_VERSION").ok())
        .unwrap_or_else(|| env!("CARGO_PKG_VERSION").to_string());
    println!("Using bundle version: {}", version);
    println!("Shell compatibility: >= {}", args.shell_min_version);

    let mut output_file = File::create(&args.output)?;
    output_file.write_all(&content)?;
    println!("Bundle written to: {}", args.output.display());

    let manifest = Manifest {
        files,
        version,
        created_at: chrono::Utc::now(),
        shell_min_version: args.shell_min_version.clone(),
        bundle: BundleInfo {
            name: args
                .output
                .file_name()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or_else(|| "bundle.zip".to_string()),
            size: content.len() as u64,
            blake3: blake3::hash(&content),
        },
    };

    if let Some(manifest_path) = args.manifest {
        let manifest_json = serde_json::to_string_pretty(&manifest)?;
        std::fs::write(manifest_path.clone(), manifest_json)?;
        println!("Manifest written to: {}", manifest_path.display());
    }

    println!(
        "Bundle created successfully with {} files",
        manifest.files.len()
    );

    Ok(())
}
