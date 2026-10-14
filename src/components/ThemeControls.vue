<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useTheme } from '../theme.js'

const props = defineProps<{ locale: 'zh' | 'en' }>()
const { isDark, isSoftTheme, toggleDark, toggleSoftTheme } = useTheme()
const copy = computed(() => props.locale === 'zh'
  ? {
      appearance: '外觀',
      scheme: '切換深淺模式',
      light: '切換到淺色模式',
      dark: '切換到深色模式',
      tone: '柔和色調',
      soft: '開啟柔和色調',
      contrast: '關閉柔和色調',
    }
  : {
      appearance: 'Appearance',
      scheme: 'Toggle color scheme',
      light: 'Switch to light mode',
      dark: 'Switch to dark mode',
      tone: 'Soft tone',
      soft: 'Enable soft tone',
      contrast: 'Disable soft tone',
    })

const circleOutline = 'M12 2 C6.477 2 2 6.477 2 12 C2 17.523 6.477 22 12 22 C17.523 22 22 17.523 22 12 C22 6.477 17.523 2 12 2 Z'
const dropOutline = 'M12 2 C9.6 4.4 4 8.2 4 13 C4 18 7.6 22 12 22 C16.4 22 20 18 20 13 C20 8.2 14.4 4.4 12 2 Z'
const circleFill = 'M12 5 C8.134 5 5 8.134 5 12 C5 15.866 8.134 19 12 19 L12 5 Z'
const dropFill = 'M12 5 C10.8 6.7 7 10 7 13 C7 16.3 9 19 12 19 L12 5 Z'
const pathNumber = /-?\d+(?:\.\d+)?/g
const toneProgress = ref(isSoftTheme.value ? 1 : 0)
let frame: number | undefined

function interpolatePath(from: string, to: string, progress: number) {
  const target = to.match(pathNumber)!.map(Number)
  let index = 0
  return from.replace(pathNumber, (value) => {
    const start = Number(value)
    return String(Math.round((start + (target[index++] - start) * progress) * 1000) / 1000)
  })
}

watch(isSoftTheme, (soft) => {
  if (frame !== undefined)
    cancelAnimationFrame(frame)
  const target = soft ? 1 : 0
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    toneProgress.value = target
    frame = undefined
    return
  }
  const start = toneProgress.value
  const startedAt = performance.now()
  function animate(now: number) {
    const elapsed = Math.min((now - startedAt) / 240, 1)
    const eased = 1 - (1 - elapsed) ** 3
    toneProgress.value = start + (target - start) * eased
    frame = elapsed < 1 ? requestAnimationFrame(animate) : undefined
  }
  frame = requestAnimationFrame(animate)
})
onBeforeUnmount(() => {
  if (frame !== undefined)
    cancelAnimationFrame(frame)
})

const toneOutlinePath = computed(() => interpolatePath(circleOutline, dropOutline, toneProgress.value))
const toneFillPath = computed(() => interpolatePath(circleFill, dropFill, toneProgress.value))
</script>

<template>
  <div class="theme-controls" role="group" :aria-label="copy.appearance">
    <button class="theme-toggle theme-tone-toggle" type="button" :title="isSoftTheme ? copy.contrast : copy.soft" :aria-label="copy.tone" :aria-pressed="isSoftTheme" @click="toggleSoftTheme">
      <svg class="theme-tone-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path class="theme-tone-icon__outline" :d="toneOutlinePath" />
        <path :d="toneFillPath" fill="currentColor" />
      </svg>
    </button>
    <button class="theme-toggle theme-scheme-toggle" type="button" :title="isDark ? copy.light : copy.dark" :aria-label="copy.scheme" :aria-pressed="isDark" @click="toggleDark">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path v-if="isDark" d="M20.9 13a9 9 0 0 1-9.9-9.9A9 9 0 1 0 20.9 13Z" />
        <template v-else>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2 M12 20v2 M2 12h2 M20 12h2 M4.93 4.93l1.42 1.42 M17.65 17.65l1.42 1.42 M4.93 19.07l1.42-1.42 M17.65 6.35l1.42-1.42" />
        </template>
      </svg>
    </button>
  </div>
</template>

<style scoped>
.theme-controls {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}
.theme-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.15rem;
  height: 2.15rem;
  flex-shrink: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  opacity: 0.58;
  transition: opacity 0.2s;
}
.theme-toggle:hover,
.theme-toggle[aria-pressed='true'] {
  opacity: 1;
}
.theme-toggle:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 3px;
}
.theme-toggle svg {
  width: 1.2rem;
  height: 1.2rem;
}
.theme-tone-icon__outline {
  stroke: currentColor;
  stroke-width: 2;
}
</style>
