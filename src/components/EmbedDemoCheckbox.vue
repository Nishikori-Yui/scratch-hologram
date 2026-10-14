<script setup lang="ts">
import { computed, useId } from 'vue'

const props = defineProps<{ label: string, id?: string }>()
const model = defineModel<boolean>({ required: true })
const inputId = computed(() => props.id || `embed-checkbox-${useId()}`)
</script>

<template>
  <label class="embed-demo-checkbox" :for="inputId">
    <input :id="inputId" v-model="model" type="checkbox">
    <span class="embed-demo-checkbox__switch" aria-hidden="true" />
    <span>{{ props.label }}</span>
  </label>
</template>

<style scoped>
.embed-demo-checkbox {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  min-height: 2.15rem;
  font-size: 0.75rem;
  cursor: pointer;
}
.embed-demo-checkbox input {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}
.embed-demo-checkbox__switch {
  position: relative;
  display: grid;
  width: 2rem;
  height: 1.1rem;
  flex-shrink: 0;
  place-items: center;
  border: 1px solid #8885;
  background: transparent;
  transition: all 160ms cubic-bezier(0.4, 0, 0.2, 1);
}
.embed-demo-checkbox__switch::before {
  content: '';
  position: absolute;
  left: 0.125rem;
  width: 0.7rem;
  height: 0.7rem;
  background: #8888;
  transition: all 160ms cubic-bezier(0.4, 0, 0.2, 1);
}
.embed-demo-checkbox input:checked + .embed-demo-checkbox__switch {
  border-color: currentColor;
  background: currentColor;
  opacity: 0.9;
}
.embed-demo-checkbox input:checked + .embed-demo-checkbox__switch::before {
  left: calc(100% - 0.125rem);
  background: var(--c-bg);
  transform: translateX(-100%);
}
.embed-demo-checkbox input:focus-visible + .embed-demo-checkbox__switch {
  outline: 2px solid currentColor;
  outline-offset: 3px;
}
@media (prefers-reduced-motion: reduce) {
  .embed-demo-checkbox__switch,
  .embed-demo-checkbox__switch::before {
    transition: none;
  }
}
</style>
