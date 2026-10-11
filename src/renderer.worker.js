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

self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'init') { await initialize(); return }
    if (data.type !== 'render' || !engine) return
    const start = performance.now()
    const p = data.params
    if (p.width !== width || p.height !== height || !patternKey) {
      width = p.width; height = p.height
      engine.init(width, height)
    }
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
    const pointer = engine.render(p.cameraAz, p.cameraEl, p.lightAz, p.lightEl, p.sourceSize, p.mode)
    const pixels = new Uint8ClampedArray(engine.memory.buffer, pointer, width * height * 4).slice().buffer
    const result = { type: 'frame', id: data.id, pixels, width, height, duration: performance.now() - start, count: engine.scratch_count(), rays: width * height, geometry, span: engine.arc_span() }
    self.postMessage(result, geometry ? [pixels, geometry] : [pixels])
  } catch (error) {
    self.postMessage({ type: 'error', message: error.message })
  }
}
