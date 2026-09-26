import { TypeSafeClient } from '@typesafe-ai/sdk'
import { app, BrowserWindow, ipcMain, nativeTheme, shell, type WebContents } from 'electron'
import { fileURLToPath } from 'node:url'
import { chunkPullRequest, judgeFiles } from '../core/analyze'
import { suggestsRemoval, type JudgingUpdate } from '../core/judgment'
import { explain, explainMessages } from '../core/llm'
import { currentUser, listPullRequests, listRepositories, repoKey, type PullRequestState } from '../core/sources/gh'
import type { ReviewProgress, ReviewStart, SettingsUpdate } from '../shared/api'
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
    const { model, inputTokens } = await judgeFiles(pr, files, {
      policy,
      client,
      roles: judging.roles,
      signal,
      onUnit: (result) => send({ type: 'unit', reviewId, ...result }),
    })
    send({ type: 'done', reviewId, model, inputTokens })
  } catch (error) {
    send({ type: 'error', reviewId, message: error instanceof Error ? error.message : String(error) })
  }
}

async function explainBlock(sender: WebContents, reviewId: string, fileIndex: number, blockId: string): Promise<string> {
  const review = shown.get(sender.id)
  if (review?.reviewId !== reviewId) throw new Error('这个审阅已经关闭')
  const { signal } = reviews.get(sender.id)!.controller
  const file = review.files[fileIndex]
  const block = file.chunks!.blocks.find((b) => b.id === blockId)!
  const unit = file.chunks!.units.find((u) => u.id === block.unit)!
  // judgeFiles merges judgments into these same file objects, so ✂ reflects what Jev has said so far.
  const judgment = file.judgments?.[blockId]
  const cut = judgment !== undefined && suggestsRemoval(judgment, (await loadSettings()).judging.thresholds)
  const input = { pr: review.pr, path: file.diff.path, source: file.source!, unit, block, policy: cut ? review.policy : null }
  const config = await llmConfig()
  signal.throwIfAborted()
  const key = JSON.stringify([config.baseURL, config.model, explainMessages(input)])
  let explanation = explanations.get(key)
  if (!explanation) {
    explanation = explain(config, input, signal)
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
  ipcMain.handle('review:explain', (event, reviewId: string, fileIndex: number, blockId: string) =>
    explainBlock(event.sender, reviewId, fileIndex, blockId),
  )
  ipcMain.on('review:cancel', (event, reviewId: string) => {
    const review = reviews.get(event.sender.id)
    if (review?.reviewId === reviewId) review.controller.abort()
  })
  createWindow()
})

app.on('window-all-closed', () => app.quit())
