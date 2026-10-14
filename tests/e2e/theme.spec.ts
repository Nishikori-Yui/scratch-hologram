import { expect, test } from '@playwright/test'

test.use({ colorScheme: 'light' })

test('theme controls apply four palettes in both languages and narrow layouts', async ({ page }, testInfo) => {
  test.setTimeout(60_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await expect(page.locator('.loading-layer')).toHaveCount(0)
  const scheme = page.locator('.theme-scheme-toggle')
  const tone = page.locator('.theme-tone-toggle')
  const palettes = [
    { dark: false, soft: false, background: 'rgb(255, 255, 255)' },
    { dark: false, soft: true, background: 'rgb(245, 245, 242)' },
    { dark: true, soft: true, background: 'rgb(27, 27, 27)' },
    { dark: true, soft: false, background: 'rgb(5, 5, 5)' },
  ]
  for (const locale of ['en', 'zh']) {
    await page.getByRole('radio', { name: locale === 'en' ? 'English' : '中文', exact: true }).click()
    await expect(scheme).toHaveAccessibleName(locale === 'en' ? 'Toggle color scheme' : '切換深淺模式')
    await expect(tone).toHaveAccessibleName(locale === 'en' ? 'Soft tone' : '柔和色調')
    for (const width of [1440, 640, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 })
      for (const palette of palettes) {
        if (await scheme.getAttribute('aria-pressed') !== String(palette.dark))
          await scheme.click()
        if (await tone.getAttribute('aria-pressed') !== String(palette.soft))
          await tone.click()
        await expect(scheme).toHaveAttribute('aria-pressed', String(palette.dark))
        await expect(tone).toHaveAttribute('aria-pressed', String(palette.soft))
        await expect(page.locator('html')).toHaveCSS('background-color', palette.background)
        await expect(page.locator('.scratch-hologram-studio')).toHaveCSS('background-color', palette.background)
        await expect(page.locator('.scratch-hologram-studio')).toHaveCSS('color-scheme', palette.dark ? 'dark' : 'light')
        const layout = await page.evaluate(() => {
          const root = document.documentElement
          const luminance = (color: string) => {
            const [r, g, b] = color.match(/\d+/g)!.map(Number).map((channel) => {
              const value = channel / 255
              return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
            })
            return 0.2126 * r + 0.7152 * g + 0.0722 * b
          }
          const style = getComputedStyle(root)
          const light = luminance(style.backgroundColor)
          const dark = luminance(style.color)
          const controls = [...document.querySelectorAll('.theme-toggle')].map(node => node.getBoundingClientRect())
          const header = document.querySelector('.demo-page-header')!.getBoundingClientRect()
          const themes = document.querySelector('.theme-controls')!.getBoundingClientRect()
          const language = document.querySelector('.demo-page-header__language')!.getBoundingClientRect()
          return {
            overflow: root.scrollWidth > innerWidth,
            contentWidth: header.width,
            contrast: (Math.max(light, dark) + 0.05) / (Math.min(light, dark) + 0.05),
            sizes: controls.map(bounds => [bounds.width, bounds.height]),
            rightOffset: header.right - themes.right,
            topOffset: themes.top - header.top,
            focusFitsViewport: themes.top >= 5,
            themesAboveLanguage: themes.bottom <= language.top,
          }
        })
        expect(layout.overflow).toBe(false)
        if (width === 1440)
          expect(layout.contentWidth).toBe(720)
        expect(layout.contrast).toBeGreaterThan(4.5)
        expect(layout.sizes[0]).toEqual(layout.sizes[1])
        expect(Math.abs(layout.rightOffset)).toBeLessThan(1)
        expect(layout.topOffset).toBe(-16)
        expect(layout.focusFitsViewport).toBe(true)
        expect(layout.themesAboveLanguage).toBe(true)
        await tone.hover()
        await expect(tone).toHaveCSS('opacity', '1')
        await scheme.focus()
        await page.keyboard.press('Tab')
        await page.keyboard.press('Shift+Tab')
        await expect(scheme).toHaveCSS('outline-width', '2px')
        await page.screenshot({
          path: testInfo.outputPath(`theme-${locale}-${width}-${palette.dark ? 'dark' : 'light'}-${palette.soft ? 'soft' : 'normal'}.png`),
          fullPage: true,
        })
      }
    }
  }
  await scheme.focus()
  const previous = await scheme.getAttribute('aria-pressed')
  await page.keyboard.press('Enter')
  await expect(scheme).toHaveAttribute('aria-pressed', previous === 'true' ? 'false' : 'true')
  await tone.focus()
  await page.keyboard.press('Space')
  await expect(tone).toHaveAttribute('aria-pressed', 'true')
  expect(errors).toEqual([])
})

test('system preference, saved overrides and storage events stay in sync', async ({ page, context }) => {
  await page.goto('/')
  const scheme = page.locator('.theme-scheme-toggle')
  const tone = page.locator('.theme-tone-toggle')
  await expect(scheme).toHaveAttribute('aria-pressed', 'false')
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(scheme).toHaveAttribute('aria-pressed', 'true')
  await scheme.click()
  await expect(scheme).toHaveAttribute('aria-pressed', 'false')
  await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(255, 255, 255)')
  await tone.click()
  await page.reload()
  await expect(scheme).toHaveAttribute('aria-pressed', 'false')
  await expect(tone).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(245, 245, 242)')

  const other = await context.newPage()
  await other.goto('/')
  await expect(other.locator('.theme-tone-toggle')).toHaveAttribute('aria-pressed', 'true')
  await other.locator('.theme-scheme-toggle').click()
  await expect(scheme).toHaveAttribute('aria-pressed', 'true')
  await other.locator('.theme-tone-toggle').click()
  await expect(tone).toHaveAttribute('aria-pressed', 'false')
  await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(5, 5, 5)')
  await other.evaluate(() => localStorage.clear())
  await expect(tone).toHaveAttribute('aria-pressed', 'false')
  await page.bringToFront()
  await expect(scheme).toHaveAttribute('aria-pressed', 'true')
  await page.emulateMedia({ colorScheme: 'light' })
  await expect(scheme).toHaveAttribute('aria-pressed', 'false')
  await scheme.click()
  await expect(scheme).toHaveAttribute('aria-pressed', 'true')
  await scheme.click()
  await expect(scheme).toHaveAttribute('aria-pressed', 'false')
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(scheme).toHaveAttribute('aria-pressed', 'true')
  await other.close()
})

test('saved appearance is applied before the Vue bundle loads', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('scratch-hologram-color-scheme', 'dark')
    localStorage.setItem('scratch-hologram-soft-theme', 'true')
  })
  let release!: () => void
  const blocked = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/assets/index-*.js', async (route) => {
    await blocked
    await route.continue()
  })
  try {
    await page.goto('/', { waitUntil: 'commit' })
    await expect(page.locator('html')).toHaveClass(/dark/)
    await expect(page.locator('html')).toHaveClass(/soft-theme/)
    await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(27, 27, 27)')
    await expect(page.locator('.theme-controls')).toHaveCount(0)
  }
  finally {
    release()
  }
  await expect(page.locator('.theme-tone-toggle')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.theme-scheme-toggle')).toHaveAttribute('aria-pressed', 'true')
})

test('transitions animate from the control and respect reduced motion and API fallback', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.addInitScript(() => {
    const state = { transitions: 0, animations: [] as { pseudoElement: string, clipPath: string[] }[] }
    ;(window as any).themeTest = state
    const start = document.startViewTransition.bind(document)
    document.startViewTransition = ((update: any) => {
      state.transitions++
      return start(update)
    }) as typeof document.startViewTransition
    const animate = Element.prototype.animate
    Element.prototype.animate = function (frames: any, options: any) {
      if (options?.pseudoElement)
        state.animations.push({ pseudoElement: options.pseudoElement, clipPath: frames.clipPath })
      return animate.call(this, frames, options)
    }
  })
  await page.goto('/')
  const scheme = page.locator('.theme-scheme-toggle')
  const tone = page.locator('.theme-tone-toggle')
  const outline = tone.locator('.theme-tone-icon__outline')
  const normal = await outline.getAttribute('d')
  await tone.click()
  await expect(outline).not.toHaveAttribute('d', normal!)
  const bounds = await scheme.boundingBox()
  await scheme.focus()
  await page.keyboard.press('Enter')
  await expect(scheme).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => page.evaluate(() => (window as any).themeTest.animations.length)).toBe(1)
  const animation = await page.evaluate(() => (window as any).themeTest.animations[0])
  expect(animation.pseudoElement).toBe('::view-transition-old(root)')
  expect(animation.clipPath[1]).toBe(`circle(0px at ${bounds!.x + bounds!.width / 2}px ${bounds!.y + bounds!.height / 2}px)`)

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await scheme.click()
  await expect(scheme).toHaveAttribute('aria-pressed', 'false')
  expect(await page.evaluate(() => (window as any).themeTest.transitions)).toBe(1)
  await tone.click()
  await expect(outline).toHaveAttribute('d', normal!)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.evaluate(() => Object.defineProperty(document, 'startViewTransition', { value: undefined }))
  await scheme.click()
  await expect(scheme).toHaveAttribute('aria-pressed', 'true')
})

test('theme controls remain usable when browser storage is blocked', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() { throw new DOMException('Storage blocked', 'SecurityError') },
    })
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Toggle color scheme', exact: true }).click()
  await page.getByRole('button', { name: 'Soft tone', exact: true }).click()
  await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(27, 27, 27)')
  expect(errors).toEqual([])
})
