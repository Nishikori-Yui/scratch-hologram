<script setup>
import { computed, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import SliderControl from './SliderControl.vue'
import { sampleSvgData } from './sample-svg.js'
import { messages } from './i18n.js'
import signatureSvg from './assets/nishikori-yui-full.svg?raw'

const language = ref(localStorage.getItem('scratch-language') === 'en' ? 'en' : 'zh')
function t(key, values = {}) {
  let text = messages[language.value][key] ?? key
  for (const [name, value] of Object.entries(values)) text = text.replace(`{${name}}`, value)
  return text
}
watch(language, value => {
  localStorage.setItem('scratch-language', value)
  document.documentElement.lang = value === 'zh' ? 'zh-CN' : 'en'
  document.title = value === 'zh' ? 'Scratch Hologram · 划痕光学' : 'Scratch Hologram'
}, { immediate: true })

const canvas = ref(null), ready = ref(false), error = ref(false), count = ref(0)
const shape = ref(3), depth = ref(1), cameraAz = ref(0), cameraEl = ref(20)
const lightAz = ref(0), lightEl = ref(55), sourceSize = ref(0.8)
const mode = ref(0), quality = ref('standard'), zoom = ref(1), autoOrbit = ref(false)
const dragging = ref(false), exported = ref(''), fileInput = ref(null)
const customPoints = ref(null), customId = ref(0), customName = ref(''), importError = ref(false)
const geometry = ref([]), customSvgText = ref(''), sourceCurves = ref([])
const samplingDensity = ref(1), showSamples = ref(false), svgOffset = ref({ x: 0, y: 0 })
const arcSpan = ref(0.5), svgElement = ref(null), clipId = `disc-${useId()}`
const presets = [{ id: 0, key: 'cube', icon: '◇' }, { id: 1, key: 'helix', icon: '⌁' }, { id: 2, key: 'arc', icon: '⌒' }, { id: 3, key: 'signature', icon: '✎' }]
const plus = value => `${value > 0 ? '+' : ''}${Math.round(value)}°`
const scratchLabel = computed(() => customName.value || t(presets.find(p => p.id === shape.value)?.key || 'pattern'))
const renderSize = computed(() => ({ preview: [320, 240], standard: [640, 480], fine: [1280, 960], ultra: [1920, 1440] })[quality.value] || [640, 480])
const samplingStops = computed(() => ['sparse', 'standard', 'fine', 'dense'].map((key, i) => ({ value: (i + 1) / 2, label: t(key) })))
const zoomLabel = computed(() => `${Math.round(zoom.value * 100)}%`)
const viewTransform = computed(() => `translate(${svgOffset.value.x}px, ${svgOffset.value.y}px) scale(${zoom.value})`)
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
  const paths = [], f = n => n.toFixed(4)
  for (let i = 0; i < geometry.value.length; i += 8) {
    const [cx, cy, r, nx, ny] = geometry.value.slice(i, i + 5)
    const angle = Math.atan2(nx, ny), a = angle - arcSpan.value, b = angle + arcSpan.value
    paths.push(`M ${f(50 + (cx + r * Math.sin(a)) * 50)} ${f(50 - (cy + r * Math.cos(a)) * 50)} A ${f(r * 50)} ${f(r * 50)} 0 0 1 ${f(50 + (cx + r * Math.sin(b)) * 50)} ${f(50 - (cy + r * Math.cos(b)) * 50)}`)
  }
  return paths
})
function projectSource(point) {
  const cy = 4.2 * Math.sin(20 * Math.PI / 180), cz = 4.2 * Math.cos(20 * Math.PI / 180)
  const z = point[2] * depth.value, k = -z / (cz - z)
  return { x: 50 + point[0] * (1 - k) * 50, y: 50 - (point[1] + (cy - point[1]) * k) * 50 }
}
const originalPaths = computed(() => {
  let curves = []
  if (sourceCurves.value.length) curves = sourceCurves.value.map(curve => curve.map(projectSource))
  else if (shape.value === 0) {
    const edgeSteps = Math.round(22 * samplingDensity.value)
    for (let i = 0; i < samplePoints.value.length; i += edgeSteps) curves.push(samplePoints.value.slice(i, i + edgeSteps))
  } else if (shape.value === 1) {
    const steps = Math.round(180 * samplingDensity.value), crossStep = Math.round(12 / samplingDensity.value)
    const strands = [[], []], bars = []
    let offset = 0
    for (let i = 0; i < steps; i++) {
      strands[0].push(samplePoints.value[offset++]); strands[1].push(samplePoints.value[offset++])
      if (i % crossStep === 0) { bars.push(samplePoints.value.slice(offset, offset + 9)); offset += 9 }
    }
    curves = [...strands, ...bars]
  }
  return curves.filter(curve => curve.length > 1 && curve.every(Boolean)).map(curve => curve.map((p, i) => `${i ? 'L' : 'M'} ${p.x.toFixed(4)} ${p.y.toFixed(4)}`).join(' '))
})

let worker, prewarmWorker, disposed = false, requested = 0, requestTimer, toastTimer, raf
const orbitCache = new Map()
let orbitCacheBaseKey = ''
const orbitAngles = Array.from({ length: 25 }, (_, index) => Number((-16 + index * (32 / 24)).toFixed(2)))
let lastOrbit = 0, phase = 0, pointerStart
function currentParams() {
  const size = renderSize.value
  return { width: size[0], height: size[1], shape: shape.value, depth: depth.value, cameraAz: cameraAz.value, cameraEl: cameraEl.value, lightAz: lightAz.value, lightEl: lightEl.value, sourceSize: sourceSize.value, mode: mode.value, samplingDensity: samplingDensity.value, customPoints: customPoints.value, customId: customId.value }
}
function orbitKey(params) {
  return [params.width, params.height, params.shape, params.depth, params.cameraEl, params.lightAz, params.lightEl, params.sourceSize, params.mode, params.samplingDensity, params.customId].join('/')
}
function isDefaultView(params) {
  return params.shape === 3 && params.depth === 1 && params.cameraAz === 0 && params.cameraEl === 20 && params.lightAz === 0 && params.lightEl === 55 && params.sourceSize === 0.8 && params.mode === 0 && params.samplingDensity === 1 && Boolean(params.customPoints)
}
function paintFrame(frame) {
  if (!canvas.value) return
  if (canvas.value.width !== frame.width || canvas.value.height !== frame.height) {
    canvas.value.width = frame.width; canvas.value.height = frame.height
  }
  const context = canvas.value.getContext('2d', { alpha: false })
  if (frame.bitmap) context.drawImage(frame.bitmap, 0, 0, frame.width, frame.height)
  else if (frame.pixels) context.putImageData(new ImageData(frame.pixels, frame.width, frame.height), 0, 0)
}
function cachedOrbitFrame(params) {
  if (!autoOrbit.value || quality.value !== 'ultra' || mode.value !== 0 || orbitKey(params) !== orbitCacheBaseKey || !orbitCache.size) return null
  let closest = null, distance = Infinity
  for (const frame of orbitCache.values()) {
    const currentDistance = Math.abs(frame.cameraAz - params.cameraAz)
    if (currentDistance < distance) { distance = currentDistance; closest = frame }
  }
  return distance <= 2.1 ? closest : null
}
function render() {
  if (!ready.value || !worker || disposed) return
  const params = currentParams()
  const id = ++requested
  const cached = cachedOrbitFrame(params)
  if (cached) { paintFrame(cached); return }
  worker.postMessage({ type: 'render', id, params })
}
function queueRender() {
  clearTimeout(requestTimer)
  requestTimer = setTimeout(() => render(), 24)
}
function startWorker() {
  worker?.terminate(); prewarmWorker?.terminate(); prewarmWorker = null
  orbitCache.clear(); orbitCacheBaseKey = ''
  ready.value = false; error.value = false
  worker = new Worker(new URL('./renderer.worker.js', import.meta.url), { type: 'module' })
  worker.onmessage = ({ data }) => {
    if (disposed) return
    if (data.type === 'ready') { ready.value = true; render(); startOrbitPrewarm(); return }
    if (data.type === 'error') { error.value = true; ready.value = false; return }
    if (data.type !== 'frame' || data.id !== requested) return
    count.value = data.count
    if (data.geometry) geometry.value = Array.from(new Float32Array(data.geometry))
    arcSpan.value = data.span
    if (data.pixels) paintFrame({ pixels: new Uint8ClampedArray(data.pixels), width: data.width, height: data.height })
  }
  worker.onerror = () => { error.value = true; ready.value = false }
  worker.postMessage({ type: 'init' })
}
function startOrbitPrewarm() {
  const base = currentParams()
  if (!isDefaultView(base) || orbitCacheBaseKey) return
  const params = { ...base, width: 1920, height: 1440 }
  orbitCacheBaseKey = orbitKey(params)
  prewarmWorker = new Worker(new URL('./renderer.worker.js', import.meta.url), { type: 'module' })
  prewarmWorker.onmessage = async ({ data }) => {
    if (disposed || !prewarmWorker) return
    if (data.type === 'ready') {
      prewarmWorker.postMessage({ type: 'prewarm-orbit', params, angles: orbitAngles })
      return
    }
    if (data.type === 'orbit-frame') {
      const frame = { cameraAz: data.cameraAz, width: data.width, height: data.height, count: data.count, span: data.span }
      try {
        if (typeof createImageBitmap === 'function') {
          frame.bitmap = await createImageBitmap(new ImageData(new Uint8ClampedArray(data.pixels), data.width, data.height))
        } else {
          frame.pixels = new Uint8ClampedArray(data.pixels)
        }
      } catch {
        frame.pixels = new Uint8ClampedArray(data.pixels)
      }
      if (!disposed && orbitCacheBaseKey === orbitKey(params)) orbitCache.set(frame.cameraAz, frame)
      return
    }
    if (data.type === 'orbit-complete') {
      prewarmWorker.terminate(); prewarmWorker = null
    }
  }
  prewarmWorker.onerror = () => { prewarmWorker?.terminate(); prewarmWorker = null }
  prewarmWorker.postMessage({ type: 'init' })
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
  if (!customSvgText.value) return
  try { const data = sampleSvgData(customSvgText.value, samplingDensity.value); customPoints.value = data.points; sourceCurves.value = data.curves; customId.value++ }
  catch { importError.value = true }
}
async function importSvg(event) {
  const file = event.target.files?.[0]; event.target.value = ''
  if (!file) return
  try { applySvg(await file.text(), file.name) } catch { importError.value = true }
}
watch(samplingDensity, () => { resampleCustom(); queueRender() })
watch([shape, depth, cameraAz, cameraEl, lightAz, lightEl, sourceSize, mode, quality, customId], queueRender)
watch(mode, () => { dragging.value = false; pointerStart = null; autoOrbit.value = false })
function startDrag(event) {
  if (event.button !== 0) return
  autoOrbit.value = false; dragging.value = true
  pointerStart = { x: event.clientX, y: event.clientY, az: cameraAz.value, el: cameraEl.value, offset: { ...svgOffset.value } }
  event.currentTarget.setPointerCapture(event.pointerId)
}
function moveDrag(event) {
  if (!dragging.value || !pointerStart) return
  const dx = event.clientX - pointerStart.x, dy = event.clientY - pointerStart.y
  if (mode.value === 1) { svgOffset.value = { x: pointerStart.offset.x + dx, y: pointerStart.offset.y + dy }; return }
  const scale = 100 / event.currentTarget.getBoundingClientRect().width
  cameraAz.value = Math.round(Math.max(-65, Math.min(65, pointerStart.az - dx * scale)))
  cameraEl.value = Math.round(Math.max(-45, Math.min(60, pointerStart.el + dy * scale)))
}
function stopDrag() { if (!dragging.value) return; dragging.value = false; pointerStart = null; queueRender() }
function keyboardView(event) {
  if (['+', '=', '-'].includes(event.key)) { event.preventDefault(); changeZoom(event.key === '-' ? -0.15 : 0.15); return }
  const changes = { ArrowLeft: [-2, 0], ArrowRight: [2, 0], ArrowUp: [0, 2], ArrowDown: [0, -2] }
  if (!changes[event.key]) return
  event.preventDefault(); autoOrbit.value = false
  const [x, y] = changes[event.key]
  if (mode.value === 1) { svgOffset.value = { x: svgOffset.value.x + x * 8, y: svgOffset.value.y - y * 8 }; return }
  cameraAz.value = Math.max(-65, Math.min(65, cameraAz.value + x)); cameraEl.value = Math.max(-45, Math.min(60, cameraEl.value + y))
}
function centerView() { zoom.value = 1; svgOffset.value = { x: 0, y: 0 } }
function reset() {
  autoOrbit.value = false; cameraAz.value = 0; cameraEl.value = 20; lightAz.value = 0; lightEl.value = 55; sourceSize.value = 0.8
  depth.value = 1; samplingDensity.value = 1; quality.value = 'standard'; centerView(); phase = 0
}
function changeZoom(delta) { zoom.value = Math.max(0.5, Math.min(4, Number((zoom.value + delta).toFixed(2)))) }
function handleZoom(event) { changeZoom(event.deltaY > 0 ? -0.15 : 0.15) }
function toggleOrbit() {
  autoOrbit.value = !autoOrbit.value
  if (autoOrbit.value) { phase = Math.asin(Math.max(-1, Math.min(1, cameraAz.value / 16))); lastOrbit = performance.now() }
  else queueRender()
}
function loop(time) {
  if (autoOrbit.value && ready.value && !dragging.value && time - lastOrbit > 90) {
    phase += Math.min(200, time - lastOrbit) * 0.00055
    cameraAz.value = Number((Math.sin(phase) * 16).toFixed(1)); lastOrbit = time
  }
  raf = requestAnimationFrame(loop)
}
function saveFile(blob, filename) {
  const href = URL.createObjectURL(blob), link = document.createElement('a')
  link.href = href; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(href), 1000)
}
function toast(key) { exported.value = key; clearTimeout(toastTimer); toastTimer = setTimeout(() => { exported.value = '' }, 3000) }
function exportImage() { canvas.value?.toBlob(blob => { if (blob) { saveFile(blob, 'scratch-hologram.png'); toast('exportedImage') } }, 'image/png') }
function exportPattern() {
  if (!svgElement.value) return
  const clone = svgElement.value.cloneNode(true)
  clone.removeAttribute('style'); clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); clone.setAttribute('width', '100mm'); clone.setAttribute('height', '100mm')
  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style')
  style.textContent = '.disc-boundary{fill:none;stroke:#777;stroke-width:.08}.scratch-paths{fill:none;stroke:#888;stroke-width:.08}.original-paths{fill:none;stroke:#111;stroke-width:.15}.sample-points{fill:#d44}'
  clone.prepend(style); saveFile(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' }), 'scratch-pattern.svg'); toast('exportedSvg')
}
onMounted(() => { choosePreset(3); startWorker(); raf = requestAnimationFrame(loop) })
onBeforeUnmount(() => { disposed = true; worker?.terminate(); prewarmWorker?.terminate(); cancelAnimationFrame(raf); clearTimeout(requestTimer); clearTimeout(toastTimer); orbitCache.clear() })
</script>

<template>
  <div class="studio">
    <header class="site-header">
      <a class="brand" href="#" :aria-label="t('home')">
        <svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><circle cx="16" cy="16" r="13"/><path d="M6 23a12 12 0 0 1 17-17M9 26a12 12 0 0 1 17-17M4 19a12 12 0 0 1 15-15"/><path d="m8 24 16-16"/></svg>
        <span>scratch<span class="brand-light">hologram</span></span>
      </a>
      <p class="slogan">{{ t('slogan') }}</p>
    </header>
    <main>
      <div class="stage-controls">
        <div class="mode-control"><span class="control-label">{{ t('mode') }}</span><div class="control-set" :aria-label="t('mode')"><button class="ui-control" :aria-pressed="mode === 0" @click="mode = 0">{{ t('reflection') }}</button><button class="ui-control" :aria-pressed="mode === 1" @click="mode = 1">{{ t('structure') }}</button></div></div>
        <div class="language-switch control-set" role="radiogroup" :aria-label="t('language')"><button class="ui-control" role="radio" :aria-checked="language === 'zh'" @click="language = 'zh'">中文</button><button class="ui-control" role="radio" :aria-checked="language === 'en'" @click="language = 'en'">English</button></div>
      </div>
      <section class="experiment" :aria-label="t('pattern')">
        <div class="viewport-panel">
          <div class="viewport" :class="{ dragging }" tabindex="0" :aria-label="mode === 1 ? t('svg') : t('canvas', {name: scratchLabel})" @wheel.prevent="handleZoom" @pointerdown="startDrag" @pointermove="moveDrag" @pointerup="stopDrag" @pointercancel="stopDrag" @lostpointercapture="stopDrag" @keydown="keyboardView">
            <canvas v-show="mode === 0" ref="canvas" width="640" height="480" role="img" :style="{ transform: `scale(${zoom})` }" :aria-label="t('canvas', {name: scratchLabel})" />
            <div v-show="mode === 1" class="viewport-svg-preview">
              <svg ref="svgElement" viewBox="0 0 100 100" role="img" :aria-label="t('svg')" :style="{ transform: viewTransform }">
                <defs><clipPath :id="clipId"><circle cx="50" cy="50" r="49.8" /></clipPath></defs>
                <g :clip-path="`url(#${clipId})`"><g class="scratch-paths"><path v-for="(path, i) in previewPaths" :key="i" :d="path" /></g><g class="original-paths"><path v-for="(path, i) in originalPaths" :key="i" :d="path" /></g><g v-if="showSamples" class="sample-points"><circle v-for="(point, i) in samplePoints" :key="i" :cx="point.x" :cy="point.y" r="0.12" /></g></g>
              </svg>
            </div>
            <div v-if="!ready" class="loading-layer"><span>{{ t(error ? 'renderError' : 'loading') }}</span><button v-if="error" class="ui-control" @click.stop="startWorker">{{ t('retry') }}</button></div>
          </div>
          <div class="viewport-footer"><span class="gesture-hint">{{ t(mode === 0 ? 'orbitHint' : 'panHint') }}</span><div class="control-set"><div class="zoom-controls" :aria-label="t('zoom')"><button class="ui-control icon-control" :aria-label="t('out')" @click="changeZoom(-0.15)">−</button><output>{{ zoomLabel }}</output><button class="ui-control icon-control" :aria-label="t('in')" @click="changeZoom(0.15)">+</button></div><button class="ui-control" @click="centerView">{{ t('center') }}</button><button v-if="mode === 0" class="ui-control" :aria-pressed="autoOrbit" @click="toggleOrbit">{{ t(autoOrbit ? 'pause' : 'orbit') }}</button><button class="ui-control" :disabled="!ready" @click="mode === 0 ? exportImage() : exportPattern()">{{ t(mode === 0 ? 'exportImage' : 'exportSvg') }}</button></div></div>
        </div>
        <div class="inspector">
          <div class="inspector-title"><h2>{{ t('parameters') }}</h2><div class="inspector-actions"><label class="quality-control" for="quality"><span>{{ t('quality') }}</span><select id="quality" v-model="quality"><option value="preview">{{ t('preview') }} · 320 × 240</option><option value="standard">{{ t('standard') }} · 640 × 480</option><option value="fine">{{ t('fine') }} · 1280 × 960</option><option value="ultra">{{ t('ultra') }} · 1920 × 1440</option></select></label><button class="ui-control" @click="reset">↺ {{ t('reset') }}</button></div></div>
          <fieldset class="control-section pattern-section"><legend>{{ t('pattern') }}</legend>
            <input ref="fileInput" class="file-input" type="file" accept=".svg,image/svg+xml" @change="importSvg" />
            <div class="preset-grid"><button v-for="preset in presets" :key="preset.id" class="ui-control" :aria-pressed="shape === preset.id" @click="choosePreset(preset.id)"><span class="preset-icon">{{ preset.icon }}</span>{{ t(preset.key) }}</button><button class="ui-control import-button" @click="fileInput?.click()"><span class="preset-icon">↥</span>{{ t(customName ? 'replace' : 'import') }}</button></div>
            <div class="pattern-status"><span>{{ t('sampleCount', {count}) }}</span><label v-if="mode === 1" class="check-control"><input v-model="showSamples" type="checkbox" />{{ t('samples') }}</label></div><p v-if="importError" class="error-message" role="alert">{{ t('importError') }}</p>
            <div class="pattern-parameters"><SliderControl v-model="samplingDensity" :label="t('density')" :min="0.5" :max="2" :step="0.5" :value-label="`${samplingDensity.toFixed(1)}×`" :stops="samplingStops" /><SliderControl v-model="depth" :label="t('depth')" :min="0.35" :max="1.6" :step="0.05" :value-label="`${depth.toFixed(2)}×`" /></div>
          </fieldset>
          <div class="optics-controls">
            <fieldset class="control-section light-section"><legend>{{ t('light') }}</legend><SliderControl v-model="lightAz" :label="t('azimuth')" :min="-75" :max="75" :value-label="plus(lightAz)" /><SliderControl v-model="lightEl" :label="t('elevation')" :min="-30" :max="80" :value-label="`${lightEl}°`" /><SliderControl v-model="sourceSize" :label="t('sourceSize')" :min="0.2" :max="8" :step="0.2" :value-label="`${sourceSize.toFixed(1)}°`" /></fieldset>
            <fieldset class="control-section camera-section"><legend>{{ t('camera') }}</legend><SliderControl v-model="cameraAz" :label="t('azimuth')" :min="-65" :max="65" :value-label="plus(cameraAz)" /><SliderControl v-model="cameraEl" :label="t('elevation')" :min="-45" :max="60" :value-label="`${Math.round(cameraEl)}°`" /></fieldset>
          </div>
        </div>
      </section>
    </main>
    <div v-if="exported" class="toast" role="status">{{ t(exported) }}</div>
  </div>
</template>
