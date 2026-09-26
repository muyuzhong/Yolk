// Start npm run dev:web, then run: node test/explanations-ui.mjs http://127.0.0.1:5180
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'

const url = 'https://github.com/test/repo/pull/1'
const source = ['function f() {', '  return load()', '}']
const fixture = {
  login: 'test', repositories: [], pullRequests: {},
  reviews: { [url]: {
    start: {
      pr: { host: 'github.com', owner: 'test', repo: 'repo', number: 1, title: 'Load data', body: '', url, baseSha: 'a', headSha: 'b' },
      policy: null, policySource: null,
      files: [{
        diff: { path: 'a.ts', oldPath: 'a.ts', status: 'modified', binary: false, hunks: [{
          header: '@@ -1,2 +1,3 @@',
          lines: source.map((text, i) => ({ kind: i === 1 ? 'add' : 'ctx', text, newNo: i + 1, oldNo: i === 1 ? null : i ? 2 : 1 })),
        }] },
        source, testBlocks: [],
        chunks: { blocks: [{ id: 'B1', unit: 'U1', lines: [2], nodeType: 'return_statement' }], units: [{ id: 'U1', kind: 'function', name: 'f', start: 1, end: 3, blocks: ['B1'] }], unowned: [], hasError: false },
      }],
    },
    units: [], model: 'mock', inputTokens: 0,
  } },
}
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 920 } })
  page.setDefaultTimeout(10000)
  await page.route('**/yolk.json', route => route.fulfill({ json: fixture }))
  await page.goto(`${process.argv[2] ?? 'http://127.0.0.1:5180'}/#/repos`)
  await page.waitForFunction(() => !!window.yolk)
  await page.evaluate(() => {
    const start = window.yolk.startReview
    window.yolk.startReview = (url, id) => { window.reviewId = id; return start(url, id) }
    const subscribe = window.yolk.onReviewProgress
    window.yolk.onReviewProgress = listener => { window.emitUnit = data => listener({ ...data, type: 'unit', reviewId: window.reviewId }); return subscribe(listener) }
    window.requests = []
    window.yolk.explainUnit = () => new Promise(resolve => window.requests.push(resolve))
    location.hash = '#/r/test/repo/pull/1'
  })
  const line = page.locator('.line.add')
  const explain = async count => {
    await line.hover({ position: { x: 170, y: 10 } })
    await line.click({ position: { x: 170, y: 10 } })
    await page.waitForFunction(n => window.requests.length === n, count)
  }
  const finish = (index, text) => page.evaluate(([i, value]) => window.requests[i](value), [index, text])
  const text = () => page.locator('.tooltip .explanation').innerText()
  await explain(1)
  await finish(0, 'before judgment')
  await page.getByText('before judgment', { exact: false }).waitFor()
  await page.evaluate(() => window.emitUnit({ fileIndex: 0, unitId: 'U1', judgments: { B1: { role: 'core', confidence: 0.9, probabilities: { core: 0.9, defense: 0.05, support: 0.05 }, excluded: 0.65 } } }))
  await page.locator('.line.cat-core').waitFor()
  await explain(2)
  await finish(1, 'after judgment')
  await page.getByText('after judgment', { exact: false }).waitFor()
  const threshold = async value => {
    await page.getByRole('button', { name: '设置', exact: true }).click()
    await page.evaluate(async excluded => {
      const s = await window.yolk.getSettings()
      await window.yolk.saveJudging({ ...s.judging, thresholds: { ...s.judging.thresholds, excluded } })
    }, value)
    await page.getByRole('button', { name: '关闭', exact: true }).click()
    await page.waitForFunction(cut => document.querySelector('.line.add .mark')?.textContent.includes('✂') === cut, value < 0.65)
  }
  await threshold(0.5)
  await explain(3)
  await threshold(0.9)
  await explain(4)
  await finish(2, 'obsolete response')
  assert.ok(!(await text()).includes('obsolete response'))
  await finish(3, 'latest response')
  await page.getByText('latest response', { exact: false }).waitFor()
  await explain(4)
  assert.ok((await text()).includes('latest response'))
  console.log('Explanations: judgment/settings invalidation, stale response rejection, unchanged cache reuse passed')
} finally {
  await browser.close()
}
