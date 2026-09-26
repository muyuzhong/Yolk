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
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 920))
    await page.waitForSelector('.home', { timeout: 20_000 })
    // The home page lists PRs through `gh search prs`; wait until that settles.
    await page.waitForFunction(() => !document.body.textContent.includes('正在通过 gh 读取'), null, { timeout: 30_000 })
    console.log('launched:', await page.evaluate(() => document.querySelector('.home')?.innerText.split('\n').slice(0, 6).join(' | ')))
  },

  async ss(name) {
    const file = path.join(SHOT_DIR, `${name || `ss-${Date.now()}`}.png`)
    await need().screenshot({ path: file })
    console.log('screenshot:', file)
  },

  /** Open a PR from the home page URL box and wait for the chunked diff to render. */
  async open(url) {
    const p = need()
    if (!url) throw new Error('usage: open <PR URL>')
    if (!(await p.$('.home'))) await COMMANDS.home()
    await p.fill('.open-form input', url)
    await p.click('.open-form button')
    await p.waitForSelector('.review-header, .page-message .error', { timeout: 120_000 })
    const error = await p.$('.page-message .error')
    console.log(error ? `open failed: ${await error.textContent()}` : `opened: ${await p.textContent('.review-title')}`)
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
    const rows = await need().evaluate(() =>
      [...document.querySelectorAll('.file-list button')].map((b) => `${b.querySelector('.file-name')?.textContent}  ${b.querySelector('.file-counts')?.textContent}`),
    )
    rows.forEach((r) => console.log(' ', r))
  },

  async 'core-only'() {
    const p = await needReview()
    await p.click('.toggle input')
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

  async home() {
    const p = need()
    if (await p.$('.home')) return console.log('at home')
    await p.click('.review-header .link, .page-header .link, .page-message button')
    await p.waitForSelector('.home')
    console.log('at home')
  },

  async settings() {
    const p = need()
    if (!(await p.$('.home'))) await COMMANDS.home()
    await p.click('.home-header .link')
    await p.waitForSelector('.settings form')
    console.log('settings:', await p.evaluate(() => [...document.querySelectorAll('.settings input')].map((i) => `${i.value || i.placeholder}`).join(' | ')))
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
