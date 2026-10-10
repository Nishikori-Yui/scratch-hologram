let engine
let width = 640
let height = 480
let patternKey = ''
let lastFrameKey = ''
let lastFrame = null
let queuedRender = null
let processing = false

async function initialize() {
  const response = await fetch('/wasm/hologram.wasm', { cache: 'no-store' })
  if (!response.ok) throw new Error(`无法载入 WASM（HTTP ${response.status}），请运行 npm run build:wasm。`)
  const bytes = await response.arrayBuffer()
  const { instance } = await WebAssembly.instantiate(bytes, {})
  engine = instance.exports
  self.postMessage({ type: 'ready' })
}

async function renderFrame(data) {
    const start = performance.now()
    const p = data.params
    if (p.width !== width || p.height !== height || !patternKey) {
      width = p.width; height = p.height
      engine.init(width, height)
      lastFrameKey = ''
      lastFrame = null
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
  const frameKey = `${width}x${height}/${p.cameraAz}/${p.cameraEl}/${p.lightAz}/${p.lightEl}/${p.sourceSize}/${p.discAz}/${p.discEl}/${p.mode}/${patternKey}`
    if (frameKey === lastFrameKey && lastFrame) {
      const pixels = lastFrame.pixels.slice().buffer
      const cachedGeometry = lastFrame.geometry ? lastFrame.geometry.slice().buffer : geometry
      const result = { type: 'frame', id: data.id, pixels, width, height, duration: performance.now() - start, count: lastFrame.count, rays: width * height, geometry: cachedGeometry, span: lastFrame.span }
      self.postMessage(result, cachedGeometry ? [pixels, cachedGeometry] : [pixels])
      return
    }
  const pointer = engine.render_object(p.cameraAz, p.cameraEl, p.lightAz, p.lightEl, p.sourceSize, p.mode, p.discAz, p.discEl)
    const pixelsView = new Uint8ClampedArray(engine.memory.buffer, pointer, width * height * 4)
    const pixels = pixelsView.slice().buffer
    const geometryBuffer = geometry || null
    lastFrameKey = frameKey
    lastFrame = { pixels: pixelsView.slice(), geometry: geometryBuffer ? new Float32Array(geometryBuffer).slice() : null, count: engine.scratch_count(), span: engine.arc_span() }
    const result = { type: 'frame', id: data.id, pixels, width, height, duration: performance.now() - start, count: lastFrame.count, rays: width * height, geometry: geometryBuffer, span: lastFrame.span }
    self.postMessage(result, geometryBuffer ? [pixels, geometryBuffer] : [pixels])
}

async function drainRenderQueue() {
  if (processing || !engine) return
  processing = true
  while (queuedRender) {
    const data = queuedRender
    queuedRender = null
    try {
      await renderFrame(data)
    } catch (error) {
      self.postMessage({ type: 'error', message: error.message })
    }
    // Give queued pointer moves a chance to arrive. Intermediate frames are
    // discarded, so the next pass renders the newest camera/light state.
    await new Promise(resolve => setTimeout(resolve, 0))
  }
  processing = false
}

self.onmessage = async ({ data }) => {
  if (data.type === 'init') {
    try { await initialize(); drainRenderQueue() }
    catch (error) { self.postMessage({ type: 'error', message: error.message }) }
    return
  }
  if (data.type !== 'render') return
  queuedRender = data
  drainRenderQueue()
}
