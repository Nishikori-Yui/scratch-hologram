import { expect, test } from '@playwright/test'

test('standalone renders pixels, imports SVG, changes quality and exports locally', async ({ page }, testInfo) => {
  const errors: string[] = []
  const external: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.protocol.startsWith('http') && url.origin !== 'http://127.0.0.1:5174')
      external.push(request.url())
  })
  await page.goto('/')
  await expect(page.locator('.loading-layer')).toHaveCount(0)
  await expect.poll(() => page.locator('canvas').evaluate((canvas: HTMLCanvasElement) => {
    const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
    let lit = 0
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] + data[i + 1] + data[i + 2] > 30)
        lit++
    }
    return lit
  })).toBeGreaterThan(500)
  await page.screenshot({ path: testInfo.outputPath('standalone-reflection.png'), fullPage: true })
  await page.getByRole('combobox', { name: 'Render quality' }).click()
  await page.getByRole('option', { name: /Preview/ }).click()
  await expect(page.locator('[data-metric="selected"] dd')).toHaveText('320 × 240')
  await page.locator('input[type="file"]').setInputFiles({
    name: 'test-mark.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M10 20 L90 80 L10 80" fill="none"/></svg>'),
  })
  await page.getByRole('button', { name: 'Scratch geometry', exact: true }).click()
  await expect(page.locator('.original-paths path').first()).toBeVisible()
  const svgDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export SVG', exact: true }).click()
  expect((await svgDownload).suggestedFilename()).toBe('scratch-pattern.svg')
  await page.getByRole('button', { name: 'Reflection', exact: true }).click()
  const pngDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export PNG', exact: true }).click()
  expect((await pngDownload).suggestedFilename()).toMatch(/\.png$/)
  await page.getByRole('button', { name: 'Rotating signature', exact: true }).click()
  await page.getByRole('button', { name: 'Play rotation', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Pause rotation', exact: true })).toBeVisible()
  await expect.poll(async () => Number(await page.locator('.rotary-controls input[type="range"]').first().inputValue())).toBeGreaterThan(0)
  await page.getByRole('button', { name: 'Pause rotation', exact: true }).click()
  expect(errors).toEqual([])
  expect(external).toEqual([])
})
