import { TypeSafeClient } from '@typesafe-ai/sdk'
import { app, BrowserWindow, ipcMain, shell, type WebContents } from 'electron'
import { fileURLToPath } from 'node:url'
import { chunkPullRequest, judgeFiles } from '../core/analyze'
import { getConvention, searchPullRequests } from '../core/sources/gh'
import type { ReviewProgress, ReviewStart, SettingsUpdate } from '../shared/api'
import { loadSettings, saveSettings, settingsView } from './settings'

const reviews = new Map<number, { reviewId: string; controller: AbortController }>()

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    title: 'Yolk',
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
  }
  try {
    const { pr, files } = await chunkPullRequest(url)
    signal.throwIfAborted()
    const policy = await getConvention(pr)
    signal.throwIfAborted()
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
  ipcMain.on('review:cancel', (event, reviewId: string) => {
    const review = reviews.get(event.sender.id)
    if (review?.reviewId === reviewId) review.controller.abort()
  })
  createWindow()
})

app.on('window-all-closed', () => app.quit())
