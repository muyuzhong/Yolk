import { TypeSafeClient } from '@typesafe-ai/sdk'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { app, BrowserWindow, ipcMain, nativeTheme, shell, type WebContents } from 'electron'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { chunkPullRequest, judgeFiles, type FileResult } from '../core/analyze'
import { suggestsRemoval, type JudgingUpdate } from '../core/judgment'
import { complete, explainMessages, explainSelectionMessages, type ExplainSelectionInput, type SelectedLine } from '../core/llm'
import { currentUser, listPullRequests, listRepositories, repoKey, type PullRequestState } from '../core/sources/gh'
import { MAX_SELECTION, type ReviewProgress, type ReviewStart, type SelectionLine, type SettingsUpdate } from '../shared/api'
import { conventionFor, llmConfig, loadSettings, saveConvention, saveJudging, saveSettings, settingsView } from './settings'

const reviews = new Map<number, { reviewId: string; controller: AbortController }>()
/** The review each window shows; kept after judging ends because hover explanations read it. */
const shown = new Map<number, { reviewId: string } & ReviewStart>()
/** Cache by model and complete prompt, including the current convention. */
const explanations = new Map<string, Promise<string>>()

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 640,
    title: 'Yolk',
    autoHideMenuBar: true,
    // Astryx's body background, so the window does not flash white before the page paints.
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#111112' : '#F1F4F7',
    webPreferences: { preload: fileURLToPath(new URL('../preload/index.cjs', import.meta.url)) },
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env.ELECTRON_RENDERER_URL) window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else window.loadFile(fileURLToPath(new URL('../renderer/index.html', import.meta.url)))
}

async function startReview(sender: WebContents, url: string, reviewId: string): Promise<ReviewStart> {
  const senderId = sender.id
  reviews.get(senderId)?.controller.abort()
  const controller = new AbortController()
  const { signal } = controller
  reviews.set(senderId, { reviewId, controller })
  const cancel = () => controller.abort()
  sender.once('destroyed', cancel)
  const finish = () => {
    sender.removeListener('destroyed', cancel)
    if (reviews.get(senderId)?.controller === controller) reviews.delete(senderId)
    if (shown.get(senderId)?.reviewId === reviewId) shown.delete(senderId)
  }
  signal.addEventListener('abort', finish, { once: true })
  try {
    const { pr, files } = await chunkPullRequest(url)
    signal.throwIfAborted()
    const { policy, policySource } = await conventionFor(repoKey(pr))
    signal.throwIfAborted()
    const start: ReviewStart = { pr, files, policy, policySource }
    shown.set(senderId, { reviewId, ...start })
    void judgeInBackground(sender, reviewId, start, signal)
    return start
  } catch (error) {
    controller.abort()
    throw error
  }
}

/** Streams each unit's judgments to the renderer as its Jev request returns. */
async function judgeInBackground(sender: WebContents, reviewId: string, { pr, files, policy }: ReviewStart, signal: AbortSignal) {
  const send = (progress: ReviewProgress) => {
    if (!signal.aborted && !sender.isDestroyed()) sender.send('review:progress', progress)
  }
  try {
    const { jev, judging } = await loadSettings()
    signal.throwIfAborted()
    // Without a key in settings the SDK falls back to TYPESAFE_API_KEY.
    const client = new TypeSafeClient({ defaultModel: jev.model, ...(jev.apiKey ? { apiKey: jev.apiKey } : {}) })
    const { model, inputTokens, cachedUnits } = await judgeFiles(pr, files, {
      policy,
      client,
      cacheDir: join(app.getPath('userData'), 'jev-cache'),
      roles: judging.roles,
      signal,
      onUnit: (result) => send({ type: 'unit', reviewId, ...result }),
    })
    send({ type: 'done', reviewId, model, inputTokens, cachedUnits })
  } catch (error) {
    send({ type: 'error', reviewId, message: error instanceof Error ? error.message : String(error) })
  }
}

/** The review a window shows and the signal that cancels its requests, or an error if it has closed. */
function openReview(sender: WebContents, reviewId: string) {
  const review = shown.get(sender.id)
  if (review?.reviewId !== reviewId) throw new Error('这个审阅已经关闭')
  return { review, signal: reviews.get(sender.id)!.controller.signal }
}

/** Every block of a file with its judged role (null until judged) and whether it has ✂ under the current thresholds. */
async function explainedBlocks(file: FileResult) {
  const { thresholds } = (await loadSettings()).judging
  // judgeFiles merges judgments into these same file objects, so roles and ✂ reflect what Jev has said so far.
  return file.chunks!.blocks.map((block) => {
    const judgment = file.judgments?.[block.id]
    return {
      block,
      role: file.testBlocks?.includes(block.id) ? ('test' as const) : (judgment?.role ?? null),
      cut: judgment !== undefined && suggestsRemoval(judgment, thresholds),
    }
  })
}

/** Asks the general model once per model and complete prompt; answers are shared until settings change. */
async function cachedCompletion(messages: ChatCompletionMessageParam[], signal: AbortSignal): Promise<string> {
  const config = await llmConfig()
  signal.throwIfAborted()
  const key = JSON.stringify([config.baseURL, config.model, messages])
  let explanation = explanations.get(key)
  if (!explanation) {
    explanation = complete(config, messages, signal)
    explanations.set(key, explanation)
    const evict = () => {
      if (explanations.get(key) === explanation) explanations.delete(key)
    }
    // Evict immediately on cancellation so reopening cannot reuse an aborted request.
    signal.addEventListener('abort', evict, { once: true })
    void explanation.catch(evict).finally(() => signal.removeEventListener('abort', evict))
  }
  return explanation
}

/** Explains a whole judgment unit (a function, or top-level changes) with each block's category, on request. */
async function explainUnit(sender: WebContents, reviewId: string, fileIndex: number, unitId: string): Promise<string> {
  const { review, signal } = openReview(sender, reviewId)
  const file = review.files[fileIndex]
  const unit = file.chunks!.units.find((u) => u.id === unitId)!
  const blocks = (await explainedBlocks(file)).filter((b) => b.block.unit === unitId)
  const policy = blocks.some((b) => b.cut) ? review.policy : null
  return cachedCompletion(explainMessages({ pr: review.pr, path: file.diff.path, source: file.source!, unit, blocks, policy }), signal)
}

/** Lines of context kept on each side of a selection that touches no judgment unit. */
const SELECTION_CONTEXT = 10

/** Explains lines the reviewer selected in a file's diff, with the units they touch as context. */
async function explainSelection(sender: WebContents, reviewId: string, fileIndex: number, picks: SelectionLine[]): Promise<string> {
  const { review, signal } = openReview(sender, reviewId)
  if (!picks.length) throw new Error('没有选中代码')
  if (picks.length > MAX_SELECTION) throw new Error(`选中的代码太多了，请少于 ${MAX_SELECTION} 行`)
  const file = review.files[fileIndex]
  const source = file.source ?? []
  const diffLines = file.diff.hunks.flatMap((hunk) => hunk.lines)
  const blocks = file.chunks ? await explainedBlocks(file) : []
  const blockOf = new Map<number, (typeof blocks)[number]>()
  for (const b of blocks) for (const line of b.block.lines) blockOf.set(line, b)
  // Text comes from the main process's own copy of the diff (or the new source for structural context lines).
  const lines: SelectedLine[] = picks.map(({ kind, oldNo, newNo }) => {
    const text =
      diffLines.find((l) => l.kind === kind && l.oldNo === oldNo && l.newNo === newNo)?.text ?? (newNo !== null ? (source[newNo - 1] ?? '') : '')
    const judged = kind !== 'del' && newNo !== null ? blockOf.get(newNo) : undefined
    return { kind, oldNo, newNo, text, role: judged?.role ?? null, cut: judged?.cut ?? false }
  })
  const newNos = lines.flatMap((l) => (l.newNo === null ? [] : [l.newNo]))
  let context: ExplainSelectionInput['context'] = null
  if (newNos.length && source.length) {
    const first = Math.min(...newNos)
    const last = Math.max(...newNos)
    const units = file.chunks?.units.filter((u) => u.start <= last && u.end >= first) ?? []
    const start = Math.max(1, Math.min(first - (units.length ? 0 : SELECTION_CONTEXT), ...units.map((u) => u.start)))
    const end = Math.min(source.length, Math.max(last + (units.length ? 0 : SELECTION_CONTEXT), ...units.map((u) => u.end)))
    context = { start, end, blocks: blocks.filter((b) => b.block.lines.some((line) => line >= start && line <= end)) }
  }
  const policy = lines.some((l) => l.cut) ? review.policy : null
  return cachedCompletion(explainSelectionMessages({ pr: review.pr, path: file.diff.path, source, lines, context, policy }), signal)
}

app.whenReady().then(() => {
  ipcMain.handle('settings:get', () => settingsView())
  ipcMain.handle('settings:save', async (_event, update: SettingsUpdate) => {
    const settings = await saveSettings(update)
    explanations.clear()
    return settings
  })
  ipcMain.handle('settings:convention', async (_event, repo: string | null, text: string) => {
    const settings = await saveConvention(repo, text)
    explanations.clear()
    return settings
  })
  ipcMain.handle('settings:judging', async (_event, judging: JudgingUpdate | null) => {
    const settings = await saveJudging(judging)
    explanations.clear()
    return settings
  })
  ipcMain.handle('repos:list', () => listRepositories())
  let login: Promise<string> | undefined
  ipcMain.handle('prs:list', async (_event, repo: string, state: PullRequestState) => {
    // Looked up once; a failed lookup is forgotten so the next list asks again.
    login ??= currentUser().catch((error) => {
      login = undefined
      throw error
    })
    const [user, pullRequests] = await Promise.all([login, listPullRequests(repo, state)])
    return { login: user, pullRequests }
  })
  ipcMain.handle('review:start', (event, url: string, reviewId: string) => startReview(event.sender, url, reviewId))
  ipcMain.handle('review:explain', (event, reviewId: string, fileIndex: number, unitId: string) =>
    explainUnit(event.sender, reviewId, fileIndex, unitId),
  )
  ipcMain.handle('review:explain-selection', (event, reviewId: string, fileIndex: number, lines: SelectionLine[]) =>
    explainSelection(event.sender, reviewId, fileIndex, lines),
  )
  ipcMain.on('review:cancel', (event, reviewId: string) => {
    const review = reviews.get(event.sender.id)
    if (review?.reviewId === reviewId) review.controller.abort()
  })
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
