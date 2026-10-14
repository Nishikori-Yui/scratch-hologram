import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

async function load() {
  const bytes = await readFile(new URL('../src/assets/scratch-hologram.wasm', import.meta.url))
  const { instance } = await WebAssembly.instantiate(bytes, {})
  return instance.exports
}

function configureCustom(wasm, values, depth = 1) {
  const pointer = wasm.alloc(values.length)
  try {
    new Float32Array(wasm.memory.buffer, pointer, values.length).set(values)
    wasm.configure_points(pointer, values.length / 3, depth)
  } finally {
    wasm.dealloc(pointer, values.length)
  }
}

function geometry(wasm) {
  return new Float32Array(wasm.memory.buffer, wasm.geometry_ptr(), wasm.scratch_count() * 8).slice()
}

test('WASM exposes the camera-ray renderer and produces a frame', async () => {
  const wasm = await load()
  assert.equal(typeof wasm.render, 'function')
  wasm.init(160, 120)
  wasm.configure(0, 1, 1)
  assert.equal(wasm.scratch_count(), 264)
  const pointer = wasm.render(0, 20, 0, 55, 0.8, 0)
  const pixels = new Uint8Array(wasm.memory.buffer, pointer, 160 * 120 * 4)
  assert.equal(pixels.length, 76800)
  const alphas = Array.from(pixels).filter((_, index) => index % 4 === 3)
  assert.ok(alphas.includes(255), 'disc pixels should be opaque')
  assert.ok(alphas.includes(0), 'outside the disc should allow a transparent background')
  const litEnergy = pixels.reduce((sum, value) => sum + value, 0)
  assert.ok(litEnergy > 100000, 'rendered frame should contain visible geometry')
})

test('WASM pattern presets change their encoded geometry', async () => {
  const wasm = await load()
  wasm.init(160, 120)
  wasm.configure(1, 1, 1)
  assert.equal(wasm.scratch_count(), 495)
  const helix = wasm.render(16, 22, 25, 56, 0.8, 0)
  const frameA = new Uint8Array(wasm.memory.buffer, helix, 160 * 120 * 4).slice()
  wasm.configure(2, 0.7, 1)
  assert.equal(wasm.scratch_count(), 1)
  const arc = wasm.render(-14, 18, -35, 42, 2.2, 0)
  const frameB = new Uint8Array(wasm.memory.buffer, arc, 160 * 120 * 4)
  assert.notDeepEqual(frameA, frameB)
})

test('SVG geometry replaces the cube, previous imports and spatial index', async () => {
  const wasm = await load()
  wasm.init(160, 120)
  wasm.configure(0, 1, 1)
  const signature = new Float32Array([-0.5, 0.1, -0.46, 0, 0.1, -0.46, 0.5, 0.1, -0.46])
  configureCustom(wasm, signature)
  assert.equal(wasm.scratch_count(), 3, 'must replace the 264 cube scratches')
  const encoded = geometry(wasm)
  for (let i = 0; i < 3; i++) {
    assert.deepEqual(encoded.slice(i * 8 + 5, i * 8 + 8), signature.slice(i * 3, i * 3 + 3))
  }
  const pointer = wasm.render(0, 20, 0, 55, 0.8, 0)
  const afterCube = new Uint8Array(wasm.memory.buffer, pointer, 160 * 120 * 4).slice()
  const fresh = await load()
  fresh.init(160, 120)
  configureCustom(fresh, signature)
  const freshPointer = fresh.render(0, 20, 0, 55, 0.8, 0)
  assert.deepEqual(afterCube, new Uint8Array(fresh.memory.buffer, freshPointer, 160 * 120 * 4), 'frame must contain no stale cube cells')
  configureCustom(wasm, signature.subarray(0, 3))
  assert.equal(wasm.scratch_count(), 1, 'reimport must also replace geometry')
  wasm.configure(1, 1, 1)
  assert.equal(wasm.scratch_count(), 495, 'switching to a preset must remove custom geometry')
})

test('custom depth changes radius without accumulating scratches', async () => {
  const wasm = await load()
  const points = new Float32Array([0.1, -0.1, -0.46])
  configureCustom(wasm, points, 0.5)
  const shallow = geometry(wasm)
  configureCustom(wasm, points, 1.5)
  const deep = geometry(wasm)
  assert.equal(wasm.scratch_count(), 1)
  assert.ok(deep[2] > shallow[2])
  assert.ok(Math.abs(deep[7] - points[2] * 1.5) < 1e-6)
})
