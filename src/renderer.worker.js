let engine
let width = 640
let height = 480
let patternKey = ''

async function initialize() {
  const response = await fetch('/wasm/hologram.wasm', { cache: 'no-store' })
  if (!response.ok) throw new Error(`无法载入 WASM（HTTP ${response.status}），请运行 npm run build:wasm。`)
  const bytes = await response.arrayBuffer()
  const { instance } = await WebAssembly.instantiate(bytes, {})
  engine = instance.exports
  self.postMessage({ type: 'ready' })
}

function configurePattern(p) {
  const key = p.customPoints ? `custom:${p.customId}:${p.depth}:${p.customPoints.length}` : `${p.shape}/${p.depth}/${p.samplingDensity}`
  let geometry
  if (key !== patternKey) {
    if (p.customPoints) {
      const values = p.customPoints
      const pointer = engine.alloc(values.length)
      new Float32Array(engine.memory.buffer, pointer, values.length).set(values)
      engine.configure_points(pointer, values.length / 3, p.depth)
      engine.dealloc(pointer, values.length)
    } else {
      engine.configure(p.shape, p.depth, p.samplingDensity)
    }
    patternKey = key
    const scratchCount = engine.scratch_count()
    geometry = new Float32Array(engine.memory.buffer, engine.geometry_ptr(), scratchCount * 8).slice().buffer
  }
  return geometry
}

function renderPixels(p) {
  if (p.width !== width || p.height !== height || !patternKey) {
    width = p.width; height = p.height
    engine.init(width, height)
    patternKey = ''
  }
  const geometry = configurePattern(p)
  const pointer = engine.render(p.cameraAz, p.cameraEl, p.lightAz, p.lightEl, p.sourceSize, p.mode)
  const pixels = new Uint8ClampedArray(engine.memory.buffer, pointer, width * height * 4).slice()
  return { pixels, geometry, width, height, count: engine.scratch_count(), span: engine.arc_span() }
}

async function prewarmOrbit({ params, angles }) {
  for (let index = 0; index < angles.length; index += 1) {
    const frame = renderPixels({ ...params, cameraAz: angles[index] })
    const pixels = frame.pixels.buffer
    self.postMessage({ type: 'orbit-frame', index, total: angles.length, cameraAz: angles[index], pixels, width: frame.width, height: frame.height, count: frame.count, span: frame.span }, [pixels])
    // Yield between expensive high-resolution frames so the worker can be stopped
    // promptly when the page is closed or a new prewarm request is issued.
    await new Promise(resolve => setTimeout(resolve, 0))
  }
  self.postMessage({ type: 'orbit-complete', total: angles.length })
}

self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'init') { await initialize(); return }
    if (data.type === 'prewarm-orbit' && engine) { await prewarmOrbit(data); return }
    if (data.type !== 'render' || !engine) return
    const start = performance.now()
    const p = data.params
    const frame = renderPixels(p)
    const pixels = frame.pixels.buffer
    const result = { type: 'frame', id: data.id, pixels, width: frame.width, height: frame.height, duration: performance.now() - start, count: frame.count, rays: frame.width * frame.height, geometry: frame.geometry, span: frame.span }
    self.postMessage(result, frame.geometry ? [pixels, frame.geometry] : [pixels])
  } catch (error) {
    self.postMessage({ type: 'error', message: error.message })
  }
}
