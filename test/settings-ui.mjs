// Start npm run dev:web, then run: node test/settings-ui.mjs http://127.0.0.1:5180
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'

const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 920 } })
  await page.route('**/yolk.json', route => route.fulfill({ json: { login: 'test', repositories: [], pullRequests: {}, reviews: {} } }))
  await page.goto(`${process.argv[2] ?? 'http://127.0.0.1:5180'}/#/repos`)
  await page.getByRole('button', { name: '设置', exact: true }).click()
  const rows = page.locator('.setting-row')
  await rows.nth(1).waitFor()
  await page.evaluate(() => {
    const save = window.yolk.saveSettings
    window.pendingSaves = []
    window.yolk.saveSettings = update => new Promise(resolve => {
      window.pendingSaves.push(async () => resolve(await save(update)))
    })
  })
  await rows.nth(1).getByRole('button', { name: '编辑', exact: true }).click()
  await page.locator('.setting-row.is-editing input').fill('jev-new')
  await page.locator('.setting-row.is-editing').getByRole('button', { name: '保存', exact: true }).click()
  await rows.nth(4).getByRole('button', { name: '编辑', exact: true }).click()
  await page.locator('.setting-row.is-editing input').fill('llm-new')
  await page.locator('.setting-row.is-editing').getByRole('button', { name: '保存', exact: true }).click()
  // Finishing the first request must not dismiss the second row or its draft.
  await page.evaluate(() => window.pendingSaves.shift()())
  assert.equal(await page.locator('.setting-row.is-editing input').inputValue(), 'llm-new')
  await page.evaluate(() => window.pendingSaves.shift()())
  await page.waitForFunction(() => !document.querySelector('.setting-row.is-editing'))
  const settings = await page.evaluate(() => window.yolk.getSettings())
  assert.equal(settings.jev.model, 'jev-new')
  assert.equal(settings.llm.model, 'llm-new')
  // Typing again in the same row while a save is pending is also a newer draft.
  await rows.nth(1).getByRole('button', { name: '编辑', exact: true }).click()
  await page.locator('.setting-row.is-editing input').fill('jev-saved')
  await page.locator('.setting-row.is-editing').getByRole('button', { name: '保存', exact: true }).click()
  await page.locator('.setting-row.is-editing input').fill('jev-unsaved')
  await page.evaluate(() => window.pendingSaves.shift()())
  assert.equal(await page.locator('.setting-row.is-editing input').inputValue(), 'jev-unsaved')
  assert.equal((await page.evaluate(() => window.yolk.getSettings())).jev.model, 'jev-saved')
  console.log('Settings: concurrent patches and newer drafts preserved')
} finally {
  await browser.close()
}
