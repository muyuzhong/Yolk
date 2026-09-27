import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { registerHooks } from 'node:module'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('updates require explicit download/install, serialize actions, and recover from failures', { timeout: 5000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'yolk-update-'))
  const image = join(dir, 'Yolk.AppImage')
  await writeFile(image, '')
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
  const oldImage = process.env.APPIMAGE
  Object.defineProperty(process, 'platform', { value: 'linux' })
  process.env.APPIMAGE = image
  const handlers = new Map<string, Function>()
  let checks = 0, downloads = 0, installs = 0
  let rejectCheck = false
  let finishDownload: () => void = () => {}
  const updater = Object.assign(new EventEmitter(), {
    autoDownload: true, autoInstallOnAppQuit: true, allowDowngrade: true, allowPrerelease: true, channel: '',
    checkForUpdates: async () => {
      checks++
      if (rejectCheck) throw new Error('network unavailable')
      updater.emit('update-available', { version: '0.0.3' })
    },
    downloadUpdate: () => {
      downloads++
      return new Promise<void>((resolve) => { finishDownload = () => { updater.emit('update-downloaded', { version: '0.0.3' }); resolve() } })
    },
    quitAndInstall: (silent: boolean, restart: boolean) => { assert.equal(silent, false); assert.equal(restart, true); installs++ },
  })
  const app = { isPackaged: true, getVersion: () => '0.0.2' }
  const sent: unknown[] = [], opened: string[] = []
  const electron = {
    app, ipcMain: { handle: (name: string, handler: Function) => handlers.set(name, handler) },
    BrowserWindow: { getAllWindows: () => [{ webContents: { send: (_name: string, state: unknown) => sent.push(state) } }] },
    shell: { openExternal: async (url: string) => { opened.push(url) } },
  }
  Object.assign(globalThis, { __yolkUpdates: { electron, updater } })
  const source = (code: string) => `data:text/javascript,${encodeURIComponent(code)}`
  const urls: Record<string, string> = {
    electron: source('export const {app, ipcMain, BrowserWindow, shell} = globalThis.__yolkUpdates.electron'),
    'electron-updater': source('export default {autoUpdater: globalThis.__yolkUpdates.updater}'),
  }
  const hooks = registerHooks({ resolve: (s, c, next) => urls[s] ? { url: urls[s], shortCircuit: true } : next(s, c) })
  try {
    const { registerUpdates } = await import('../src/main/updates')
    registerUpdates()
    const action = (value: string) => handlers.get('update:action')!({}, value)
    const state = () => handlers.get('update:state')!()
    assert.equal(updater.autoDownload, false)
    assert.equal(updater.autoInstallOnAppQuit, false)
    assert.equal(updater.allowDowngrade, false)
    assert.equal(updater.allowPrerelease, false)
    assert.equal(updater.channel, `latest-${process.arch}`)
    await action('install')
    assert.equal(installs, 0)
    await action('check')
    assert.equal(state().status, 'available')
    assert.equal(downloads, 0)
    const pending = action('download')
    await action('download')
    await action('check')
    await action('install')
    assert.equal(checks, 1)
    assert.equal(installs, 0)
    // Let the filesystem permission checks complete before the mock download starts.
    while (!downloads) await new Promise(resolve => setTimeout(resolve, 5))
    assert.equal(downloads, 1)
    updater.emit('download-progress', { percent: 42 })
    assert.equal(state().percent, 42)
    finishDownload()
    await pending
    assert.equal(state().status, 'downloaded')
    assert.equal(installs, 0)
    await Promise.all([action('install'), action('install')])
    assert.equal(installs, 1)
    updater.emit('error', new Error('checksum mismatch'))
    assert.equal(state().status, 'error')
    rejectCheck = true
    await action('check')
    assert.match(state().message, /network unavailable/)
    rejectCheck = false
    await action('check')
    assert.equal(state().status, 'available')
    await rm(image)
    await action('download')
    assert.equal(state().status, 'error')
    assert.match(state().message, /不可写/)
    assert.equal(downloads, 1)
    await action('open-downloads')
    assert.deepEqual(opened, ['https://github.com/muyuzhong/Yolk/releases'])
    await assert.rejects(action('invalid'), /未知/)
    assert.ok(sent.length > 0)
    app.isPackaged = false
    registerUpdates()
    assert.equal(state().status, 'unsupported')
    const before = checks
    await action('check')
    assert.equal(checks, before)
  } finally {
    hooks.deregister()
    Object.defineProperty(process, 'platform', platform)
    if (oldImage === undefined) delete process.env.APPIMAGE
    else process.env.APPIMAGE = oldImage
    delete (globalThis as any).__yolkUpdates
    await rm(dir, { recursive: true, force: true })
  }
})
