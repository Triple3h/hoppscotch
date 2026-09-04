#!/usr/bin/env node
/**
 * Sets the version of the hoppscotch-desktop package in every place that
 * contributes to the built app / installer name. Run from the repository root.
 *
 *   node .github/scripts/set-desktop-version.mjs 1.0.0
 *
 * Files touched:
 *   - packages/hoppscotch-desktop/package.json
 *   - packages/hoppscotch-desktop/src-tauri/tauri.conf.json
 *   - packages/hoppscotch-desktop/src-tauri/tauri.portable.{macos,windows}.conf.json
 *   - packages/hoppscotch-desktop/src-tauri/Cargo.toml
 *   - packages/hoppscotch-desktop/src-tauri/Cargo.lock
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const version = process.argv[2]
if (!/^\d+\.\d+\.\d+/.test(version ?? '')) {
  console.error(`Invalid version argument: ${version ?? '(missing)'}`)
  process.exit(1)
}

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const desktopDir = join(repoRoot, 'packages', 'hoppscotch-desktop')

// package.json
const pkgPath = join(desktopDir, 'package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
pkg.version = version
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)

// Tauri configs
for (const file of [
  'src-tauri/tauri.conf.json',
  'src-tauri/tauri.portable.macos.conf.json',
  'src-tauri/tauri.portable.windows.conf.json',
]) {
  const confPath = join(desktopDir, file)
  const conf = JSON.parse(readFileSync(confPath, 'utf8'))
  conf.version = version
  writeFileSync(confPath, `${JSON.stringify(conf, null, 2)}\n`)
}

// Cargo.toml (package version line only)
const cargoPath = join(desktopDir, 'src-tauri', 'Cargo.toml')
const cargo = readFileSync(cargoPath, 'utf8').replace(
  /(^name = "hoppscotch-desktop"[\s\S]*?^version = ")[^"]+(")$/m,
  `$1${version}$2`,
)
writeFileSync(cargoPath, cargo)

// Cargo.lock (root crate entry)
const lockPath = join(desktopDir, 'src-tauri', 'Cargo.lock')
const lock = readFileSync(lockPath, 'utf8').replace(
  /(\[\[package\]\]\nname = "hoppscotch-desktop"\nversion = ")[^"]+(")/,
  `$1${version}$2`,
)
writeFileSync(lockPath, lock)

console.log(`hoppscotch-desktop version set to ${version}`)
