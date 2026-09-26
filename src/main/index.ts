import { TypeSafeClient } from '@typesafe-ai/sdk'
import { app, BrowserWindow, ipcMain, shell, type WebContents } from 'electron'
import { fileURLToPath } from 'node:url'
import { chunkPullRequest, judgeFiles } from '../core/analyze'
import { suggestsRemoval } from '../core/judgment'
import { explain } from '../core/llm'
import { getConvention, searchPullRequests } from '../core/sources/gh'
import type { ReviewProgress, ReviewStart, SettingsUpdate } from '../shared/api'
import { llmConfig, loadSettings, saveSettings, settingsView } from './settings'

const reviews = new Map<number, { reviewId: string; controller: AbortController }>()
/** The review each window shows; kept after judging ends because hover explanations read it. */
const shown = new Map<number, { reviewId: string } & ReviewStart>()
/** Explanations keyed by head sha, path, block lines and whether ✂ applies. */
const explanations = new Map<string, Promise<string>>()

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    title: 'Yolk',
    webPreferences: { preload: fileURLToPath(new URL('../preload/index.cjs', import.meta.url)) },
  })
  const id = window.webContents.id
  window.webContents.once('destroyed', () => shown.delete(id))
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
  }
  try {
    const { pr, files } = await chunkPullRequest(url)
    signal.throwIfAborted()
    const policy = await getConvention(pr)
    signal.throwIfAborted()
    shown.set(senderId, { reviewId, pr, files, policy })
    void judgeInBackground(sender, reviewId, { pr, files, policy }, signal).finally(finish)
    return { pr, files, policy }
  } catch (error) {
    finish()
    throw error
  }
}

/** Streams each unit's judgments to the renderer as its Jev request returns. */
async function judgeInBackground(sender: WebContents, reviewId: string, { pr, files, policy }: ReviewStart, signal: AbortSignal) {
  const send = (progress: ReviewProgress) => {
    if (!signal.aborted && !sender.isDestroyed()) sender.send('review:progress', progress)
  }
  try {
    const { jev } = await loadSettings()
    signal.throwIfAborted()
    // Without a key in settings the SDK falls back to TYPESAFE_API_KEY.
    const client = new TypeSafeClient({ defaultModel: jev.model, ...(jev.apiKey ? { apiKey: jev.apiKey } : {}) })
    const { model, inputTokens } = await judgeFiles(pr, files, {
      policy,
      client,
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
  const file = review.files[fileIndex]
  const block = file.chunks!.blocks.find((b) => b.id === blockId)!
  const unit = file.chunks!.units.find((u) => u.id === block.unit)!
  // judgeFiles merges judgments into these same file objects, so ✂ reflects what Jev has said so far.
  const judgment = file.judgments?.[blockId]
  const cut = judgment !== undefined && suggestsRemoval(judgment)
  const key = [review.pr.headSha, file.diff.path, block.lines.join(','), cut].join(':')
  let explanation = explanations.get(key)
  if (!explanation) {
    explanation = llmConfig().then((config) =>
      explain(config, { pr: review.pr, path: file.diff.path, source: file.source!, unit, block, policy: cut ? review.policy : null }),
    )
    explanations.set(key, explanation)
    // Failures are not cached: hovering the block again asks again.
    explanation.catch(() => explanations.delete(key))
  }
  return explanation
}

app.whenReady().then(() => {
  ipcMain.handle('settings:get', () => settingsView())
  ipcMain.handle('settings:save', (_event, update: SettingsUpdate) => saveSettings(update))
  ipcMain.handle('prs:list', async () => {
    const [reviewRequested, authored] = await Promise.all([
      searchPullRequests('--review-requested=@me'),
      searchPullRequests('--author=@me'),
    ])
    return { reviewRequested, authored }
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
