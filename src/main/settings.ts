import { app, safeStorage } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { LlmConfig } from '../core/llm'
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

// Like TYPESAFE_API_KEY for Jev, empty general-model fields fall back to the environment.
const env = () => ({
  baseURL: process.env.OPENAI_BASE_URL ?? '',
  apiKey: process.env.OPENAI_API_KEY ?? '',
  model: process.env.OPENAI_MODEL ?? '',
})

export async function llmConfig(): Promise<LlmConfig> {
  const { llm } = await loadSettings()
  const fallback = env()
  const config = { baseURL: llm.baseURL || fallback.baseURL, apiKey: llm.apiKey || fallback.apiKey, model: llm.model || fallback.model }
  if (!config.baseURL || !config.apiKey || !config.model) throw new Error('通用模型还没配置：请在设置页填写 Base URL、API Key 和模型名')
  return config
}

export async function settingsView(): Promise<SettingsView> {
  const stored = await readStored()
  const fallback = env()
  return {
    jev: { model: stored.jev.model, hasKey: Boolean(stored.jev.apiKey) },
    llm: {
      baseURL: stored.llm.baseURL,
      model: stored.llm.model,
      hasKey: Boolean(stored.llm.apiKey),
      ready: Boolean((stored.llm.baseURL || fallback.baseURL) && (stored.llm.apiKey || fallback.apiKey) && (stored.llm.model || fallback.model)),
    },
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
