import { expect, test } from '@playwright/test'

test.setTimeout(120_000)

test('GPU matches WASM for engraving, tilt, wall alpha and rotary frames', async ({ page }) => {
  // Vite development imports expose the renderer for numerical parity checks.
  await page.goto('/')
  const results = await page.evaluate(async () => {
    const { sampleSvgData } = await import(/* @vite-ignore */ '/src/scratch-hologram-sample-svg.js')
    const { encodeSignatureAnimation } = await import(/* @vite-ignore */ '/src/scratch-hologram-animation.js')
    const { default: signature } = await import(/* @vite-ignore */ '/src/assets/signatures/exported/nishikori-yui-full.svg?raw')
    const samples = sampleSvgData(signature, 1)
    const setup = async (backend: string) => {
      const worker = new Worker('/src/scratch-hologram.worker.js', { type: 'module' })
      const call = (data: object): Promise<any> => new Promise((resolve, reject) => {
        worker.onmessage = ({ data }) => data.type === 'error' ? reject(new Error(data.message)) : resolve(data)
        worker.postMessage(data)
      })
      const ready = await call({ type: 'init', backend })
      if (ready.backend !== backend)
        throw new Error(`Expected ${backend}`)
      return { call, worker }
    }
    const cpu = await setup('wasm')
    const gpu = await setup('webgpu')
    const results = []
    try {
      for (const [width, height] of [[320, 240], [640, 480], [1280, 960], [1920, 1440]]) {
        const params = { width, height, shape: 0, depth: 1, samplingDensity: 1, cameraAz: 0, cameraEl: 0, lightAz: 0, lightEl: 35, sourceSize: 0.8, mode: 0, realtime: true }
        const cpuRealtime = await cpu.call({ type: 'render', params })
        if (cpuRealtime.width > width || cpuRealtime.height > height)
          throw new Error(`WASM realtime render exceeded selected size ${width}x${height}`)
        const cpuFull = await cpu.call({ type: 'render', params: { ...params, realtime: false } })
        if (cpuFull.width !== width || cpuFull.height !== height)
          throw new Error(`WASM idle render did not restore ${width}x${height}`)
        const gpuRealtime = await gpu.call({ type: 'render', params })
        if (gpuRealtime.backend !== 'webgpu' || gpuRealtime.width !== width || gpuRealtime.height !== height)
          throw new Error(`WebGPU realtime render did not preserve ${width}x${height}`)
        gpuRealtime.bitmap?.close()
        const rotary = await gpu.call({ type: 'render', params: { ...params, height: width / 2, rotary: true, animationId: 1, animationPoints: encodeSignatureAnimation(samples.strokes, 1), spin: 90 } })
        if (rotary.backend !== 'webgpu' || rotary.width !== width || rotary.height !== width / 2)
          throw new Error(`WebGPU rotary render did not preserve ${width}x${width / 2}`)
        rotary.bitmap?.close()
      }
      for (const extras of [{}, { discAz: 25, discEl: -20, cameraAz: 18, cameraEl: 10 }, { sourceSize: 8, lightAz: 30 }, { customId: 1, customPoints: samples.points }, { rotary: true, animationId: 1, animationPoints: encodeSignatureAnimation(samples.strokes, 1), spin: 90 }]) {
        const params = { width: 320, height: 240, shape: 0, depth: 1, samplingDensity: 1, cameraAz: 0, cameraEl: 0, lightAz: 0, lightEl: 35, sourceSize: 0.8, mode: 0, ...extras }
        const a = await cpu.call({ type: 'render', params })
        const b = await gpu.call({ type: 'render', params })
        if (b.backend !== 'webgpu')
          throw new Error(b.backendError)
        const context = new OffscreenCanvas(320, 240).getContext('2d')!
        context.drawImage(b.bitmap, 0, 0)
        b.bitmap.close()
        const aa = new Uint8ClampedArray(a.pixels)
        const bb = context.getImageData(0, 0, 320, 240).data
        let total = 0
        let large = 0
        for (let i = 0; i < aa.length; i++) {
          // Compare premultiplied RGB: invisible RGB is not preserved by Canvas.
          const alpha = i - i % 4 + 3
          const difference = i % 4 === 3 ? Math.abs(aa[i] - bb[i]) : Math.abs(aa[i] * aa[alpha] / 255 - bb[i] * bb[alpha] / 255)
          total += difference
          if (difference > 8)
            large++
        }
        results.push({ mean: total / aa.length, large: large / aa.length })
      }
      const geometry = await cpu.call({ type: 'render', params: { shape: 0, depth: 1, samplingDensity: 1, mode: 1 } })
      if (geometry.pixels || geometry.bitmap || geometry.backend !== 'geometry')
        throw new Error('Geometry view must skip rasterization')
    }
    finally {
      cpu.worker.terminate()
      gpu.worker.terminate()
    }
    return results
  })
  expect(results).toHaveLength(5)
  for (const result of results) {
    expect(result.mean).toBeLessThan(1)
    expect(result.large).toBeLessThan(0.01)
  }
})
