import { TypeSafeClient } from '@typesafe-ai/sdk'
import { app, BrowserWindow, ipcMain, shell, type WebContents } from 'electron'
import { fileURLToPath } from 'node:url'
import { chunkPullRequest, judgeFiles } from '../core/analyze'
import { getConvention, searchPullRequests } from '../core/sources/gh'
import type { ReviewProgress, ReviewStart, SettingsUpdate } from '../shared/api'
import { loadSettings, saveSettings, settingsView } from './settings'

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
  const { pr, files } = await chunkPullRequest(url)
  const policy = await getConvention(pr)
  judgeInBackground(sender, reviewId, { pr, files, policy })
  return { pr, files, policy }
}

/** Streams each unit's judgments to the renderer as its Jev request returns. */
async function judgeInBackground(sender: WebContents, reviewId: string, { pr, files, policy }: ReviewStart) {
  const send = (progress: ReviewProgress) => {
    if (!sender.isDestroyed()) sender.send('review:progress', progress)
  }
  try {
    const { jev } = await loadSettings()
    // Without a key in settings the SDK falls back to TYPESAFE_API_KEY.
    const client = new TypeSafeClient({ defaultModel: jev.model, ...(jev.apiKey ? { apiKey: jev.apiKey } : {}) })
    const { model, inputTokens } = await judgeFiles(pr, files, {
      policy,
      client,
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
  createWindow()
})

app.on('window-all-closed', () => app.quit())
