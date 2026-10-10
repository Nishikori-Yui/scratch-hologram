<script setup>
import { useId } from 'vue'
defineProps({ label: String, min: Number, max: Number, step: { type: Number, default: 1 }, valueLabel: String, stops: Array })
const model = defineModel({ type: Number, required: true })
const id = useId()
</script>

<template>
  <label class="slider-control" :for="id">
    <span><span>{{ label }}</span><output :for="id">{{ valueLabel ?? model }}</output></span>
    <input :id="id" v-model.number="model" type="range" :min="min" :max="max" :step="step" :list="stops ? `${id}-stops` : undefined" />
    <template v-if="stops">
      <datalist :id="`${id}-stops`"><option v-for="stop in stops" :key="stop.value" :value="stop.value" :label="stop.label" /></datalist>
      <span class="slider-stops" aria-hidden="true"><small v-for="stop in stops" :key="stop.value">{{ stop.label }}</small></span>
    </template>
  </label>
</template>
