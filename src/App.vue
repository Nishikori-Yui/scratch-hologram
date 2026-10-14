<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import DemoLanguageSwitch from './components/DemoLanguageSwitch.vue'
import ScratchHologramEmbed from './components/ScratchHologramEmbed.vue'
import ThemeControls from './components/ThemeControls.vue'

const language = ref<'zh' | 'en'>('en')
const interactionEnabled = ref(false)
const copy = computed(() => language.value === 'zh'
  ? {
      title: '劃痕全息圖',
      description: '用劃痕重建立體影像。調整光源、觀察角度和劃痕密度，看看圖形如何浮現在圓盤表面。',
    }
  : {
      title: 'Scratch Hologram',
      description: 'Reconstruct a 3D image with scratches. Adjust the light, viewing angle, and scratch density to see a shape emerge from a reflective disc.',
    })
watch(language, (value) => {
  document.documentElement.lang = value === 'zh' ? 'zh-Hant' : 'en'
  document.title = copy.value.title
  document.querySelector('meta[name="description"]')?.setAttribute('content', copy.value.description)
}, { immediate: true })
</script>

<template>
  <div class="scratch-hologram-page">
    <header class="demo-page-header">
      <div class="demo-page-header__top">
        <ThemeControls :locale="language" />
      </div>
      <div class="demo-page-header__main">
        <div class="demo-page-header__copy">
          <h1>{{ copy.title }}</h1>
        </div>
        <div class="demo-page-header__language">
          <span>{{ language === 'zh' ? '介面語言' : 'Interface language' }}</span>
          <DemoLanguageSwitch v-model="language" />
        </div>
      </div>
      <p class="demo-page-header__description">
        {{ copy.description }}
      </p>
    </header>
    <ScratchHologramEmbed v-model:locale="language" v-model:interactive="interactionEnabled" diagnostics />
  </div>
</template>
