import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const schemeKey = 'scratch-hologram-color-scheme'
const toneKey = 'scratch-hologram-soft-theme'

function readPreference(key) {
  try {
    return localStorage.getItem(key)
  }
  catch {
    return null
  }
}

function savePreference(key, value) {
  try {
    localStorage.setItem(key, value)
  }
  catch {
    // Theme controls still work when browser storage is unavailable.
  }
}

function parseScheme(value) {
  return value === 'light' || value === 'dark' ? value : 'auto'
}

export function useTheme() {
  const systemTheme = window.matchMedia('(prefers-color-scheme: dark)')
  const prefersDark = ref(systemTheme.matches)
  const scheme = ref(parseScheme(readPreference(schemeKey)))
  const isSoftTheme = ref(readPreference(toneKey) === 'true')
  const isDark = computed(() => scheme.value === 'dark' || (scheme.value === 'auto' && prefersDark.value))
  let appearanceTransition
  let syncingStoredTheme = false

  watch([isDark, isSoftTheme], ([dark, soft]) => {
    document.documentElement.classList.toggle('dark', dark)
    document.documentElement.classList.toggle('soft-theme', soft)
  }, { immediate: true, flush: 'sync' })
  watch(scheme, (value) => {
    if (!syncingStoredTheme)
      savePreference(schemeKey, value)
  }, { flush: 'sync' })
  watch(isSoftTheme, (value) => {
    if (!syncingStoredTheme)
      savePreference(toneKey, String(value))
  }, { flush: 'sync' })

  function updateSystemTheme() {
    prefersDark.value = systemTheme.matches
  }

  function updateStoredTheme(event) {
    // Read the latest shared values without echoing delayed storage events.
    syncingStoredTheme = true
    try {
      if (event.key === schemeKey || event.key === null)
        scheme.value = parseScheme(readPreference(schemeKey))
      if (event.key === toneKey || event.key === null)
        isSoftTheme.value = readPreference(toneKey) === 'true'
    }
    finally {
      syncingStoredTheme = false
    }
  }

  onMounted(() => {
    systemTheme.addEventListener('change', updateSystemTheme)
    window.addEventListener('focus', updateSystemTheme)
    document.addEventListener('visibilitychange', updateSystemTheme)
    window.addEventListener('storage', updateStoredTheme)
  })
  onBeforeUnmount(() => {
    systemTheme.removeEventListener('change', updateSystemTheme)
    window.removeEventListener('focus', updateSystemTheme)
    document.removeEventListener('visibilitychange', updateSystemTheme)
    window.removeEventListener('storage', updateStoredTheme)
    appearanceTransition?.skipTransition()
  })

  async function toggleDark(event) {
    const dark = !isDark.value
    const apply = () => {
      scheme.value = dark === prefersDark.value ? 'auto' : dark ? 'dark' : 'light'
    }
    appearanceTransition?.skipTransition()
    if (!document.startViewTransition || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      apply()
      return
    }

    const bounds = event.currentTarget.getBoundingClientRect()
    const x = event.detail === 0 ? bounds.left + bounds.width / 2 : event.clientX
    const y = event.detail === 0 ? bounds.top + bounds.height / 2 : event.clientY
    const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y))
    const transition = document.startViewTransition(async () => {
      apply()
      await nextTick()
    })
    appearanceTransition = transition
    try {
      await transition.ready
      const clipPath = [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`]
      await document.documentElement.animate(
        { clipPath: dark ? [...clipPath].reverse() : clipPath },
        {
          duration: 400,
          easing: 'ease-out',
          fill: 'forwards',
          pseudoElement: dark ? '::view-transition-old(root)' : '::view-transition-new(root)',
        },
      ).finished
    }
    catch {
      // A skipped transition keeps the selected theme without an animation.
    }
    finally {
      if (appearanceTransition === transition)
        appearanceTransition = undefined
    }
  }

  function toggleSoftTheme() {
    isSoftTheme.value = !isSoftTheme.value
  }

  return { isDark, isSoftTheme, toggleDark, toggleSoftTheme }
}
