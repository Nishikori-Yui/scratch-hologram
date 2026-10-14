<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId } from 'vue'

interface SelectOption {
  value: string
  label: string
  group?: string
}

const props = defineProps({
  label: { type: String, required: true },
  options: { type: Array as () => SelectOption[], required: true },
  id: String,
  layout: String as () => 'stacked' | 'inline',
  modelValue: { type: String, required: true },
})
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const model = computed({
  get: () => props.modelValue,
  set: (value: string) => emit('update:modelValue', value),
})
const uid = useId().replaceAll(':', '-')
const inputId = computed(() => props.id || `embed-select-${uid}`)
const labelId = computed(() => `${inputId.value}-label`)
const listboxId = computed(() => `${inputId.value}-listbox`)
const root = ref<HTMLElement>()
const expanded = ref(false)
const activeIndex = ref(0)

const selectedIndex = computed(() => Math.max(0, props.options.findIndex(option => option.value === model.value)))
const selectedOption = computed(() => props.options[selectedIndex.value])
const optionGroups = computed(() => {
  const groups: Array<{ label?: string, options: Array<{ option: SelectOption, index: number }> }> = []
  for (const [index, option] of props.options.entries()) {
    const last = groups.at(-1)
    if (!last || last.label !== option.group)
      groups.push({ label: option.group, options: [] })
    groups.at(-1)!.options.push({ option, index })
  }
  return groups
})

function close() {
  expanded.value = false
}

function selectOption(index: number) {
  const option = props.options[index]
  if (!option)
    return
  model.value = option.value
  close()
}

function toggle() {
  if (expanded.value) {
    close()
    return
  }
  activeIndex.value = selectedIndex.value
  expanded.value = true
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    if (!expanded.value) {
      activeIndex.value = selectedIndex.value
      expanded.value = true
      return
    }
    const direction = event.key === 'ArrowDown' ? 1 : -1
    activeIndex.value = (activeIndex.value + direction + props.options.length) % props.options.length
  }
  else if (event.key === 'Home' && expanded.value) {
    event.preventDefault()
    activeIndex.value = 0
  }
  else if (event.key === 'End' && expanded.value) {
    event.preventDefault()
    activeIndex.value = props.options.length - 1
  }
  else if ((event.key === 'Enter' || event.key === ' ') && expanded.value) {
    event.preventDefault()
    selectOption(activeIndex.value)
  }
  else if (event.key === 'Escape' && expanded.value) {
    event.preventDefault()
    close()
  }
}

function handleOutsidePointer(event: PointerEvent) {
  if (root.value && !root.value.contains(event.target as Node))
    close()
}

onMounted(() => document.addEventListener('pointerdown', handleOutsidePointer))
onBeforeUnmount(() => document.removeEventListener('pointerdown', handleOutsidePointer))
</script>

<template>
  <div ref="root" class="embed-demo-field embed-demo-select" :class="{ 'is-inline': props.layout === 'inline' }">
    <span :id="labelId" class="embed-demo-select__label">
      {{ props.label }}
    </span>
    <div class="embed-demo-select__control">
      <button
        :id="inputId"
        class="embed-demo-select__trigger"
        type="button"
        role="combobox"
        aria-autocomplete="none"
        :aria-labelledby="labelId"
        :aria-controls="listboxId"
        :aria-activedescendant="expanded ? `${inputId}-option-${activeIndex}` : undefined"
        :aria-expanded="expanded"
        aria-haspopup="listbox"
        @click="toggle"
        @keydown="handleKeydown"
      >
        <span>{{ selectedOption?.label }}</span>
        <span class="embed-demo-select__chevron" aria-hidden="true" />
      </button>
      <ul v-if="expanded" :id="listboxId" class="embed-demo-select__menu" role="listbox" :aria-labelledby="labelId">
        <template v-for="(group, groupIndex) in optionGroups" :key="group.label || `group-${groupIndex}`">
          <li v-if="group.label" class="embed-demo-select__group" role="presentation">
            {{ group.label }}
          </li>
          <li
            v-for="item in group.options"
            :id="`${inputId}-option-${item.index}`"
            :key="item.option.value"
            class="embed-demo-select__option"
            :class="{ 'is-active': activeIndex === item.index, 'is-selected': model === item.option.value }"
            role="option"
            :aria-selected="model === item.option.value"
            @mouseenter="activeIndex = item.index"
            @mousedown.prevent="selectOption(item.index)"
            @click="selectOption(item.index)"
          >
            {{ item.option.label }}
          </li>
        </template>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.embed-demo-field {
  display: grid;
  gap: 0.35rem;
  min-width: 0;
  font-size: 0.75rem;
}
.embed-demo-select__label {
  opacity: 0.62;
}
.embed-demo-select.is-inline {
  display: grid;
  grid-template-columns: max-content minmax(8rem, max-content);
  align-items: center;
  gap: 0.7rem;
}
.embed-demo-select.is-inline .embed-demo-select__control {
  min-width: 10rem;
}
@media (max-width: 40rem) {
  .embed-demo-select.is-inline {
    grid-template-columns: minmax(0, 1fr);
    align-items: start;
    gap: 0.35rem;
  }
}
.embed-demo-select__control {
  position: relative;
  width: fit-content;
  min-width: min(11rem, 100%);
  max-width: 100%;
}
.embed-demo-select__trigger {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  width: 100%;
  min-width: 0;
  min-height: 2.15rem;
  padding: 0.35rem 1.6rem 0.35rem 0.6rem;
  border: 1px solid var(--control-border);
  border-radius: var(--control-radius);
  background: transparent;
  color: inherit;
  font: inherit;
  line-height: 1.2;
  cursor: pointer;
  transition:
    background-color 160ms ease,
    border-color 160ms ease;
}
.embed-demo-select__trigger > span:first-child {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.embed-demo-select__trigger:hover,
.embed-demo-select__trigger[aria-expanded='true'] {
  border-color: var(--control-border-active);
  background: var(--control-surface-hover);
}
.embed-demo-select__trigger:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: -2px;
}
.embed-demo-select__chevron {
  position: absolute;
  top: 50%;
  right: 0.45rem;
  width: 0;
  height: 0;
  border: 0.28rem solid transparent;
  border-top-color: currentColor;
  transform: translateY(-20%);
}
.embed-demo-select__menu {
  position: absolute;
  z-index: 30;
  top: calc(100% + 0.2rem);
  left: 0;
  width: max-content;
  min-width: 100%;
  max-width: min(26rem, calc(100vw - 2rem));
  max-height: 12rem;
  overflow-y: auto;
  margin: 0;
  padding: 0;
  border: 1px solid var(--control-border-active);
  border-radius: 0;
  background: var(--c-bg);
  color: var(--fg-deep);
  box-shadow: 0 0.35rem 0.8rem color-mix(in srgb, var(--fg) 12%, transparent);
  list-style: none;
  scrollbar-width: thin;
  scrollbar-color: var(--control-border-active) transparent;
}
.embed-demo-select__group {
  padding: 0.3rem 0.6rem;
  font-size: 0.72rem;
  font-weight: 600;
  line-height: 1.2;
}
.embed-demo-select__option {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  box-sizing: border-box;
  height: 2rem;
  min-height: 2rem;
  padding: 0 0.6rem;
  font-size: 0.72rem;
  line-height: 1.2;
  cursor: pointer;
  transition: background-color 120ms ease;
}
.embed-demo-select__option.is-active {
  background: var(--control-surface-hover);
}
.embed-demo-select__option.is-selected {
  background: color-mix(in srgb, var(--c-fg-deep) 16%, var(--c-bg));
  color: var(--c-fg-deep);
  font-weight: 600;
}
.embed-demo-select__option.is-active.is-selected {
  background: color-mix(in srgb, var(--c-fg-deep) 22%, var(--c-bg));
}
@media (prefers-reduced-motion: reduce) {
  .embed-demo-select__trigger,
  .embed-demo-select__option {
    transition: none;
  }
}
</style>
