<script setup lang="ts">
import { computed, ref } from 'vue'

const props = defineProps<{
  locale: 'zh' | 'en'
  selected: number[]
  metrics: {
    backend: string
    rasterBackend: string
    adapter: string
    reason: string
    capabilities: string
    width: number
    height: number
    frameWidth: number
    frameHeight: number
    duration: number
    roundtrip: number
    paint: number
    mean: number
    p95: number
    rate: number
    frames: number
    count: number
    geometryBytes: number
  }
  state: string
  pending: boolean
  inFlight: boolean
}>()
const open = ref(true)
const copy = computed(() => props.locale === 'zh'
  ? {
      title: '渲染調試',
      pipeline: '目前管線',
      raster: '位圖後端',
      adapter: 'GPU 適配器',
      reason: '回退／錯誤原因',
      capabilities: '瀏覽器能力',
      selected: '所選分辨率',
      actual: '實際分辨率',
      frameSize: '此幀請求尺寸',
      scale: '分辨率比例',
      duration: 'Worker 耗時',
      roundtrip: '請求往返',
      paint: 'Canvas 繪製',
      mean: '最近 60 幀平均',
      p95: '最近 60 幀 P95',
      rate: '最近 1 秒畫面更新',
      frames: '完成幀數',
      count: '總刻線數',
      geometry: '刻線數據',
      state: '操作狀態',
      queue: '渲染／等待',
      yes: '是',
      no: '否',
      none: '無',
      unknown: '未提供',
      waiting: '等待初始化',
      note: '更新率只統計完成的位圖畫面，不代表顯示器 FPS。旋轉簽名每圈包含 48 個動畫階段。',
    }
  : {
      title: 'Render diagnostics',
      pipeline: 'Current pipeline',
      raster: 'Raster backend',
      adapter: 'GPU adapter',
      reason: 'Fallback / error reason',
      capabilities: 'Browser capabilities',
      selected: 'Selected resolution',
      actual: 'Actual resolution',
      frameSize: 'Frame request size',
      scale: 'Resolution scale',
      duration: 'Worker time',
      roundtrip: 'Request round trip',
      paint: 'Canvas paint',
      mean: 'Last 60 frames mean',
      p95: 'Last 60 frames P95',
      rate: 'Image updates / last second',
      frames: 'Completed frames',
      count: 'Total grooves',
      geometry: 'Geometry data',
      state: 'Activity',
      queue: 'Rendering / pending',
      yes: 'Yes',
      no: 'No',
      none: 'None',
      unknown: 'Not reported',
      waiting: 'Initializing',
      note: 'Update rate counts completed raster images, not display FPS. The rotating signature contains 48 animation stages per turn.',
    })
const pipeline = computed(() => {
  const geometry = props.locale === 'zh' ? 'WASM 刻線' : 'WASM geometry'
  const raster = props.locale === 'zh' ? 'WASM 位圖' : 'WASM raster'
  return ({
    webgpu: `${geometry} → WebGPU / WGSL → ImageBitmap → Canvas 2D`,
    wasm: `${geometry} → ${raster} → RGBA → Canvas 2D`,
    geometry: `${geometry} → SVG`,
  })[props.metrics.backend] || copy.value.waiting
})
const rows = computed(() => {
  const m = props.metrics
  const ms = (value: number) => m.frames ? `${value.toFixed(2)} ms` : '—'
  const size = (width: number, height: number) => width && height ? `${width} × ${height}` : '—'
  return [
    ['pipeline', pipeline.value],
    ['raster', m.rasterBackend || copy.value.waiting],
    ['adapter', m.adapter || copy.value.unknown],
    ['reason', m.reason || copy.value.none],
    ['capabilities', m.capabilities || '—'],
    ['selected', size(...props.selected as [number, number])],
    ['frameSize', size(m.frameWidth, m.frameHeight)],
    ['actual', m.backend === 'geometry' ? 'SVG' : size(m.width, m.height)],
    ['scale', m.backend === 'geometry' || !m.width ? '—' : `${(m.width / m.frameWidth * 100).toFixed(1)}% × ${(m.height / m.frameHeight * 100).toFixed(1)}%`],
    ['duration', ms(m.duration)],
    ['roundtrip', ms(m.roundtrip)],
    ['paint', ms(m.paint)],
    ['mean', ms(m.mean)],
    ['p95', ms(m.p95)],
    ['rate', `${m.rate}`],
    ['frames', `${m.frames}`],
    ['count', `${m.count}`],
    ['geometry', `${(m.geometryBytes / 1024).toFixed(1)} KiB`],
    ['state', props.state],
    ['queue', `${props.inFlight ? copy.value.yes : copy.value.no} / ${props.pending ? copy.value.yes : copy.value.no}`],
  ].map(([key, value]) => ({ key, label: copy.value[key], value }))
})
</script>

<template>
  <details class="render-diagnostics" :open="open" @toggle="open = ($event.target as HTMLDetailsElement).open">
    <summary>{{ copy.title }}</summary>
    <div v-if="open" class="render-diagnostics__body">
      <dl>
        <div v-for="row in rows" :key="row.key" :data-metric="row.key">
          <dt>{{ row.label }}</dt><dd>{{ row.value }}</dd>
        </div>
      </dl>
      <p>{{ copy.note }}</p>
    </div>
  </details>
</template>

<style scoped>
.render-diagnostics {
  margin-block: 0;
  border-top: 1px solid var(--line-soft);
  border-bottom: 0;
  font-size: 0.75rem;
  min-width: 0;
}
summary {
  padding-block: 1.25rem;
  cursor: pointer;
  color: var(--c-fg-deep);
}
summary:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 2px;
}
dl {
  margin: 0;
}
dl > div {
  display: grid;
  grid-template-columns: minmax(8rem, 0.35fr) minmax(0, 1fr);
  gap: 0.75rem;
  padding-block: 0.3rem;
}
dt {
  color: var(--c-fg);
}
dd {
  margin: 0;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
  color: var(--c-fg-deep);
}
p {
  margin-block: 0.65rem;
  color: var(--c-fg);
  font-size: 0.7rem;
}
@media (max-width: 480px) {
  dl > div {
    grid-template-columns: minmax(0, 1fr);
    gap: 0.1rem;
  }
}
</style>
