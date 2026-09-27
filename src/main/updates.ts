import { app, BrowserWindow, ipcMain, shell } from 'electron'
import updater from 'electron-updater'
import { access, constants } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { UpdateAction, UpdateState } from '../shared/api'

const RELEASES = 'https://github.com/muyuzhong/Yolk/releases'

export function registerUpdates() {
  const supported = app.isPackaged && (process.platform === 'win32' || (process.platform === 'linux' && !!process.env.APPIMAGE))
  let state: UpdateState = {
    currentVersion: app.getVersion(),
    status: supported ? 'idle' : 'unsupported',
    message: !app.isPackaged ? '开发模式不检查更新。'
      : process.platform === 'darwin' ? '当前 Mac 版本尚未签名，请从下载页安装新版本。'
      : !supported ? '此安装格式请通过下载页或系统包管理器更新；AppImage 支持应用内更新。' : undefined,
  }
  const set = (change: Partial<UpdateState>) => {
    state = { ...state, ...change }
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send('update:state', state)
  }
  const fail = (error: unknown) => set({ status: 'error', message: error instanceof Error ? error.message : String(error) })
  // Keep unsigned macOS / unpacked Linux away from unsupported installers.
  const autoUpdater = supported ? updater.autoUpdater : undefined
  if (autoUpdater) {
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = false
    autoUpdater.channel = `latest-${process.arch}`
    autoUpdater.allowDowngrade = false
    autoUpdater.allowPrerelease = false
    autoUpdater.on('error', fail)
    autoUpdater.on('update-available', ({ version }) => set({ status: 'available', version }))
    autoUpdater.on('update-not-available', () => set({ status: 'idle', message: '已经是最新版本。' }))
    autoUpdater.on('download-progress', ({ percent }) => set({ status: 'downloading', percent }))
    autoUpdater.on('update-downloaded', ({ version }) => set({ status: 'downloaded', version, percent: 100 }))
  }
  const writable = async () => {
    if (process.platform !== 'linux' || !process.env.APPIMAGE) return
    try {
      await access(process.env.APPIMAGE, constants.W_OK)
      await access(dirname(process.env.APPIMAGE), constants.W_OK)
    } catch {
      throw new Error('AppImage 所在位置不可写，请先移动到自己的用户目录再更新。')
    }
  }
  ipcMain.handle('update:state', () => state)
  ipcMain.handle('update:action', async (_event, action: UpdateAction) => {
    if (!['check', 'download', 'install', 'open-downloads'].includes(action)) throw new Error('未知的更新操作')
    if (action === 'open-downloads') return shell.openExternal(RELEASES)
    if (!autoUpdater) return
    try {
      if (action === 'check' && ['idle', 'error', 'available'].includes(state.status)) {
        set({ status: 'checking', version: undefined, percent: undefined, message: undefined })
        await autoUpdater.checkForUpdates()
      } else if (action === 'download' && state.status === 'available') {
        set({ status: 'downloading', percent: 0, message: undefined })
        await writable()
        await autoUpdater.downloadUpdate()
      } else if (action === 'install' && state.status === 'downloaded') {
        set({ status: 'installing' })
        await writable()
        autoUpdater.quitAndInstall(false, true)
      }
    } catch (error) {
      fail(error)
    }
  })
}
