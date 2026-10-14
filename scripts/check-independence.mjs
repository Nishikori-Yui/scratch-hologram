import { readdir, readFile, lstat } from 'node:fs/promises'
import { resolve, dirname, relative, sep } from 'node:path'
import assert from 'node:assert/strict'

const root = resolve(import.meta.dirname, '..')
let checked = 0
async function scan(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = resolve(directory, entry.name)
    assert.equal((await lstat(file)).isSymbolicLink(), false, `Symlink: ${relative(root, file)}`)
    if (entry.isDirectory()) {
      if (entry.name !== 'target') await scan(file)
      continue
    }
    if (!/\.(?:m?[jt]s|vue|css|json|html)$/.test(file)) continue
    const text = await readFile(file, 'utf8')
    assert.equal(text.includes('/' + 'Users/'), false, `Absolute local path: ${relative(root, file)}`)
    const references = [
      ...text.matchAll(/(?:from\s+|import\s+|new URL\(\s*)['"]([^'"]+)['"]/g),
      ...text.matchAll(/url\(['"]?([^)'"\s]+)['"]?\)/g),
    ]
    for (const [, reference] of references) {
      if (reference.startsWith('data:') || reference.startsWith('node:') || reference.startsWith('#')) continue
      if (!reference.startsWith('.')) {
        if (reference === 'vue' || reference === '@playwright/test') continue
        throw new Error(`Unexpected external reference ${reference} in ${relative(root, file)}`)
      }
      const destination = resolve(dirname(file), reference.split('?')[0])
      const local = relative(root, destination)
      assert.ok(local !== '..' && !local.startsWith(`..${sep}`), `Import escapes repository: ${reference}`)
      assert.equal((await lstat(destination)).isSymbolicLink(), false, `Linked import: ${reference}`)
      checked++
    }
  }
}
await scan(resolve(root, 'src'))
await scan(resolve(root, 'scripts'))
console.log(`Independent source verified: ${checked} local imports/assets, no sibling paths or symlinks`)
