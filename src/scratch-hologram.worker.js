import wasmUrl from './assets/scratch-hologram.wasm?url'
import { patternKeyFor } from './scratch-hologram-render.js'
import { createGpuRenderer } from './scratch-hologram-webgpu.js'

let engine
let gpu
let width = 0
let height = 0
let patternKey = ''
let gpuPatternKey = ''
let cpuScale = 1
let backendError
let adapterInfo
let messageQueue = Promise.resolve()

async function initialize(backend) {
  const response = await fetch(wasmUrl, { cache: 'force-cache' })
  if (!response.ok)
    throw new Error(`Cannot load WASM (HTTP ${response.status})`)
  const { instance } = await WebAssembly.instantiate(await response.arrayBuffer(), {})
  engine = instance.exports
  if (backend !== 'wasm') {
    try {
      gpu = await createGpuRenderer()
      adapterInfo = gpu?.adapterInfo
    }
    catch (error) {
      backendError = error.message
    }
  }
  if (backend === 'webgpu' && !gpu)
    throw new Error(backendError || 'WebGPU is unavailable')
  globalThis.postMessage({ type: 'ready', backend: gpu ? 'webgpu' : 'wasm', backendError, adapterInfo, capabilities: { webgpu: Boolean(globalThis.navigator?.gpu), offscreenCanvas: typeof OffscreenCanvas !== 'undefined', secureContext: globalThis.isSecureContext } })
}

function configurePattern(p) {
  const key = p.patternKey ?? patternKeyFor(p)
  if (key === patternKey)
    return
  if (p.animationPoints) {
    const values = p.animationPoints
    const pointer = engine.alloc(values.length)
    new Float32Array(engine.memory.buffer, pointer, values.length).set(values)
    engine.configure_rotary(pointer, values.length / 4, p.depth)
    engine.dealloc(pointer, values.length)
  }
  else if (p.customPoints) {
    const values = p.customPoints
    const pointer = engine.alloc(values.length)
    new Float32Array(engine.memory.buffer, pointer, values.length).set(values)
    engine.configure_points(pointer, values.length / 3, p.depth)
    engine.dealloc(pointer, values.length)
  }
  else {
    engine.configure(p.shape, p.depth, p.samplingDensity)
  }
  patternKey = key
  cpuScale = 1
  return new Float32Array(engine.memory.buffer, engine.geometry_ptr(), engine.scratch_count() * 8).slice().buffer
}

async function renderFrame(params, pixelsOnly = false) {
  const start = performance.now()
  const geometry = configurePattern(params)
  const base = { geometry, count: engine.scratch_count(), span: engine.arc_span() }
  // SVG mode consumes only geometry, never an invisible raster frame.
  if (params.mode === 1 && !pixelsOnly)
    return { ...base, backend: 'geometry', duration: performance.now() - start }
  if (gpu && !pixelsOnly) {
    try {
      if (gpuPatternKey !== patternKey) {
        await gpu.setPattern(engine)
        gpuPatternKey = patternKey
      }
      const bitmap = await gpu.render(params)
      return { ...base, bitmap, width: params.width, height: params.height, backend: 'webgpu', duration: performance.now() - start }
    }
    catch (error) {
      backendError = error.message
      gpu.destroy()
      gpu = null
    }
  }
  const scale = params.realtime && !pixelsOnly ? Math.max(cpuScale, 160 / params.width, 120 / params.height) : 1
  const w = Math.max(160, Math.round(params.width * scale))
  const h = Math.max(120, Math.round(params.height * scale))
  if (w !== width || h !== height) {
    width = w
    height = h
    engine.init(width, height)
  }
  engine.set_disc(params.discAz ?? 0, params.discEl ?? 0, params.material ?? 0)
  engine.set_spin(params.spin ?? 0)
  const renderStart = performance.now()
  const pointer = engine.render(params.cameraAz, params.cameraEl, params.lightAz, params.lightEl, params.sourceSize, params.mode)
  const duration = performance.now() - renderStart
  const pixels = new Uint8ClampedArray(engine.memory.buffer, pointer, width * height * 4).slice().buffer
  if (params.realtime && !pixelsOnly)
    cpuScale = Math.max(0.25, Math.min(1, scale * Math.sqrt(24 / Math.max(duration, 1))))
  return { ...base, pixels, width, height, backend: 'wasm', backendError, duration: performance.now() - start }
}

async function handleMessage(data) {
  if (data.type === 'init') {
    await initialize(data.backend)
    return
  }
  if (!engine)
    return
  if (data.type === 'prewarm-orbit') {
    for (let index = 0; index < data.angles.length; index++) {
      const cameraAz = data.angles[index]
      const frame = await renderFrame({ ...data.params, cameraAz }, true)
      globalThis.postMessage({ ...frame, type: 'orbit-frame', index, total: data.angles.length, cameraAz }, [frame.pixels])
    }
    globalThis.postMessage({ type: 'orbit-complete', total: data.angles.length })
    return
  }
  if (data.type !== 'render')
    return
  const frame = await renderFrame(data.params)
  const transfers = [frame.bitmap, frame.pixels, frame.geometry].filter(Boolean)
  globalThis.postMessage({ ...frame, backendError, adapterInfo, type: 'frame', id: data.id, exportRequested: data.exportRequested }, transfers)
}

globalThis.onmessage = ({ data }) => {
  // Async GPU submissions remain ordered even if a caller posts several messages.
  messageQueue = messageQueue.then(() => handleMessage(data)).catch((error) => {
    globalThis.postMessage({ type: 'error', message: error.message })
  })
}
