import { mkdir, copyFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
execFileSync('cargo', ['build', '--manifest-path', resolve(root, 'wasm/Cargo.toml'), '--target', 'wasm32-unknown-unknown', '--release'], { cwd: root, stdio: 'inherit' })
await mkdir(resolve(root, 'public/wasm'), { recursive: true })
await copyFile(resolve(root, 'wasm/target/wasm32-unknown-unknown/release/hologram_renderer.wasm'), resolve(root, 'public/wasm/hologram.wasm'))
console.log('WASM copied to public/wasm/hologram.wasm')
