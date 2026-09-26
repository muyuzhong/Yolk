import { app, safeStorage } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { SettingsUpdate, SettingsView } from '../shared/api'

export interface Settings {
  jev: { model: string; apiKey: string }
  llm: { baseURL: string; model: string; apiKey: string }
}

/** On disk the keys are encrypted with the OS keychain via safeStorage and stored as base64. */
interface StoredSettings {
  jev: { model: string; apiKey: string }
  llm: { baseURL: string; model: string; apiKey: string }
}

const DEFAULTS: StoredSettings = {
  jev: { model: 'jev-latest', apiKey: '' },
  llm: { baseURL: '', model: '', apiKey: '' },
}

const file = () => join(app.getPath('userData'), 'settings.json')
const encrypt = (key: string) => (key ? safeStorage.encryptString(key).toString('base64') : '')
const decrypt = (stored: string) => (stored ? safeStorage.decryptString(Buffer.from(stored, 'base64')) : '')

async function readStored(): Promise<StoredSettings> {
  try {
    const stored = JSON.parse(await readFile(file(), 'utf8'))
    return { jev: { ...DEFAULTS.jev, ...stored.jev }, llm: { ...DEFAULTS.llm, ...stored.llm } }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return DEFAULTS
    throw error
  }
}

export async function loadSettings(): Promise<Settings> {
  const stored = await readStored()
  return {
    jev: { ...stored.jev, apiKey: decrypt(stored.jev.apiKey) },
    llm: { ...stored.llm, apiKey: decrypt(stored.llm.apiKey) },
  }
}

export async function settingsView(): Promise<SettingsView> {
  const stored = await readStored()
  return {
    jev: { model: stored.jev.model, hasKey: Boolean(stored.jev.apiKey) },
    llm: { baseURL: stored.llm.baseURL, model: stored.llm.model, hasKey: Boolean(stored.llm.apiKey) },
  }
}

export async function saveSettings(update: SettingsUpdate): Promise<SettingsView> {
  const stored = await readStored()
  const next: StoredSettings = {
    jev: { model: update.jev.model, apiKey: update.jev.apiKey === undefined ? stored.jev.apiKey : encrypt(update.jev.apiKey) },
    llm: {
      baseURL: update.llm.baseURL,
      model: update.llm.model,
      apiKey: update.llm.apiKey === undefined ? stored.llm.apiKey : encrypt(update.llm.apiKey),
    },
  }
  await writeFile(file(), JSON.stringify(next, null, 2))
  return settingsView()
}
