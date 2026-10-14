import { expect, test } from '@playwright/test'

test('geometry shows encoding controls and preserves reflection settings', async ({ page }, testInfo) => {
  await page.goto('/')
  await expect(page.locator('.loading-layer')).toHaveCount(0)
  const animationIcon = page.locator('.scene-selector .i-carbon-video-player')
  await expect(animationIcon).toBeVisible()
  await expect(animationIcon).toHaveCSS('mask-image', /url\(/)
  const reflectionSections = page.locator('.disc-section, .optics-section')
  await expect(reflectionSections).toHaveCount(3)
  const discAngle = page.locator('.disc-section input[type="range"]').first()
  const lightAngle = page.locator('.optics-section').first().locator('input[type="range"]').first()
  const cameraAngle = page.locator('.optics-section').last().locator('input[type="range"]').first()
  await discAngle.fill('15')
  await lightAngle.fill('25')
  await cameraAngle.fill('-10')
  for (const locale of ['en', 'zh']) {
    await page.getByRole('radio', { name: locale === 'en' ? 'English' : '\u4E2D\u6587', exact: true }).click()
    for (const width of [1440, 637, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 })
      for (const dark of [false, true]) {
        await page.evaluate(dark => document.documentElement.classList.toggle('dark', dark), dark)
        const spacing = await page.evaluate(() => {
          const sections = [...document.querySelectorAll('.control-section')]
          const rect = (el: Element) => el.getBoundingClientRect()
          return {
            sectionGaps: sections.slice(1).map((el, i) => rect(el).top - rect(sections[i]).bottom),
            headingGaps: sections.map((el) => {
              const heading = el.querySelector('.pattern-encoding-controls, .section-heading')!
              const firstRow = el.querySelector('.embed-demo-slider')!
              return rect(firstRow).top - rect(heading).bottom
            }),
            headingHeights: sections.map(el => rect(el.querySelector('.pattern-encoding-controls, .section-heading')!).height),
            rowGaps: ['.pattern-parameters', '.disc-rotation', '.optics-section'].map(selector => getComputedStyle(document.querySelector(selector)!).rowGap),
            overflow: document.documentElement.scrollWidth > innerWidth,
          }
        })
        expect(spacing.sectionGaps).toEqual([32, 32, 32])
        expect(spacing.headingGaps).toEqual([12, 12, 12, 12])
        expect(new Set(spacing.headingHeights).size, JSON.stringify(spacing)).toBe(1)
        expect(spacing.rowGaps).toEqual(['12px', '12px', '12px'])
        expect(spacing.overflow).toBe(false)
        await page.locator('.parameter-groups').screenshot({
          path: testInfo.outputPath(`parameters-${locale}-${width}-${dark ? 'dark' : 'light'}.png`),
        })
        await page.locator('.scene-selector').screenshot({
          path: testInfo.outputPath(`scene-${locale}-${width}-${dark ? 'dark' : 'light'}.png`),
        })
      }
    }
  }
  await page.getByRole('radio', { name: 'English', exact: true }).click()
  await page.getByRole('button', { name: 'Scratch geometry', exact: true }).click()
  await expect(reflectionSections).toHaveCount(0)
  await expect(page.locator('.scratch-paths path').first()).toBeVisible()

  const header = page.locator('.pattern-encoding-controls')
  const samples = header.getByRole('checkbox')
  await expect(samples).not.toBeChecked()
  await samples.focus()
  await page.keyboard.press('Space')
  await expect(samples).toBeChecked()
  await expect(page.locator('.sample-points circle').first()).toBeVisible()
  await page.keyboard.press('Space')
  await expect(samples).not.toBeChecked()
  await expect(page.locator('.sample-points')).toHaveCount(0)

  for (const locale of ['en', 'zh']) {
    await page.getByRole('radio', { name: locale === 'en' ? 'English' : '\u4E2D\u6587', exact: true }).click()
    for (const width of [1440, 637, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 })
      for (const dark of [false, true]) {
        await page.evaluate(dark => document.documentElement.classList.toggle('dark', dark), dark)
        const alignment = await page.evaluate(() => {
          const bounds = (selector: string) => document.querySelector(selector)!.getBoundingClientRect()
          const sample = bounds('.pattern-encoding-controls .check-control')
          const title = bounds('.pattern-encoding-heading')
          const mode = bounds('.display-controls .control-set')
          const quality = bounds('.quality-section .embed-demo-select__trigger')
          return {
            modeOffset: sample.left - mode.left,
            qualityOffset: sample.left - quality.left,
            centerOffset: sample.top + sample.height / 2 - title.top - title.height / 2,
            overflow: document.documentElement.scrollWidth > innerWidth,
          }
        })
        expect(Math.abs(alignment.modeOffset)).toBeLessThan(1)
        expect(Math.abs(alignment.qualityOffset)).toBeLessThan(1)
        expect(Math.abs(alignment.centerOffset)).toBeLessThan(1)
        expect(alignment.overflow).toBe(false)
        await expect(reflectionSections).toHaveCount(0)
        await samples.focus()
        await page.keyboard.press('Tab')
        await page.keyboard.press('Shift+Tab')
        await expect(samples).toBeFocused()
        await expect(samples).toHaveCSS('outline-width', '2px')
        await page.locator('.pattern-section').screenshot({
          path: testInfo.outputPath(`encoding-${locale}-${width}-${dark ? 'dark' : 'light'}.png`),
        })
      }
    }
  }

  await page.getByRole('radio', { name: 'English', exact: true }).click()
  await page.getByRole('button', { name: 'Reflection', exact: true }).click()
  await expect(reflectionSections).toHaveCount(3)
  await expect(discAngle).toHaveValue('15')
  await expect(lightAngle).toHaveValue('25')
  await expect(cameraAngle).toHaveValue('-10')
  await expect(samples).toHaveCount(0)
  const animationScene = page.getByRole('button', { name: 'Rotating signature', exact: true })
  await animationScene.focus()
  await page.keyboard.press('Tab')
  await page.keyboard.press('Shift+Tab')
  await expect(animationScene).toHaveCSS('outline-width', '2px')
  await page.keyboard.press('Enter')
  await expect(animationScene).toHaveAttribute('aria-pressed', 'true')
  await page.locator('.scene-selector').screenshot({ path: testInfo.outputPath('scene-selected-focused.png') })
  await page.getByRole('button', { name: 'Scratch geometry', exact: true }).click()
  await expect(reflectionSections).toHaveCount(0)
  await expect(samples).toHaveCount(0)
  await expect(page.locator('.scratch-paths path').first()).toBeVisible()
})
