// Start npm run dev:web, then run: node test/updates-ui.mjs http://127.0.0.1:5180
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'

const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 920 } })
  await page.route('**/yolk.json', route => route.fulfill({ json: { login: 'test', repositories: [], pullRequests: {}, reviews: {} } }))
  await page.goto(`${process.argv[2] ?? 'http://127.0.0.1:5180'}/#/repos`)
  await page.waitForFunction(() => !!window.yolk)
  await page.evaluate(() => {
    window.updateState = { currentVersion: '0.0.2', status: 'idle' }
    window.updateActions = []
    window.yolk.getUpdateState = async () => window.updateState
    window.yolk.onUpdateState = listener => { window.updateListener = listener; return () => { window.updateListener = undefined } }
    window.setUpdateState = change => {
      window.updateState = { ...window.updateState, ...change }
      window.updateListener?.(window.updateState)
    }
    window.yolk.update = async action => {
      window.updateActions.push(action)
      window.setUpdateState({ status: { check: 'checking', download: 'downloading', install: 'installing' }[action], message: undefined })
    }
  })
  const emit = change => page.evaluate(change => window.setUpdateState(change), change)
  const open = async () => {
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await page.getByText('应用更新', { exact: true }).click()
  }
  await open()
  await page.getByRole('button', { name: '检查更新', exact: true }).click()
  await page.getByText('正在检查更新…', { exact: true }).waitFor()
  await emit({ status: 'available', version: '0.0.3' })
  await page.getByRole('button', { name: '下载更新', exact: true }).click()
  await emit({ status: 'downloading', percent: 42 })
  await page.getByText('正在下载 0.0.3：42%', { exact: true }).waitFor()
  await page.getByRole('button', { name: '关闭', exact: true }).click()
  await emit({ status: 'downloaded', percent: 100 })
  await open()
  await page.getByRole('button', { name: '重启并安装', exact: true }).click()
  assert.deepEqual(await page.evaluate(() => window.updateActions), ['check', 'download', 'install'])
  await emit({ status: 'error', message: '下载失败，请重试' })
  await page.getByText('下载失败，请重试', { exact: true }).waitFor()
  await page.getByRole('button', { name: '检查更新', exact: true }).click()
  await emit({ status: 'idle', message: '已经是最新版本。' })
  await page.getByText('已经是最新版本。', { exact: true }).waitFor()
  console.log('Updates: check, progress, reopen, explicit install and retry passed')
} finally {
  await browser.close()
}
