import shader from './scratch-hologram.wgsl?raw'

const radians = degrees => degrees * Math.PI / 180
const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
function orbit(azimuth, elevation, distance) {
  const a = radians(azimuth)
  const e = radians(elevation)
  return [distance * Math.sin(a) * Math.cos(e), distance * Math.sin(e), distance * Math.cos(a) * Math.cos(e)]
}
function unit(v) {
  const length = Math.hypot(...v) || 1
  return v.map(value => value / length)
}
function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

function uniforms(p, span) {
  const camera = orbit(clamp(p.cameraAz, -70, 70), clamp(p.cameraEl, -60, 65), 4.2)
  const light = orbit(clamp(p.lightAz, -80, 80), clamp(p.lightEl, -70, 90), 4)
  const az = radians(clamp(p.discAz ?? 0, -35, 35))
  const el = radians(clamp(p.discEl ?? 0, -35, 35))
  const spin = radians(p.spin ?? 0)
  const x = [Math.cos(az), 0, -Math.sin(az)]
  const y = [-Math.sin(az) * Math.sin(el), Math.cos(el), -Math.cos(az) * Math.sin(el)]
  const normal = [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)]
  const discX = x.map((value, i) => value * Math.cos(spin) + y[i] * Math.sin(spin))
  const discY = x.map((value, i) => -value * Math.sin(spin) + y[i] * Math.cos(spin))
  const wallZ = -Math.max(0.32, Math.sqrt(Math.max(0, 1 - normal[2] ** 2)) + 0.045 + 0.12)
  const rotary = Boolean(p.rotary ?? p.animationPoints)
  const fov = rotary ? 0.58 / 4.2 : Math.tan(radians(50 + (-wallZ - 0.32) * 16) * 0.5)
  const right = unit(cross(camera.map(value => -value), [0, 1, 0]))
  const up = unit(cross(right, camera.map(value => -value)))
  return new Float32Array([
    ...camera,
    fov,
    ...light,
    radians(0.35 + clamp(p.sourceSize, 0, 8) * 0.5),
    ...discX,
    wallZ,
    ...discY,
    2 * 4.2 * fov / p.height,
    ...normal,
    Math.cos(span),
    ...right,
    Number(rotary),
    ...up,
    p.width,
    p.height,
    p.material ?? 0,
    Number(p.mode === 1),
    0,
  ])
}

export async function createGpuRenderer() {
  if (!globalThis.navigator?.gpu)
    throw new Error('WebGPU API is unavailable in this browser or context')
  if (typeof OffscreenCanvas === 'undefined')
    throw new Error('OffscreenCanvas is unavailable')
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })
  if (!adapter)
    throw new Error('WebGPU did not provide an adapter')
  const info = adapter.info
  const adapterInfo = info ? { vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description } : null
  const device = await adapter.requestDevice()
  let lost = false
  device.lost.then(() => {
    lost = true
  })
  let deviceError
  device.addEventListener('uncapturederror', (event) => {
    deviceError ||= event.error
  })
  try {
    device.pushErrorScope('validation')
    const module = device.createShaderModule({ code: shader })
    const info = await module.getCompilationInfo()
    const errors = info.messages.filter(message => message.type === 'error')
    if (errors.length)
      throw new Error(errors.map(message => `${message.lineNum}: ${message.message}`).join('\n'))
    const canvas = new OffscreenCanvas(1, 1)
    const context = canvas.getContext('webgpu')
    const format = 'rgba8unorm'
    context.configure({ device, format, alphaMode: 'premultiplied' })
    const contextError = await device.popErrorScope()
    if (contextError)
      throw new Error(contextError.message)
    const pipeline = await device.createRenderPipelineAsync({
      layout: 'auto',
      vertex: { module, entryPoint: 'vertexMain' },
      fragment: { module, entryPoint: 'fragmentMain', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    })
    const uniform = device.createBuffer({ size: 128, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    let buffers = []
    let bindGroup
    let span = 0.5
    return {
      adapterInfo,
      async setPattern(engine) {
        device.pushErrorScope('validation')
        let validationError
        try {
          const data = [
            new Float32Array(engine.memory.buffer, engine.gpu_scratches_ptr(), engine.scratch_count() * 8),
            new Uint32Array(engine.memory.buffer, engine.cell_offsets_ptr(), 4097),
            new Uint32Array(engine.memory.buffer, engine.cell_indices_ptr(), engine.cell_indices_len()),
          ]
          for (const values of data) {
            if (values.byteLength > device.limits.maxStorageBufferBindingSize)
              throw new Error('Scratch geometry exceeds the GPU storage limit')
          }
          buffers.forEach(buffer => buffer.destroy())
          buffers = data.map((values) => {
            const buffer = device.createBuffer({ size: Math.max(32, values.byteLength), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST })
            if (values.byteLength)
              device.queue.writeBuffer(buffer, 0, values)
            return buffer
          })
          bindGroup = device.createBindGroup({
            layout: pipeline.getBindGroupLayout(0),
            entries: [uniform, ...buffers].map((buffer, binding) => ({ binding, resource: { buffer } })),
          })
          span = engine.arc_span()
        }
        finally {
          validationError = await device.popErrorScope()
        }
        if (validationError)
          throw new Error(validationError.message)
      },
      async render(params) {
        if (deviceError)
          throw new Error(deviceError.message)
        if (lost)
          throw new Error('WebGPU device lost')
        if (canvas.width !== params.width || canvas.height !== params.height) {
          canvas.width = params.width
          canvas.height = params.height
          context.configure({ device, format, alphaMode: 'premultiplied' })
        }
        device.queue.writeBuffer(uniform, 0, uniforms(params, span))
        device.pushErrorScope('validation')
        const encoder = device.createCommandEncoder()
        const pass = encoder.beginRenderPass({
          colorAttachments: [{
            view: context.getCurrentTexture().createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: 'clear',
            storeOp: 'store',
          }],
        })
        pass.setPipeline(pipeline)
        pass.setBindGroup(0, bindGroup)
        pass.draw(3)
        pass.end()
        device.queue.submit([encoder.finish()])
        const renderError = await device.popErrorScope()
        if (renderError)
          throw new Error(renderError.message)
        await device.queue.onSubmittedWorkDone()
        if (deviceError)
          throw new Error(deviceError.message)
        if (lost)
          throw new Error('WebGPU device lost')
        return canvas.transferToImageBitmap()
      },
      destroy() {
        buffers.forEach(buffer => buffer.destroy())
        uniform.destroy()
        context.unconfigure()
        device.destroy()
      },
    }
  }
  catch (error) {
    device.destroy()
    throw error
  }
}
