<script setup lang="ts">
const props = defineProps<{ modelValue: 'zh' | 'en' }>()
const emit = defineEmits<{ 'update:modelValue': [value: 'zh' | 'en'] }>()
</script>

<template>
  <div class="demo-language-switch ui-control-set" role="radiogroup" aria-label="Language / 語言">
    <button
      type="button"
      role="radio"
      :aria-checked="props.modelValue === 'zh'"
      class="ui-control"
      :class="{ active: props.modelValue === 'zh' }"
      @click="emit('update:modelValue', 'zh')"
    >
      中文
    </button>
    <button
      type="button"
      role="radio"
      :aria-checked="props.modelValue === 'en'"
      class="ui-control"
      :class="{ active: props.modelValue === 'en' }"
      @click="emit('update:modelValue', 'en')"
    >
      English
    </button>
  </div>
</template>

<style scoped>
.demo-language-switch {
  justify-content: flex-end;
}
.demo-language-switch .ui-control {
  min-width: 3.5rem;
}
</style>
