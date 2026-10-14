<script setup lang="ts">
/* eslint-disable style/max-statements-per-line */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, useId, watch } from 'vue'
import signatureSvg from '../assets/signatures/exported/nishikori-yui-full.svg?raw'
import { encodeSignatureAnimation, signatureFrameCount } from '../scratch-hologram-animation.js'
import { messages } from '../scratch-hologram-i18n.js'
import { createFrameQueue, patternKeyFor } from '../scratch-hologram-render.js'
import { sampleSvgData } from '../scratch-hologram-sample-svg.js'
import EmbedDemoCheckbox from './EmbedDemoCheckbox.vue'
import EmbedDemoSelect from './EmbedDemoSelect.vue'
import SliderControl from './EmbedDemoSlider.vue'
import ScratchHologramDiagnostics from './ScratchHologramDiagnostics.vue'

const props = withDefaults(defineProps<{ locale?: 'zh' | 'en', interactive?: boolean, content?: 'static' | 'rotary', diagnostics?: boolean }>(), { locale: 'zh', interactive: false, content: 'static', diagnostics: false })
const emit = defineEmits<{
  'update:locale': [value: 'zh' | 'en']
  'update:interactive': [value: boolean]
}>()
const language = ref<'zh' | 'en'>(props.locale)
const interactionEnabled = ref(props.interactive)
function t(key, values = {}) {
  let text = messages[language.value][key] ?? key
  for (const [name, value] of Object.entries(values)) text = text.replace(`{${name}}`, value)
  return text
}
watch(language, value => emit('update:locale', value), { immediate: true })

watch(() => props.locale, (value) => { language.value = value })
watch(() => props.interactive, (value) => { interactionEnabled.value = value })
watch(interactionEnabled, value => emit('update:interactive', value))
const canvas = ref(null); const viewport = ref<HTMLElement>(); const ready = ref(false); const error = ref(false); const count = ref(0)
const shape = ref(3); const depth = ref(1); const cameraAz = ref(0); const cameraEl = ref(0)
const lightAz = ref(0); const lightEl = ref(35); const sourceSize = ref(0.8)
const discAz = ref(0); const discEl = ref(0)
const mode = ref(0); const quality = ref('standard'); const zoom = ref(1); const autoOrbit = ref(false)
const content = ref(props.content); const rotaryFrame = ref(0); const rotaryPlaying = ref(false)
const rotarySpeed = ref(72)
const rotarySpeedStops = [18, 36, 72, 144, 288]
const animationPoints = ref<Float32Array>(); const animationId = ref(0)
const spin = computed(() => rotaryFrame.value * 360 / signatureFrameCount)
const animationSampleCount = computed(() => {
  const points = animationPoints.value
  if (!points?.length)
    return 0
  const finalAngle = points[points.length - 1]
  let samples = 0
  for (let index = 3; index < points.length; index += 4) {
    if (points[index] === finalAngle)
      samples++
  }
  return samples
})
const canInteract = computed(() => interactionEnabled.value)
const dragging = ref(false); const exported = ref(''); const fileInput = ref(null)
const customPoints = ref(null); const customId = ref(0); const customName = ref(''); const importError = ref(false)
const geometry = shallowRef(new Float32Array()); const customSvgText = ref(''); const sourceCurves = ref([])
const samplingDensity = ref(1); const showSamples = ref(false); const svgOffset = ref({ x: 0, y: 0 })
let pointerStart
const arcSpan = ref(0.5); const svgElement = ref(null); const clipId = `disc-${useId()}`
watch(interactionEnabled, (enabled) => {
  if (!enabled) {
    dragging.value = false
    pointerStart = null
  }
})
const presets = [{ id: 0, key: 'cube', icon: '◇' }, { id: 1, key: 'helix', icon: '⌁' }, { id: 2, key: 'arc', icon: '⌒' }, { id: 3, key: 'signature', icon: '✎' }]
const scratchLabel = computed(() => content.value === 'rotary' ? t('rotarySignature') : customName.value || t(presets.find(p => p.id === shape.value)?.key || 'pattern'))
const renderSize = computed(() => ({ preview: [320, 240], standard: [640, 480], fine: [1280, 960], ultra: [1920, 1440] })[quality.value] || [640, 480])
const rotaryRenderSize = computed(() => [renderSize.value[0], renderSize.value[0] / 2])
const diagnosticMetrics = shallowRef({
  backend: '',
  rasterBackend: '',
  adapter: '',
  reason: '',
  capabilities: '',
  width: 0,
  height: 0,
  frameWidth: 0,
  frameHeight: 0,
  duration: 0,
  roundtrip: 0,
  paint: 0,
  mean: 0,
  p95: 0,
  rate: 0,
  frames: 0,
  count: 0,
  geometryBytes: 0,
})
const diagnosticQueue = ref({ inFlight: false, pending: false })
const diagnosticState = computed(() => [
  dragging.value && t('interaction'),
  autoOrbit.value && t('orbit'),
  rotaryPlaying.value && t('playRotation'),
].filter(Boolean).join(' / ') || (language.value === 'zh' ? '靜止' : 'Idle'))
let diagnosticTimer: ReturnType<typeof setInterval>
let sentAt = 0
let sentSize = [0, 0]
let frameDurations: number[] = []
let imageUpdates: number[] = []
const qualityOptions = computed(() => [
  { value: 'preview', label: `${t('preview')} · 320 × 240` },
  { value: 'standard', label: `${t('standard')} · 640 × 480` },
  { value: 'fine', label: `${t('fine')} · 1280 × 960` },
  { value: 'ultra', label: `${t('ultra')} · 1920 × 1440` },
])
const densityStops = [0.5, 0.75, 1, 1.25, 1.5]
const depthStops = [0.5, 0.75, 1, 1.25, 1.5]
const sourceSizeStops = [0.2, 0.4, 0.8, 2, 8]
function nearestStop(value: number, stops: number[]) {
  return stops.reduce((closest, candidate) => Math.abs(candidate - value) < Math.abs(closest - value) ? candidate : closest, stops[0])
}
const densityDisplay = computed(() => `${nearestStop(samplingDensity.value, densityStops).toFixed(2).replace(/0$/, '')}×`)
const depthDisplay = computed(() => `${nearestStop(depth.value, depthStops).toFixed(2)}×`)
const sourceSizeDisplay = computed(() => `${nearestStop(sourceSize.value, sourceSizeStops).toFixed(1)}°`)
const zoomLabel = computed(() => `${Math.round(zoom.value * 100)}%`)
const viewTransform = computed(() => {
  const pan = content.value === 'rotary' ? '' : `translate(${svgOffset.value.x}px, ${svgOffset.value.y}px) `
  return `${pan}scale(${zoom.value})`
})
// Circle midpoint is the actual position encoded on the plate. It is also
// where the nominal camera sees the projected original virtual source point.
const samplePoints = computed(() => {
  const points = []
  for (let i = 0; i < geometry.value.length; i += 8) {
    const [cx, cy, r, nx, ny] = geometry.value.slice(i, i + 5)
    points.push({ x: 50 + (cx + r * nx) * 50, y: 50 - (cy + r * ny) * 50 })
  }
  return points
})
const previewPaths = computed(() => {
  const paths = []; const f = n => n.toFixed(4)
  for (let i = 0; i < geometry.value.length; i += 8) {
    const [cx, cy, r, nx, ny] = geometry.value.slice(i, i + 5)
    const angle = Math.atan2(nx, ny); const a = angle - arcSpan.value; const b = angle + arcSpan.value
    paths.push(`M ${f(50 + (cx + r * Math.sin(a)) * 50)} ${f(50 - (cy + r * Math.cos(a)) * 50)} A ${f(r * 50)} ${f(r * 50)} 0 0 1 ${f(50 + (cx + r * Math.sin(b)) * 50)} ${f(50 - (cy + r * Math.cos(b)) * 50)}`)
  }
  return paths
})
function projectSource(point) {
  const cy = 4.2 * Math.sin(20 * Math.PI / 180); const cz = 4.2 * Math.cos(20 * Math.PI / 180)
  const z = point[2] * depth.value; const k = -z / (cz - z)
  return { x: 50 + point[0] * (1 - k) * 50, y: 50 - (point[1] + (cy - point[1]) * k) * 50 }
}
const originalPaths = computed(() => {
  let curves = []
  if (sourceCurves.value.length) {
    curves = sourceCurves.value.map(curve => curve.map(projectSource))
  }
  else if (shape.value === 0) {
    const edgeSteps = Math.round(22 * samplingDensity.value)
    for (let i = 0; i < samplePoints.value.length; i += edgeSteps) curves.push(samplePoints.value.slice(i, i + edgeSteps))
  }
  else if (shape.value === 1) {
    const steps = Math.round(180 * samplingDensity.value); const crossStep = Math.round(12 / samplingDensity.value)
    const strands = [[], []]; const bars = []
    let offset = 0
    for (let i = 0; i < steps; i++) {
      strands[0].push(samplePoints.value[offset++]); strands[1].push(samplePoints.value[offset++])
      if (i % crossStep === 0) { bars.push(samplePoints.value.slice(offset, offset + 9)); offset += 9 }
    }
    curves = [...strands, ...bars]
  }
  return curves.filter(curve => curve.length > 1 && curve.every(Boolean)).map(curve => curve.map((p, i) => `${i ? 'L' : 'M'} ${p.x.toFixed(4)} ${p.y.toFixed(4)}`).join(' '))
})

let worker; let disposed = false; let requested = 0; let toastTimer; let raf
let renderInFlight = false; let pendingRender = false; let rotaryStarted = 0; let rotaryStartFrame = 0
let sentPatternKey = ''
let exportQueued = false
let frameQueue: ReturnType<typeof createFrameQueue>
const orbitAmplitude = 20
const orbitCycleMs = 5000
let lastOrbit = 0; let phase = 0
function currentParams() {
  const size = content.value === 'rotary' ? rotaryRenderSize.value : renderSize.value
  return { width: size[0], height: size[1], shape: shape.value, depth: content.value === 'rotary' ? 1 : depth.value, cameraAz: cameraAz.value, cameraEl: cameraEl.value, lightAz: lightAz.value, lightEl: lightEl.value, sourceSize: sourceSize.value, discAz: discAz.value, discEl: discEl.value, material: 0, mode: mode.value, samplingDensity: samplingDensity.value, customPoints: customPoints.value, customId: customId.value, animationPoints: content.value === 'rotary' ? animationPoints.value : null, animationId: animationId.value, spin: content.value === 'rotary' ? spin.value : 0, rotary: content.value === 'rotary', realtime: dragging.value || autoOrbit.value || rotaryPlaying.value }
}
function paintFrame(frame) {
  if (!canvas.value) {
    frame.bitmap?.close()
    return
  }
  if (canvas.value.width !== frame.width || canvas.value.height !== frame.height) {
    canvas.value.width = frame.width; canvas.value.height = frame.height
  }
  const context = canvas.value.getContext('2d', { alpha: true })
  if (frame.bitmap) {
    context.clearRect(0, 0, frame.width, frame.height)
    context.drawImage(frame.bitmap, 0, 0, frame.width, frame.height)
    frame.bitmap.close()
  }
  else if (frame.pixels) {
    const pixels = frame.pixels instanceof Uint8ClampedArray ? frame.pixels : new Uint8ClampedArray(frame.pixels)
    context.putImageData(new ImageData(pixels, frame.width, frame.height), 0, 0)
  }
}
function render() {
  if (!ready.value || !worker || disposed)
    return
  if (renderInFlight) { pendingRender = true; diagnosticQueue.value.pending = true; return }
  const params = currentParams()
  const exportRequested = exportQueued
  exportQueued = false
  if (exportRequested)
    params.realtime = false
  const id = ++requested
  const patternKey = patternKeyFor(params)
  if (patternKey === sentPatternKey) {
    params.customPoints = undefined
    params.animationPoints = undefined
  }
  sentPatternKey = patternKey
  renderInFlight = true; pendingRender = false
  if (props.diagnostics) {
    sentAt = performance.now(); sentSize = [params.width, params.height]
    diagnosticQueue.value = { inFlight: true, pending: false }
  }
  worker.postMessage({ type: 'render', id, exportRequested, params: { ...params, patternKey } })
}
function queueRender() {
  frameQueue?.request()
}
function startWorker() {
  worker?.terminate()
  renderInFlight = false; pendingRender = false
  frameQueue?.cancel(); sentPatternKey = ''
  ready.value = false; error.value = false
  diagnosticMetrics.value = { ...diagnosticMetrics.value, backend: '', rasterBackend: '', reason: '', adapter: '', frames: 0, rate: 0 }
  frameDurations = []; imageUpdates = []
  diagnosticQueue.value = { inFlight: false, pending: false }
  worker = new Worker(new URL('../scratch-hologram.worker.js', import.meta.url), { type: 'module' })
  worker.onmessage = ({ data }) => {
    if (disposed) {
      data.bitmap?.close()
      return
    }
    if (data.type === 'ready') {
      if (props.diagnostics) {
        const c = data.capabilities
        diagnosticMetrics.value = { ...diagnosticMetrics.value, backend: data.backend, rasterBackend: data.backend, reason: data.backendError || '', adapter: Object.values(data.adapterInfo || {}).filter(Boolean).join(' / '), capabilities: c ? `WebGPU: ${c.webgpu}, OffscreenCanvas: ${c.offscreenCanvas}, secureContext: ${c.secureContext}` : '' }
      }
      ready.value = true; render(); return
    }
    if (data.type === 'error') {
      error.value = true; ready.value = false; renderInFlight = false
      diagnosticMetrics.value = { ...diagnosticMetrics.value, reason: data.message }
      diagnosticQueue.value = { inFlight: false, pending: false }
      return
    }
    if (data.type !== 'frame' || data.id !== requested) {
      data.bitmap?.close()
      return
    }
    renderInFlight = false
    diagnosticQueue.value = { inFlight: false, pending: pendingRender }
    count.value = data.count
    if (data.geometry)
      geometry.value = new Float32Array(data.geometry)
    arcSpan.value = data.span
    const paintStarted = performance.now()
    if (data.pixels || data.bitmap)
      paintFrame(data)
    if (props.diagnostics) {
      const now = performance.now()
      const raster = Boolean(data.pixels || data.bitmap)
      if (raster) {
        frameDurations.push(data.duration); frameDurations = frameDurations.slice(-60)
        imageUpdates.push(now); imageUpdates = imageUpdates.filter(time => now - time < 1000)
      }
      const sorted = [...frameDurations].sort((a, b) => a - b)
      diagnosticMetrics.value = {
        ...diagnosticMetrics.value,
        backend: data.backend,
        rasterBackend: raster ? data.backend : diagnosticMetrics.value.rasterBackend,
        reason: data.backendError || '',
        width: data.width || 0,
        height: data.height || 0,
        frameWidth: sentSize[0],
        frameHeight: sentSize[1],
        duration: data.duration,
        roundtrip: paintStarted - sentAt,
        paint: now - paintStarted,
        mean: frameDurations.reduce((sum, value) => sum + value, 0) / (frameDurations.length || 1),
        p95: sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] || 0,
        rate: imageUpdates.length,
        frames: diagnosticMetrics.value.frames + 1,
        count: data.count,
        geometryBytes: data.geometry?.byteLength ?? diagnosticMetrics.value.geometryBytes,
      }
    }
    if (data.exportRequested)
      canvas.value?.toBlob((blob) => { if (blob) { saveFile(blob, 'scratch-hologram.png'); toast('exportedImage') } }, 'image/png')
    if (pendingRender) { pendingRender = false; queueRender() }
  }
  worker.onerror = (event) => {
    error.value = true; ready.value = false; renderInFlight = false
    diagnosticMetrics.value = { ...diagnosticMetrics.value, reason: event.message }
    diagnosticQueue.value = { inFlight: false, pending: false }
  }
  worker.postMessage({ type: 'init' })
}
function clearCustom() { customPoints.value = null; customName.value = ''; customSvgText.value = ''; sourceCurves.value = []; customId.value++; importError.value = false }
function choosePreset(id) {
  svgOffset.value = { x: 0, y: 0 }
  if (id === 3) { applySvg(signatureSvg, 'nishikori-yui-full.svg', 3); return }
  shape.value = id; clearCustom()
}
function applySvg(text, filename, presetId = -1) {
  const data = sampleSvgData(text, samplingDensity.value)
  customPoints.value = data.points; sourceCurves.value = data.curves
  customSvgText.value = text; customName.value = filename.replace(/\.svg$/i, '').slice(0, 40)
  customId.value++; shape.value = presetId; importError.value = false
  svgOffset.value = { x: 0, y: 0 }
}
function resampleCustom() {
  if (!customSvgText.value)
    return
  try { const data = sampleSvgData(customSvgText.value, samplingDensity.value); customPoints.value = data.points; sourceCurves.value = data.curves; customId.value++ }
  catch { importError.value = true }
}
async function importSvg(event) {
  const file = event.target.files?.[0]; event.target.value = ''
  if (!file)
    return
  try { applySvg(await file.text(), file.name) }
  catch { importError.value = true }
}
function prepareAnimation() {
  const data = sampleSvgData(signatureSvg, samplingDensity.value)
  animationPoints.value = encodeSignatureAnimation(data.strokes, samplingDensity.value)
  animationId.value++
}
watch(samplingDensity, () => {
  if (content.value === 'rotary')
    prepareAnimation()
  else
    resampleCustom()
  queueRender()
})
watch([shape, depth, cameraEl, lightAz, lightEl, sourceSize, discAz, discEl, mode, quality, samplingDensity, customId], () => {
  queueRender()
})
watch(cameraAz, queueRender)
watch(rotaryFrame, () => {
  if (mode.value === 0)
    queueRender()
})
watch([dragging, autoOrbit, rotaryPlaying], queueRender)
watch(rotarySpeed, () => {
  rotaryStartFrame = rotaryFrame.value; rotaryStarted = performance.now()
})
watch(mode, () => { dragging.value = false; pointerStart = null; autoOrbit.value = false; rotaryPlaying.value = false })
watch(content, () => {
  autoOrbit.value = false; rotaryPlaying.value = false; rotaryFrame.value = 0; dragging.value = false; pointerStart = null
  if (content.value === 'rotary')
    prepareAnimation()
  else
    resampleCustom()
  queueRender()
})
watch(() => props.content, (value) => { content.value = value })
function startDrag(event) {
  if (!canInteract.value || event.button !== 0)
    return
  autoOrbit.value = false; dragging.value = true
  pointerStart = { x: event.clientX, y: event.clientY, az: cameraAz.value, el: cameraEl.value, offset: { ...svgOffset.value } }
  event.currentTarget.setPointerCapture(event.pointerId)
}
function moveDrag(event) {
  if (!canInteract.value || !dragging.value || !pointerStart)
    return
  const dx = event.clientX - pointerStart.x; const dy = event.clientY - pointerStart.y
  if (mode.value === 1) { svgOffset.value = { x: pointerStart.offset.x + dx, y: pointerStart.offset.y + dy }; return }
  const scale = 100 / event.currentTarget.getBoundingClientRect().width
  cameraAz.value = Math.round(Math.max(-65, Math.min(65, pointerStart.az - dx * scale)))
  cameraEl.value = Math.round(Math.max(-45, Math.min(60, pointerStart.el + dy * scale)))
}
function stopDrag() {
  if (!dragging.value)
    return; dragging.value = false; pointerStart = null; queueRender()
}
function keyboardView(event) {
  if (!canInteract.value)
    return
  if (['+', '=', '-'].includes(event.key)) { event.preventDefault(); changeZoom(event.key === '-' ? -0.15 : 0.15); return }
  const changes = { ArrowLeft: [-2, 0], ArrowRight: [2, 0], ArrowUp: [0, 2], ArrowDown: [0, -2] }
  if (!changes[event.key])
    return
  event.preventDefault(); autoOrbit.value = false
  const [x, y] = changes[event.key]
  if (mode.value === 1) { svgOffset.value = { x: svgOffset.value.x + x * 8, y: svgOffset.value.y - y * 8 }; return }
  cameraAz.value = Math.max(-65, Math.min(65, cameraAz.value + x)); cameraEl.value = Math.max(-45, Math.min(60, cameraEl.value + y))
}
function centerView() {
  autoOrbit.value = false
  cameraAz.value = 0; cameraEl.value = 0; phase = 0
  zoom.value = 1; svgOffset.value = { x: 0, y: 0 }
  queueRender()
}
function changeZoom(delta) {
  if (!canInteract.value)
    return
  zoom.value = Math.max(0.5, Math.min(4, Number((zoom.value + delta).toFixed(2))))
}
function handleZoom(event) {
  if (!canInteract.value)
    return
  event.preventDefault()
  changeZoom(event.deltaY > 0 ? -0.15 : 0.15)
}
function toggleOrbit() {
  rotaryPlaying.value = false
  autoOrbit.value = !autoOrbit.value
  if (autoOrbit.value) { phase = Math.asin(Math.max(-1, Math.min(1, cameraAz.value / orbitAmplitude))); lastOrbit = performance.now() }
  else {
    queueRender()
  }
}
function toggleRotary() {
  autoOrbit.value = false
  rotaryPlaying.value = !rotaryPlaying.value
  rotaryStartFrame = rotaryFrame.value; rotaryStarted = performance.now()
}
function seekRotary(frame: number) {
  rotaryPlaying.value = false
  rotaryFrame.value = frame
}
function loop(time) {
  if (rotaryPlaying.value && content.value === 'rotary' && ready.value && !renderInFlight && document.visibilityState === 'visible') {
    rotaryFrame.value = (rotaryStartFrame + Math.floor((time - rotaryStarted) / 1000 * rotarySpeed.value / 360 * signatureFrameCount)) % signatureFrameCount
  }
  if (autoOrbit.value && ready.value && !dragging.value && time - lastOrbit > 16) {
    phase = (phase + Math.min(200, time - lastOrbit) * Math.PI * 2 / orbitCycleMs) % (Math.PI * 2)
    cameraAz.value = Number((Math.sin(phase) * orbitAmplitude).toFixed(3)); lastOrbit = time
  }
  raf = requestAnimationFrame(loop)
}
function saveFile(blob, filename) {
  const href = URL.createObjectURL(blob); const link = document.createElement('a')
  link.href = href; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(href), 1000)
}
function toast(key) { exported.value = key; clearTimeout(toastTimer); toastTimer = setTimeout(() => { exported.value = '' }, 3000) }
function exportImage() {
  exportQueued = true
  queueRender()
}
function exportPattern() {
  if (!svgElement.value)
    return
  const clone = svgElement.value.cloneNode(true)
  clone.removeAttribute('style'); clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); clone.setAttribute('width', '100mm'); clone.setAttribute('height', '100mm')
  clone.setAttribute('viewBox', '0 0 100 100')
  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style')
  style.textContent = '.disc-boundary{fill:none;stroke:#777;stroke-width:.08}.scratch-paths{fill:none;stroke:#888;stroke-width:.08}.original-paths{fill:none;stroke:#111;stroke-width:.15}.sample-points{fill:#d44}'
  clone.prepend(style); saveFile(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' }), 'scratch-pattern.svg'); toast('exportedSvg')
}
onMounted(() => {
  frameQueue = createFrameQueue(render)
  choosePreset(3)
  if (content.value === 'rotary')
    prepareAnimation()
  startWorker()
  raf = requestAnimationFrame(loop)
  if (props.diagnostics) {
    diagnosticTimer = setInterval(() => {
      imageUpdates = imageUpdates.filter(time => performance.now() - time < 1000)
      if (diagnosticMetrics.value.rate !== imageUpdates.length)
        diagnosticMetrics.value = { ...diagnosticMetrics.value, rate: imageUpdates.length }
    }, 250)
  }
})
onBeforeUnmount(() => { disposed = true; worker?.terminate(); cancelAnimationFrame(raf); frameQueue?.cancel(); clearTimeout(toastTimer); clearInterval(diagnosticTimer) })
</script>

<template>
  <div class="scratch-hologram-studio studio">
    <main>
      <section class="experiment" :aria-label="t('pattern')">
        <div class="viewport-panel">
          <div ref="viewport" class="viewport" :class="{ dragging, 'is-rotary': content === 'rotary' && mode === 0, 'is-interaction-disabled': !canInteract }" :tabindex="canInteract ? 0 : -1" :aria-label="mode === 1 ? t('svg') : t('canvas', { name: scratchLabel })" @wheel="handleZoom" @pointerdown="startDrag" @pointermove="moveDrag" @pointerup="stopDrag" @pointercancel="stopDrag" @lostpointercapture="stopDrag" @keydown="keyboardView">
            <canvas v-show="mode === 0" ref="canvas" width="640" height="480" role="img" :style="{ transform: `scale(${zoom})` }" :aria-label="t('canvas', { name: scratchLabel })" />
            <div v-if="mode === 1" class="viewport-svg-preview">
              <svg ref="svgElement" viewBox="0 0 100 100" role="img" :aria-label="t('svg')" :style="{ transform: viewTransform }">
                <defs><clipPath :id="clipId"><circle cx="50" cy="50" r="49.8" /></clipPath></defs>
                <g :clip-path="`url(#${clipId})`" :transform="content === 'rotary' ? `rotate(${-spin} 50 50)` : undefined"><g class="scratch-paths"><path v-if="content === 'rotary'" :d="previewPaths.join(' ')" /><template v-else><path v-for="(path, i) in previewPaths" :key="i" :d="path" /></template></g><g v-if="content === 'static'" class="original-paths"><path v-for="(path, i) in originalPaths" :key="i" :d="path" /></g><g v-if="showSamples" class="sample-points"><circle v-for="(point, i) in samplePoints" :key="i" :cx="point.x" :cy="point.y" r="0.12" /></g></g>
              </svg>
            </div>
            <div v-if="!ready" class="loading-layer">
              <span>{{ t(error ? 'renderError' : 'loading') }}</span><button v-if="error" class="ui-control" @click.stop="startWorker">
                {{ t('retry') }}
              </button>
            </div>
          </div>
          <div class="playback-controls" role="group" :aria-label="t('playback')">
            <div class="control-set">
              <div class="zoom-controls" :class="{ 'is-interaction-disabled': !interactionEnabled }" :aria-label="t('zoom')">
                <button class="ui-control icon-control" :aria-label="t('out')" :disabled="!interactionEnabled" @click="changeZoom(-0.15)">
                  −
                </button>
                <output>{{ zoomLabel }}</output>
                <button class="ui-control icon-control" :aria-label="t('in')" :disabled="!interactionEnabled" @click="changeZoom(0.15)">
                  +
                </button>
              </div>
              <button class="ui-control" @click="centerView">
                {{ t('center') }}
              </button>
              <button v-if="mode === 0" class="ui-control" :aria-pressed="autoOrbit" @click="toggleOrbit">
                {{ t(autoOrbit ? 'pause' : 'orbit') }}
              </button>
              <button v-if="content === 'rotary'" class="ui-control" :disabled="!ready" :aria-pressed="rotaryPlaying" @click="toggleRotary">
                {{ t(rotaryPlaying ? 'pauseRotation' : 'playRotation') }}
              </button>
              <button class="ui-control" :disabled="!ready" @click="mode === 0 ? exportImage() : exportPattern()">
                {{ t(mode === 0 ? 'exportImage' : 'exportSvg') }}
              </button>
            </div>
            <EmbedDemoCheckbox v-model="interactionEnabled" :label="t('interaction')" />
          </div>
        </div>
        <ScratchHologramDiagnostics v-if="diagnostics" :locale="language" :metrics="diagnosticMetrics" :selected="content === 'rotary' ? rotaryRenderSize : renderSize" :state="diagnosticState" :in-flight="diagnosticQueue.inFlight" :pending="diagnosticQueue.pending" />
        <div class="control-deck">
          <nav class="scene-selector" :aria-label="t('scene')">
            <span class="control-label">{{ t('scene') }}</span>
            <div class="scene-selector__options" role="group" :aria-label="t('scene')">
              <button class="ui-control scene-icon" :aria-label="t('staticImage')" :title="t('staticImage')" :aria-pressed="content === 'static'" @click="content = 'static'">
                <span class="i-carbon-image" aria-hidden="true" />
              </button>
              <button class="ui-control scene-icon" :aria-label="t('rotarySignature')" :title="t('rotarySignature')" :aria-pressed="content === 'rotary'" @click="content = 'rotary'">
                <span class="i-carbon-video-player" aria-hidden="true" />
              </button>
            </div>
          </nav>
          <div class="inspector">
            <div v-if="content === 'static'" class="preset-section">
              <input ref="fileInput" class="file-input" type="file" accept=".svg,image/svg+xml" @change="importSvg">
              <div class="preset-grid" role="group" :aria-label="t('content')">
                <button v-for="preset in presets" :key="preset.id" class="ui-control" type="button" :aria-pressed="shape === preset.id" @click="choosePreset(preset.id)">
                  <span class="preset-icon">{{ preset.icon }}</span>{{ t(preset.key) }}
                </button>
                <button class="ui-control import-button" type="button" @click="fileInput?.click()">
                  <span class="preset-icon">↥</span>{{ t(customName ? 'replace' : 'import') }}
                </button>
              </div>
              <p v-if="importError" class="error-message" role="alert">
                {{ t('importError') }}
              </p>
            </div>
            <div class="view-controls">
              <div class="display-controls" role="group" :aria-label="t('mode')">
                <span class="control-label">{{ t('mode') }}</span>
                <div class="control-set">
                  <button class="ui-control" :aria-pressed="mode === 0" @click="mode = 0">
                    {{ t('reflection') }}
                  </button>
                  <button class="ui-control" :aria-pressed="mode === 1" @click="mode = 1">
                    {{ t('structure') }}
                  </button>
                </div>
              </div>
            </div>
            <div class="quality-section">
              <EmbedDemoSelect v-model="quality" layout="inline" :label="t('quality')" :options="qualityOptions" />
            </div>

            <div class="parameter-groups">
              <div class="control-section pattern-section">
                <div class="display-controls pattern-encoding-controls">
                  <h3 class="pattern-encoding-heading">
                    {{ t('pattern') }}
                  </h3>
                  <label v-if="content === 'static' && mode === 1" class="check-control">
                    <input v-model="showSamples" type="checkbox">{{ t('samples') }}
                  </label>
                </div>
                <div class="pattern-parameters">
                  <div class="pattern-slider-stack">
                    <SliderControl v-model="samplingDensity" :label="t('density')" :min="0.5" :max="1.5" :discrete-values="densityStops" discrete-only layout="inline" :value-label="densityDisplay" />
                    <span v-if="content === 'rotary'" class="pattern-sample-count" :title="t('animationGrooves', { count })">{{ t('frameSampleCount', { count: animationSampleCount }) }}</span>
                    <span v-else class="pattern-sample-count">{{ t('sampleCount', { count }) }}</span>
                  </div>
                  <SliderControl v-if="content === 'static'" v-model="depth" :label="t('depth')" :min="0.5" :max="1.5" :discrete-values="depthStops" discrete-only layout="inline" :value-label="depthDisplay" />
                </div>
              </div>

              <section v-if="mode === 0" class="control-section disc-section" :aria-label="t('disc')">
                <h3 class="section-heading">
                  {{ t('disc') }}
                </h3>
                <div v-if="content === 'rotary'" class="rotary-controls">
                  <SliderControl :model-value="rotaryFrame" :label="t('rotationAngle')" :min="0" :max="signatureFrameCount - 1" :step="1" layout="inline" :value-label="`${spin.toFixed(1)}°`" @update:model-value="seekRotary" />
                  <SliderControl v-model="rotarySpeed" :label="t('angularVelocity')" :min="18" :max="288" :discrete-values="rotarySpeedStops" discrete-only layout="inline" :value-label="`${rotarySpeed}°/s`" />
                </div>
                <div class="disc-parameters">
                  <fieldset class="disc-rotation" :disabled="mode === 1" :aria-label="t('discOrientation')">
                    <SliderControl v-model="discAz" :label="t('azimuth')" :min="-35" :max="35" layout="inline" :value-label="`${Math.round(discAz)}°`" />
                    <SliderControl v-model="discEl" :label="t('elevation')" :min="-35" :max="35" layout="inline" :value-label="`${Math.round(discEl)}°`" />
                  </fieldset>
                </div>
              </section>

              <fieldset v-if="mode === 0" class="control-section optics-section">
                <legend class="sr-only">
                  {{ t('light') }}
                </legend>
                <h3 class="section-heading" aria-hidden="true">
                  {{ t('light') }}
                </h3>
                <SliderControl v-model="lightAz" :label="t('azimuth')" :min="-75" :max="75" layout="inline" :value-label="`${Math.round(lightAz)}°`" />
                <SliderControl v-model="lightEl" :label="t('elevation')" :min="-20" :max="90" layout="inline" :value-label="`${Math.round(lightEl)}°`" />
                <SliderControl v-model="sourceSize" :label="t('sourceSize')" :min="0.2" :max="8" :discrete-values="sourceSizeStops" discrete-only layout="inline" :value-label="sourceSizeDisplay" />
              </fieldset>

              <fieldset v-if="mode === 0" class="control-section optics-section">
                <legend class="sr-only">
                  {{ t('camera') }}
                </legend>
                <h3 class="section-heading" aria-hidden="true">
                  {{ t('camera') }}
                </h3>
                <SliderControl v-model="cameraAz" :label="t('azimuth')" :min="-65" :max="65" layout="inline" :value-label="`${Math.round(cameraAz)}°`" />
                <SliderControl v-model="cameraEl" :label="t('elevation')" :min="-55" :max="55" layout="inline" :value-label="`${Math.round(cameraEl)}°`" />
              </fieldset>
            </div>
          </div>
        </div>
      </section>
    </main>
    <div v-if="exported" class="toast" role="status">
      {{ t(exported) }}
    </div>
  </div>
</template>

<style scoped>
.scratch-hologram-studio {
  font-family:
    Inter,
    ui-sans-serif,
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    'Segoe UI',
    'PingFang SC',
    sans-serif;
  font-synthesis: none;
  --page-bg: var(--c-bg);
  --ink: var(--c-fg);
  --ink-deep: var(--c-fg-deep);
  --line: #8885;
  --line-soft: #8883;
  --control-border: #8885;
  --control-border-active: #8889;
  --control-surface-hover: #8881;
  --control-surface-active: #8882;
  --control-radius: 0;
  color: var(--c-fg);
  background: var(--c-bg);
  color-scheme: inherit;
}
.scratch-hologram-studio.studio {
  width: 100%;
  margin: 0 auto;
  padding-bottom: 3rem;
}
.experiment {
  container: scratch-studio / inline-size;
}
.control-set {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
}
.ui-control {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 2.15rem;
  padding: 0.35rem 0.7rem;
  border: 1px solid var(--control-border, #8885);
  border-radius: 0;
  background: transparent;
  color: inherit;
  font-size: 0.75rem;
  line-height: 1.2;
  white-space: nowrap;
  opacity: 0.62;
  cursor: pointer;
  transition:
    background-color 160ms ease,
    border-color 160ms ease,
    opacity 160ms ease;
}
.ui-control:hover:not(:disabled) {
  border-color: var(--control-border-active, #8889);
  background: var(--control-surface-hover, #8881);
  opacity: 1;
}
.ui-control[aria-pressed='true'],
.ui-control[aria-checked='true'] {
  border-color: var(--control-border-active, #8889);
  background: var(--control-surface-active, #8882);
  font-weight: 500;
  opacity: 1;
}
.ui-control:focus-visible,
a:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 2px;
}
.ui-control:disabled {
  cursor: not-allowed;
  opacity: 0.25;
}
.icon-control {
  width: 2.15rem;
  padding-inline: 0;
}
.mode-control {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.65rem;
  min-width: 0;
}
.control-label {
  flex: none;
  font-size: 0.75rem;
  opacity: 0.62;
}
.viewport-panel {
  margin-bottom: 0;
  padding-bottom: 1.25rem;
}
.viewport {
  width: min(100%, 1080px);
  aspect-ratio: 4 / 3;
  margin: 0 auto;
  position: relative;
  overflow: hidden;
  background: var(--c-bg);
  cursor: grab;
  touch-action: none;
}
.viewport.is-interaction-disabled {
  cursor: default;
  touch-action: auto;
}
.viewport.is-rotary {
  aspect-ratio: 2 / 1;
}
.viewport.dragging {
  cursor: grabbing;
}
.viewport:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 2px;
}
.viewport canvas {
  display: block;
  width: 100%;
  height: 100%;
  transform-origin: center;
  pointer-events: none;
}
.viewport-svg-preview {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  overflow: hidden;
}
.viewport-svg-preview svg {
  display: block;
  width: 76%;
  aspect-ratio: 1;
  overflow: visible;
  transform-origin: center;
  pointer-events: none;
}
.disc-boundary {
  fill: none;
  stroke: #454545;
  stroke-width: 0.45;
  vector-effect: non-scaling-stroke;
}
.scratch-paths {
  fill: none;
  stroke: var(--c-fg);
  stroke-width: 0.25;
  stroke-opacity: 0.4;
}
.scratch-paths path {
  vector-effect: non-scaling-stroke;
}
.original-paths {
  fill: none;
  stroke: var(--c-fg-deep);
  stroke-width: 0.9;
}
.original-paths path {
  vector-effect: non-scaling-stroke;
}
.sample-points {
  fill: #ef6262;
}
.loading-layer {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  background: var(--c-bg);
  color: var(--fg);
  font-size: 0.75rem;
}
.view-controls {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 1rem;
  padding-bottom: 1.25rem;
  margin-bottom: 0;
  border-bottom: 0;
}
.display-controls {
  display: grid;
  grid-template-columns: minmax(8rem, 11rem) minmax(0, 1fr);
  align-items: center;
  gap: 1rem;
  min-width: 0;
}
.playback-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem 0.85rem;
  min-width: 0;
  margin-top: 0;
  padding-top: 1.25rem;
  border-top: 1px solid var(--line-soft);
}
.playback-controls > .control-set {
  display: contents;
}
.playback-controls :deep(.embed-demo-checkbox) {
  flex: 0 0 auto;
  white-space: nowrap;
}
.playback-controls :deep(.embed-demo-checkbox > span:last-child) {
  opacity: 0.62;
}
.quality-section {
  padding: 0 0 1.25rem;
  margin-bottom: 0;
  border-top: 0;
  border-bottom: 0;
}
.quality-section :deep(.embed-demo-select.is-inline) {
  grid-template-columns: minmax(8rem, 11rem) minmax(0, max-content);
  gap: 1rem;
  align-items: center;
}
.quality-section :deep(.embed-demo-select__control) {
  min-width: 0;
  width: 100%;
}
.zoom-controls {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}
.zoom-controls.is-interaction-disabled {
  opacity: 0.25;
}
.zoom-controls output {
  min-width: 3rem;
  text-align: center;
  font-size: 0.7rem;
  font-variant-numeric: tabular-nums;
}
.inspector {
  min-width: 0;
  padding-top: 1.5rem;
  padding-bottom: 1.5rem;
}
.control-deck {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  column-gap: 1.5rem;
  margin-top: 0;
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
}
.scene-selector {
  display: grid;
  align-content: start;
  justify-items: start;
  gap: 0.5rem;
  min-width: 0;
  padding: 1.5rem 0.75rem 1.5rem 0;
  border-right: 1px solid var(--line-soft);
}
.scene-selector > .control-label {
  font-size: 0.7rem;
  font-weight: 500;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  opacity: 0.5;
}
.scene-selector__options {
  display: grid;
  gap: 0.5rem;
}
.scene-icon {
  width: 2.25rem;
  height: 2.25rem;
  padding: 0;
}
.scene-icon > span {
  font-size: 1.15rem;
}
.parameter-groups {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 2rem;
  padding-bottom: 0;
}
.pattern-section {
  min-width: 0;
}
.rotary-controls {
  display: grid;
  gap: 0.75rem;
  min-width: 0;
}
.control-section {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  align-content: start;
  gap: 0.75rem;
  min-width: 0;
  border: 0;
  margin: 0;
  padding: 0;
}
.section-heading,
.pattern-encoding-heading,
.display-controls > .control-label,
.quality-section :deep(.embed-demo-select__label) {
  margin: 0 0 0.5rem;
  color: var(--ink-deep);
  font-size: 0.8rem;
  font-weight: 600;
  letter-spacing: -0.01em;
  opacity: 1;
}
.control-section > .section-heading {
  display: flex;
  align-items: center;
  min-height: 2.15rem;
  margin: 0;
}
.section-heading,
.pattern-encoding-heading {
  line-height: 1.2;
}
.pattern-encoding-controls {
  min-height: 2.15rem;
  margin-bottom: 0;
}
.pattern-encoding-heading {
  margin: 0;
}
.inspector :deep(.embed-demo-slider.is-inline) {
  display: grid;
  grid-template-columns: minmax(8rem, 11rem) minmax(0, 1fr) 3.75rem;
  align-items: center;
  gap: 1rem;
  width: 100%;
}
.disc-parameters {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 0.75rem;
}
.disc-rotation {
  display: grid;
  gap: 0.75rem;
  min-width: 0;
  padding: 0;
  border: 0;
  margin: 0;
}
.disc-rotation:disabled {
  opacity: 0.35;
}
.pattern-slider-stack {
  min-width: 0;
  align-self: start;
}
.pattern-parameters > :deep(.embed-demo-slider) {
  align-self: start;
}
.pattern-sample-count {
  display: block;
  margin-top: 0.25rem;
  color: inherit;
  font-size: 0.7rem;
  font-variant-numeric: tabular-nums;
  opacity: 0.45;
}
.file-input {
  display: none;
}
.preset-section {
  container: scratch-presets / inline-size;
  padding-bottom: 0;
  margin-bottom: 1.25rem;
  border-bottom: 0;
}
.preset-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 0.65rem;
  max-width: 100%;
}
.preset-grid .ui-control {
  min-height: 5.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  padding: 0.85rem 0.35rem;
  font-size: 0.72rem;
}
.preset-icon {
  display: block;
  font-size: 1.6rem;
  line-height: 1;
  opacity: 0.85;
}
.preset-grid .import-button {
  border-style: dashed;
  opacity: 0.5;
}
.preset-grid .import-button:hover:not(:disabled) {
  opacity: 1;
}
.check-control {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.75rem;
  cursor: pointer;
}
.check-control input {
  appearance: none;
  width: 0.9rem;
  height: 0.9rem;
  margin: 0;
  border: 1px solid var(--control-border);
  border-radius: 0;
  background: transparent;
}
.check-control input:checked {
  background: var(--ink-deep);
  box-shadow: inset 0 0 0 2px var(--page-bg);
}
.check-control input:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 3px;
}
.pattern-parameters {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  align-items: start;
  gap: 0.75rem;
}
.error-message {
  color: var(--ink-deep);
  font-size: 0.75rem;
  margin-top: 0.5rem;
}
.toast {
  position: fixed;
  bottom: 1.5rem;
  left: 50%;
  transform: translateX(-50%);
  padding: 0.8rem 1rem;
  border: 1px solid var(--line);
  background: var(--c-bg);
  color: var(--ink-deep);
  font-size: 0.75rem;
}
@container scratch-studio (max-width: 36rem) {
  .display-controls {
    grid-template-columns: minmax(6rem, 8rem) minmax(0, 1fr);
    gap: 0.75rem;
  }
  .inspector :deep(.embed-demo-slider.is-inline) {
    grid-template-columns: minmax(6rem, 8rem) minmax(0, 1fr) 3.5rem;
    gap: 0.75rem;
  }
  .quality-section :deep(.embed-demo-select.is-inline) {
    grid-template-columns: minmax(6rem, 8rem) minmax(0, 1fr);
    gap: 0.75rem;
  }
  .preset-grid {
    gap: 0.5rem;
  }
  .preset-grid .ui-control {
    min-height: 4.5rem;
    padding-inline: 0.25rem;
    font-size: 0.7rem;
  }
  .preset-icon {
    font-size: 1.45rem;
  }
}
@container scratch-studio (max-width: 26rem) {
  .display-controls {
    grid-template-columns: 5.5rem minmax(0, 1fr);
  }
  .control-deck {
    grid-template-columns: minmax(0, 1fr);
    column-gap: 0;
  }
  .scene-selector {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 0.75rem;
    padding: 1.25rem 0;
    border-right: 0;
    border-bottom: 1px solid var(--line-soft);
  }
  .scene-selector > .control-label {
    flex: 0 0 auto;
  }
  .scene-selector__options {
    display: flex;
    gap: 0.5rem;
  }
  .scene-icon {
    width: 2rem;
    height: 2rem;
  }
  .inspector :deep(.embed-demo-slider.is-inline) {
    grid-template-columns: minmax(0, 1fr) 3.5rem;
    gap: 0.5rem 0.75rem;
  }
  .inspector :deep(.embed-demo-slider__label) {
    grid-column: 1 / -1;
  }
  .inspector :deep(.embed-demo-slider__track) {
    width: 100%;
  }
  .quality-section :deep(.embed-demo-select.is-inline) {
    grid-template-columns: 5.5rem minmax(0, 1fr);
  }
  .quality-section :deep(.embed-demo-select__trigger) {
    padding-left: 0.5rem;
  }
}
@container scratch-presets (max-width: 30.1rem) {
  .preset-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
  .preset-grid .import-button {
    grid-column: 1 / -1;
  }
}
@container scratch-presets (max-width: 20rem) {
  .preset-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (prefers-reduced-motion: reduce) {
  * {
    transition: none !important;
  }
}
</style>
