// REPL driver for the Yolk Electron client (built output in out/).
// Reads one command per line from stdin: pipe a heredoc for a batch run, or wrap it in tmux.
// Usage: node .claude/skills/run-yolk/driver.mjs     (after `npm run build`)
import { _electron as electron } from 'playwright-core'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as readline from 'node:readline'

const ROOT = path.resolve(import.meta.dirname, '../../..')
const SHOT_DIR = process.env.SCREENSHOT_DIR || '/tmp/yolk-shots'
// A throwaway profile keeps test runs out of ~/.config/yolk; settings there are empty,
// so Jev falls back to TYPESAFE_API_KEY from this process's environment.
const USER_DATA = process.env.YOLK_USER_DATA || path.join(SHOT_DIR, 'userdata')
fs.mkdirSync(SHOT_DIR, { recursive: true })

let app = null
let page = null

const need = () => {
  if (!page) throw new Error('launch first')
  return page
}
const status = () => need().evaluate(() => document.querySelector('.status')?.textContent ?? '(no review open)')
// Pages live in the URL hash (#/, #/r/owner/repo, #/r/owner/repo/pull/N, #/settings).
const goto = (hash) => need().evaluate((h) => (location.hash = h), hash)
/** The home page is ready once `gh` has listed repositories (or failed to). */
const waitForHome = () =>
  need().waitForFunction(() => document.querySelector('.home-search') && /个仓库|个匹配的仓库|读取仓库列表失败/.test(document.body.innerText), null, {
    timeout: 60_000,
  })
const homeSummary = () =>
  need().evaluate(() =>
    [document.querySelector('.home-search')?.parentElement?.parentElement?.innerText.split('\n')[0], ...[...document.querySelectorAll('.repo-item')].slice(0, 5).map((e) => e.innerText.split('\n')[0])].join(' | '),
  )
/** Search the home input and press Enter: owner/repo opens a repository, a PR link opens the review. */
const submitHome = async (text) => {
  const p = need()
  await goto('#/')
  await waitForHome()
  await p.fill('.home-search input', text)
  await p.press('.home-search input', 'Enter')
}
const waitForReview = async () => {
  const p = need()
  await p.waitForFunction(() => document.querySelector('.review-header') || document.body.innerText.includes('打开 PR 失败'), null, { timeout: 120_000 })
  const failed = await p.evaluate(() => (document.querySelector('.review-header') ? null : document.body.innerText.match(/打开 PR 失败[\s\S]{0,300}/)?.[0]))
  console.log(failed ? `open failed: ${failed.replace(/\n/g, ' ')}` : `opened: ${await p.textContent('.review-title')}`)
}
/** Fail fast instead of waiting out long timeouts when `open` did not succeed. */
const needReview = async () => {
  const p = need()
  if (!(await p.$('.review-header'))) throw new Error('no review open - run `open <PR URL>` first (or it failed)')
  return p
}

const COMMANDS = {
  async launch() {
    if (app) return console.log('already launched')
    const main = path.join(ROOT, 'out/main/index.js')
    if (!fs.existsSync(main)) throw new Error('out/main/index.js missing - run `npm run build` first')
    app = await electron.launch({
      executablePath: path.join(ROOT, 'node_modules/electron/dist/electron'),
      args: [`--user-data-dir=${USER_DATA}`, main],
      cwd: ROOT,
      env: process.env,
      timeout: 30_000,
    })
    app.process().stderr.on('data', (d) => {
      const text = String(d)
      if (/Error|error/.test(text) && !/Vulkan|Fontconfig|DevTools|Debugger/.test(text)) process.stdout.write(`[main] ${text}`)
    })
    page = await app.firstWindow()
    page.on('pageerror', (e) => console.log('[renderer:pageerror]', e.message))
    page.on('console', (m) => m.type() === 'error' && console.log('[renderer:error]', m.text()))
    // The window sits on the real desktop; ignore the OS pointer so a cursor resting over it cannot
    // hover rows (and trigger explanations) behind the driver's back. CDP-injected mouse events still arrive.
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]
      window.setSize(1440, 920)
      window.setIgnoreMouseEvents(true)
    })
    await waitForHome()
    console.log('launched:', await homeSummary())
  },

  async ss(name) {
    const file = path.join(SHOT_DIR, `${name || `ss-${Date.now()}`}.png`)
    await need().screenshot({ path: file })
    console.log('screenshot:', file)
  },

  /** Open a repository from the home page input and list its open PRs. */
  async repo(name) {
    if (!name) throw new Error('usage: repo <owner/repo>')
    await submitHome(name)
    await need().waitForSelector('.state-tabs')
    await COMMANDS.prs()
  },

  /** Switch the repository page to a PR state (open|merged|closed|all) and print the list. */
  async prs(state) {
    const p = need()
    if (!(await p.$('.state-tabs'))) throw new Error('no repository open - run `repo <owner/repo>` first')
    const labels = { open: '打开的', merged: '已合并', closed: '已关闭', all: '全部' }
    if (state) {
      await p.click(`.state-tabs >> text="${labels[state]}"`)
      await p.waitForTimeout(150)
    }
    await p.waitForFunction(() => document.querySelector('.pr-count') || document.body.innerText.includes('读取 PR 列表失败'), null, { timeout: 60_000 })
    const rows = await p.evaluate(() => [
      document.querySelector('.pr-count')?.textContent ?? document.body.innerText.match(/读取 PR 列表失败.*/)?.[0],
      ...[...document.querySelectorAll('.pr-item')].slice(0, 8).map((b) => b.innerText.replace(/\n/g, '  ')),
    ])
    rows.forEach((r) => console.log(' ', r))
  },

  /** Open PR #n from the repository page list. */
  async pr(number) {
    const p = need()
    const item = p.locator(`.pr-item[data-number="${number}"]`)
    if (!(await item.count())) throw new Error(`PR #${number} is not in the list - try \`prs all\``)
    await item.click()
    await waitForReview()
  },

  /** Paste a PR link into the home input and wait for the chunked diff to render. */
  async open(url) {
    if (!url) throw new Error('usage: open <PR URL>')
    await submitHome(url)
    await waitForReview()
  },

  /** Wait until Jev has judged every unit (or failed). Optional timeout in seconds, default 120. */
  async 'wait-judged'(seconds) {
    await (await needReview()).waitForFunction(() => /判断完成|判断失败/.test(document.querySelector('.status')?.textContent ?? ''), null, {
      timeout: Number(seconds || 120) * 1000,
    })
    console.log('status:', await status())
  },

  async status() {
    console.log('status:', await status())
  },

  /** File list with per-category line counts, as shown in the left column. */
  async files() {
    const rows = await need().evaluate(() => [...document.querySelectorAll('.file-list-item')].map((item) => item.innerText.replace(/\n/g, '  ')))
    rows.forEach((r) => console.log(' ', r))
  },

  /** Toggle 只看核心 with its keyboard shortcut C (focus is moved off any input first). */
  async 'core-only'() {
    const p = await needReview()
    await p.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur())
    await p.keyboard.press('c')
    await p.waitForTimeout(300)
    console.log('core only:', await p.isChecked('.toggle input'), '- folds:', await p.locator('.fold').count())
  },

  /** Scroll file N (0-based) or `last` into view. */
  async file(n) {
    const p = await needReview()
    const index = n === 'last' ? (await p.locator('.file').count()) - 1 : Number(n || 0)
    await p.evaluate((i) => document.getElementById(`file-${i}`)?.scrollIntoView(), index)
    await p.waitForTimeout(300)
    console.log('scrolled to file', index, await p.evaluate((i) => document.querySelector(`#file-${i} .file-path`)?.textContent, index))
  },

  /** Hover the first added line of a category (core|defense|support|test|pending) and print the tooltip. */
  async 'hover-block'(category) {
    const p = await needReview()
    const line = p.locator(`.line.add.cat-${category || 'core'}`).first()
    if (!(await line.count())) return console.log('no line with category', category)
    await line.scrollIntoViewIfNeeded()
    await line.hover()
    await p.waitForTimeout(200)
    console.log('tooltip:', (await p.textContent('.tooltip').catch(() => null)) ?? '(none)')
  },

  /** Hover the first line of a category and wait for the general model's explanation (up to 60 s). */
  async explain(category) {
    const p = await needReview()
    await COMMANDS['hover-block'](category)
    await p.waitForFunction(
      () => {
        const text = document.querySelector('.tooltip .explanation')?.textContent ?? ''
        return text && !text.includes('正在生成解释')
      },
      null,
      { timeout: 60_000 },
    )
    // Read block id and explanation together so a mismatch would show.
    const [id, text] = await p.evaluate(() => [
      document.querySelector('.tooltip .small')?.textContent,
      document.querySelector('.tooltip .explanation')?.textContent,
    ])
    console.log(`explanation for ${id}: ${text}`)
  },

  async home() {
    await goto('#/')
    await waitForHome()
    console.log('at home:', await homeSummary())
  },

  async settings() {
    const p = need()
    await goto('#/settings')
    await p.waitForFunction(() => document.querySelectorAll('.settings input').length > 0, null, { timeout: 20_000 })
    console.log('settings:', await p.evaluate(() => [...document.querySelectorAll('.settings input')].map((i) => `${i.value || i.placeholder}`).join(' | ')))
  },

  /** Force the color scheme (light|dark|system); Astryx and the diff colors follow it. */
  async theme(source) {
    if (!app) throw new Error('launch first')
    await app.evaluate(({ nativeTheme }, value) => (nativeTheme.themeSource = value), source || 'system')
    // Playwright emulates prefers-color-scheme itself (light by default), which masks nativeTheme.
    await need().emulateMedia({ colorScheme: source === 'dark' || source === 'light' ? source : null })
    await need().waitForTimeout(300)
    console.log('theme:', source || 'system', '- dark:', await need().evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches))
  },

  async click(selector) {
    console.log('click', selector, '->', await need().evaluate((s) => (document.querySelector(s)?.click(), document.querySelector(s) ? 'OK' : 'NOT_FOUND'), selector))
  },

  async text(selector) {
    console.log(await need().evaluate((s) => (s ? document.querySelector(s) : document.body)?.innerText ?? '(null)', selector || null))
  },

  async eval(expression) {
    console.log(JSON.stringify(await need().evaluate(expression)))
  },

  async quit() {
    if (app) await app.close().catch(() => {})
    app = null
    page = null
  },

  help() {
    console.log('commands:', Object.keys(COMMANDS).join(', '))
  },
}

// Read our own stdin fd so the Electron child never competes for it.
const input = fs.createReadStream(null, { fd: fs.openSync('/dev/stdin', 'r') })
const rl = readline.createInterface({ input, output: process.stdout, terminal: false })
console.log('yolk driver - "help" for commands, "launch" to start')
process.stdout.write('driver> ')
for await (const raw of rl) {
  const line = raw.trim()
  if (line && !line.startsWith('#')) {
    const [cmd, ...rest] = line.split(/\s+/)
    console.log(`> ${line}`)
    const fn = COMMANDS[cmd]
    if (!fn) console.log('unknown command:', cmd, '- try: help')
    else {
      try {
        await fn(rest.join(' '))
      } catch (error) {
        console.log('ERROR:', error.message.split('\n')[0])
      }
    }
    if (cmd === 'quit') break
  }
  process.stdout.write('driver> ')
}
await COMMANDS.quit()
process.exit(0)
