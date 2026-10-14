<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, useId, watch } from 'vue'

const props = defineProps({
  label: { type: String, required: true },
  min: { type: Number, required: true },
  max: { type: Number, required: true },
  step: Number,
  id: String,
  valueLabel: String,
  discreteValues: Array as () => number[],
  valueStops: Array as () => number[],
  discreteOnly: Boolean,
  layout: String as () => 'stacked' | 'inline',
  modelValue: { type: Number, required: true },
})
const emit = defineEmits<{ 'update:modelValue': [value: number] }>()
const model = computed({
  get: () => props.modelValue,
  set: (value: number) => emit('update:modelValue', value),
})
const inputId = computed(() => props.id || `embed-slider-${useId()}`)
const discrete = computed(() => props.discreteValues?.length ? props.discreteValues : undefined)
const scaledStops = computed(() => props.valueStops?.length ? props.valueStops : undefined)
const sliderStops = computed(() => discrete.value || scaledStops.value)
let animationId = 0
const sliderValue = computed({
  get: () => {
    if (!sliderStops.value)
      return model.value
    const stops = sliderStops.value
    if (model.value <= stops[0])
      return 0
    if (model.value >= stops[stops.length - 1])
      return stops.length - 1
    const index = stops.findIndex(value => value >= model.value)
    const from = stops[index - 1]
    const to = stops[index]
    return index - 1 + (model.value - from) / (to - from)
  },
  set: (value: number) => {
    if (!sliderStops.value) {
      model.value = value
      return
    }
    const stops = sliderStops.value
    const index = Math.min(stops.length - 1, Math.max(0, Math.floor(value)))
    if (props.discreteOnly) {
      model.value = stops[Math.round(value)]
      return
    }
    const fraction = value - index
    model.value = index === stops.length - 1
      ? stops[index]
      : stops[index] + (stops[index + 1] - stops[index]) * fraction
  },
})
const sliderMin = computed(() => sliderStops.value ? 0 : props.min)
const sliderMax = computed(() => sliderStops.value ? sliderStops.value.length - 1 : props.max)
const sliderStep = computed(() => sliderStops.value ? (props.discreteOnly ? 1 : 0.01) : (props.step || 1))
const displayValue = computed(() => props.valueLabel ?? model.value)

function animateTo(target: number) {
  if (animationId)
    cancelAnimationFrame(animationId)
  const from = model.value
  if (typeof window === 'undefined' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    model.value = target
    return
  }
  const startedAt = performance.now()
  const duration = 180
  const animate = (now: number) => {
    const progress = Math.min(1, (now - startedAt) / duration)
    const eased = 1 - (1 - progress) ** 3
    model.value = from + (target - from) * eased
    if (progress < 1) {
      animationId = requestAnimationFrame(animate)
    }
    else {
      animationId = 0
      model.value = target
    }
  }
  animationId = requestAnimationFrame(animate)
}

function settleDiscreteValue() {
  const stops = sliderStops.value
  if (!stops)
    return
  const target = stops.reduce((closest, candidate) => Math.abs(candidate - model.value) < Math.abs(closest - model.value) ? candidate : closest, stops[0])
  animateTo(target)
}

function snapModelToStop() {
  if (!props.discreteOnly || !sliderStops.value)
    return
  const stops = sliderStops.value
  const target = stops.reduce((closest, candidate) => Math.abs(candidate - model.value) < Math.abs(closest - model.value) ? candidate : closest, stops[0])
  if (model.value !== target)
    model.value = target
}

function handleDiscreteKeydown(event: KeyboardEvent) {
  const stops = sliderStops.value
  if (!stops)
    return
  const keys: Record<string, number> = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 1, PageDown: -1 }
  const direction = keys[event.key]
  if (direction) {
    event.preventDefault()
    const current = sliderValue.value
    const index = Math.min(stops.length - 1, Math.max(0, Math.round(current) + direction))
    model.value = stops[index]
  }
  else if (event.key === 'Home' || event.key === 'End') {
    event.preventDefault()
    model.value = event.key === 'Home' ? stops[0] : stops[stops.length - 1]
  }
}

onMounted(snapModelToStop)
watch(() => props.modelValue, snapModelToStop)
onBeforeUnmount(() => {
  if (animationId)
    cancelAnimationFrame(animationId)
})
</script>

<template>
  <label class="embed-demo-field embed-demo-slider" :class="{ 'is-inline': props.layout === 'inline' }" :for="inputId">
    <span class="embed-demo-slider__label">{{ props.label }}</span>
    <span class="embed-demo-slider__track">
      <input :id="inputId" v-model.number="sliderValue" type="range" :min="sliderMin" :max="sliderMax" :step="sliderStep" @pointerup="settleDiscreteValue" @pointercancel="settleDiscreteValue" @blur="settleDiscreteValue" @keydown="handleDiscreteKeydown">
      <span v-if="sliderStops" class="embed-demo-slider__ticks" aria-hidden="true">
        <span v-for="value in sliderStops" :key="value" />
      </span>
    </span>
    <output :for="inputId">{{ displayValue }}</output>
  </label>
</template>

<style scoped>
.embed-demo-field {
  display: grid;
  gap: 0.35rem;
  min-width: 0;
  font-size: 0.75rem;
}
.embed-demo-slider__label {
  opacity: 0.62;
}
.embed-demo-slider:not(.is-inline) .embed-demo-slider__label {
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
}
.embed-demo-slider:not(.is-inline) > output {
  display: none;
}
.embed-demo-slider.is-inline {
  display: grid;
  grid-template-columns: max-content minmax(4rem, 8rem) 2.5rem;
  align-items: center;
  gap: 0.5rem;
}
.embed-demo-slider.is-inline > output {
  text-align: right;
  white-space: nowrap;
}
output {
  font-variant-numeric: tabular-nums;
  opacity: 0.45;
}
.embed-demo-slider__track {
  position: relative;
  display: block;
  min-width: 0;
}
input[type='range'] {
  position: relative;
  z-index: 1;
  appearance: none;
  width: 100%;
  min-width: 0;
  height: 1rem;
  margin: 0;
  background: transparent;
  cursor: ew-resize;
}
input[type='range']::-webkit-slider-runnable-track {
  height: 1px;
  background: #8888;
}
input[type='range']::-webkit-slider-thumb {
  appearance: none;
  width: 0.65rem;
  height: 0.65rem;
  margin-top: -0.27rem;
  border: 1px solid var(--c-bg);
  border-radius: 0;
  background: currentColor;
}
input[type='range']::-moz-range-track {
  height: 1px;
  background: #8888;
}
input[type='range']::-moz-range-progress {
  height: 1px;
  background: currentColor;
}
input[type='range']::-moz-range-thumb {
  width: 0.65rem;
  height: 0.65rem;
  border: 1px solid var(--c-bg);
  border-radius: 0;
  background: currentColor;
}
input[type='range']:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 3px;
}
.embed-demo-slider__ticks {
  position: absolute;
  inset: 50% 0.325rem auto;
  z-index: 0;
  display: flex;
  justify-content: space-between;
  pointer-events: none;
  transform: translateY(-50%);
}
.embed-demo-slider__ticks > span {
  width: 1px;
  height: 0.4rem;
  background: #8888;
}
@media (prefers-reduced-motion: reduce) {
  input[type='range']::-webkit-slider-thumb,
  input[type='range']::-moz-range-thumb {
    transition: none;
  }
}
</style>
