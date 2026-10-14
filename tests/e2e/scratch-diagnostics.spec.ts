import { expect, test } from '@playwright/test'

test('diagnostics report actual frames, idle update rate and geometry pipeline', async ({ page }, testInfo) => {
  await page.goto('./')
  await expect(page.locator('.loading-layer')).toHaveCount(0)
  const panel = page.locator('.render-diagnostics')
  const value = (key: string) => panel.locator(`[data-metric="${key}"] dd`)
  await expect(value('pipeline')).toContainText(/WASM.*Canvas 2D/)
  await expect(value('selected')).toHaveText('640 × 480')
  await expect(value('actual')).toHaveText('640 × 480')
  await expect(value('scale')).toHaveText('100.0% × 100.0%')
  await expect(value('capabilities')).toContainText('WebGPU:')
  await expect.poll(async () => Number(await value('count').textContent())).toBeGreaterThan(0)
  await expect(value('duration')).toContainText('ms')
  await expect.poll(async () => Number(await value('rate').textContent())).toBe(0)

  await page.getByRole('button', { name: 'Auto orbit', exact: true }).click()
  await expect.poll(async () => Number(await value('rate').textContent())).toBeGreaterThan(1)
  await page.getByRole('button', { name: 'Pause orbit', exact: true }).click()
  await expect(value('state')).toHaveText('Idle')
  await expect(value('actual')).toHaveText('640 × 480')

  for (const locale of ['en', 'zh']) {
    await page.getByRole('radio', { name: locale === 'en' ? 'English' : '中文', exact: true }).click()
    for (const width of [1440, 640, 390]) {
      await page.setViewportSize({ width, height: 1000 })
      for (const dark of [false, true]) {
        await page.evaluate(dark => document.documentElement.classList.toggle('dark', dark), dark)
        await panel.screenshot({ path: testInfo.outputPath(`diagnostics-${locale}-${width}-${dark ? 'dark' : 'light'}.png`) })
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      }
    }
  }
  await page.getByRole('radio', { name: 'English', exact: true }).click()
  await page.getByRole('button', { name: 'Scratch geometry', exact: true }).click()
  await expect(value('pipeline')).toHaveText('WASM geometry → SVG')
  await expect(value('actual')).toHaveText('SVG')
  await panel.locator('summary').focus()
  await page.keyboard.press('Enter')
  await expect(panel.locator('dl')).toHaveCount(0)
  await page.keyboard.press('Enter')
  await expect(panel.locator('dl')).toBeVisible()
})
