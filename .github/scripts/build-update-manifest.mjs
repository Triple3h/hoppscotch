#!/usr/bin/env node
/**
 * Builds the Tauri updater manifest JSON from a directory of release assets.
 *
 * Expected asset naming (produced by release-desktop.yml "Prepare artifacts"):
 *   hoppscotch-desktop_<version>_linux_x86_64.AppImage[.sig]
 *   hoppscotch-desktop_<version>_windows_x86_64-setup.exe[.sig]
 *   hoppscotch-desktop_<version>_macos_<x86_64|aarch64>.app.tar.gz[.sig]
 *
 * The updater signature for an artifact `<file>` always lives at `<file>.sig`
 * (content is identical regardless of the artifact being renamed later).
 *
 * Usage:
 *   node build-update-manifest.mjs \
 *     --assets <dir> --version <v> --repo <owner/repo> --tag <vX.Y.Z> \
 *     --notes <notes-file> --output <out.json>
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

function arg(name) {
  const idx = process.argv.indexOf(`--${name}`)
  if (idx === -1 || !process.argv[idx + 1]) {
    console.error(`Missing required --${name} argument`)
    process.exit(1)
  }
  return process.argv[idx + 1]
}

const assetsDir = arg('assets')
const version = arg('version')
const repo = arg('repo')
const tag = arg('tag')
const notesFile = arg('notes')
const output = arg('output')

const baseUrl = `https://github.com/${repo}/releases/download/${tag}`

// Map an asset file name to its Tauri updater platform key.
const platformRules = [
  { match: (f) => f.endsWith('_linux_x86_64.AppImage'), key: 'linux-x86_64' },
  { match: (f) => f.endsWith('_windows_x86_64-setup.exe'), key: 'windows-x86_64' },
  { match: (f) => f.endsWith('_macos_aarch64.app.tar.gz'), key: 'darwin-aarch64' },
  { match: (f) => f.endsWith('_macos_x86_64.app.tar.gz'), key: 'darwin-x86_64' },
]

const platforms = {}
for (const file of readdirSync(assetsDir)) {
  const rule = platformRules.find((r) => r.match(file))
  if (!rule) continue // dmg/msi/deb/app.zip etc. are not updater artifacts

  const sigPath = join(assetsDir, `${file}.sig`)
  if (!existsSync(sigPath)) {
    console.warn(`Skipping ${rule.key}: missing signature file ${file}.sig`)
    continue
  }

  const signature = readFileSync(sigPath, 'utf8').trim()
  platforms[rule.key] = {
    signature,
    url: `${baseUrl}/${file}`,
  }
  console.log(`manifest: added ${rule.key} -> ${file}`)
}

if (Object.keys(platforms).length === 0) {
  console.error('No updater artifacts found; refusing to write an empty manifest')
  process.exit(1)
}

const notes = existsSync(notesFile) ? readFileSync(notesFile, 'utf8') : ''

const manifest = {
  version,
  notes,
  pub_date: new Date().toISOString(),
  platforms,
}

writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`Wrote update manifest to ${output}`)
