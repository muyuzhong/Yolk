import { app, safeStorage } from 'electron'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DEFAULT_JUDGING, type JudgingSettings, type JudgingUpdate, type Role } from '../core/judgment'
import type { LlmConfig } from '../core/llm'
import type { ConventionSource, Conventions, SettingsUpdate, SettingsView } from '../shared/api'

export interface Settings {
  jev: { model: string; apiKey: string }
  llm: { baseURL: string; model: string; apiKey: string }
  judging: JudgingSettings
}

/** On disk the keys are encrypted with the OS keychain via safeStorage and stored as base64; conventions are plain text. */
interface StoredSettings {
  jev: { model: string; apiKey: string }
  llm: { baseURL: string; model: string; apiKey: string }
  conventions: Conventions
  /** Store only overrides, so new defaults reach users who never changed them. */
  judging: JudgingUpdate
}

const DEFAULTS: StoredSettings = {
  jev: { model: 'jev-latest', apiKey: '' },
  llm: { baseURL: '', model: '', apiKey: '' },
  conventions: { default: '', repos: {} },
  judging: {},
}

const withDefaults = ({ thresholds, roles }: JudgingUpdate): JudgingSettings => ({
  thresholds: { ...DEFAULT_JUDGING.thresholds, ...thresholds },
  roles: { ...DEFAULT_JUDGING.roles, ...roles },
})

/** Keeps the values that differ from their defaults; blank role text means the default. */
function overrides({ thresholds, roles }: JudgingSettings): JudgingUpdate {
  const changed = <T extends object>(values: T, defaults: T) =>
    Object.fromEntries(Object.entries(values).filter(([key, value]) => value !== '' && value !== defaults[key as keyof T])) as Partial<T>
  return {
    thresholds: changed(thresholds, DEFAULT_JUDGING.thresholds),
    roles: changed(Object.fromEntries(Object.entries(roles).map(([k, v]) => [k, v.trim()])) as Record<Role, string>, DEFAULT_JUDGING.roles),
  }
}

const file = () => join(app.getPath('userData'), 'settings.json')
const encrypt = (key: string) => (key ? safeStorage.encryptString(key).toString('base64') : '')
const decrypt = (stored: string) => (stored ? safeStorage.decryptString(Buffer.from(stored, 'base64')) : '')

async function readStored(): Promise<StoredSettings> {
  try {
    const stored = JSON.parse(await readFile(file(), 'utf8'))
    return {
      jev: { ...DEFAULTS.jev, ...stored.jev },
      llm: { ...DEFAULTS.llm, ...stored.llm },
      conventions: {
        default: stored.conventions?.default ?? '',
        repos: Object.fromEntries(Object.entries<string>(stored.conventions?.repos ?? {}).map(([repo, text]) => [repo.toLowerCase(), text])),
      },
      judging: { thresholds: { ...stored.judging?.thresholds }, roles: { ...stored.judging?.roles } },
    }
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
    judging: withDefaults(stored.judging),
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
  if (!config.baseURL || !config.apiKey || !config.model) throw new Error('通用模型还没配置：请在设置里填写 Base URL、API Key 和模型名')
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
    conventions: stored.conventions,
    judging: withDefaults(stored.judging),
  }
}

// One settings file, owned by this main process: serialize the entire read/modify/write operation.
let writes = Promise.resolve()
function updateStored(change: (stored: StoredSettings) => StoredSettings): Promise<SettingsView> {
  const result = writes.then(async () => {
    const next = change(await readStored())
    await writeFile(`${file()}.tmp`, JSON.stringify(next, null, 2))
    await rename(`${file()}.tmp`, file())
    return settingsView()
  })
  writes = result.then(() => {}, () => {})
  return result
}

export function saveSettings(update: SettingsUpdate): Promise<SettingsView> {
  return updateStored((stored) => ({
    jev: { model: update.jev?.model ?? stored.jev.model, apiKey: update.jev?.apiKey === undefined ? stored.jev.apiKey : encrypt(update.jev.apiKey) },
    llm: {
      baseURL: update.llm?.baseURL ?? stored.llm.baseURL,
      model: update.llm?.model ?? stored.llm.model,
      apiKey: update.llm?.apiKey === undefined ? stored.llm.apiKey : encrypt(update.llm.apiKey),
    },
    conventions: stored.conventions,
    judging: stored.judging,
  }))
}

export function saveJudging(judging: JudgingUpdate | null): Promise<SettingsView> {
  return updateStored((stored) => {
    const current = withDefaults(stored.judging)
    return { ...stored, judging: judging ? overrides({
      thresholds: { ...current.thresholds, ...judging.thresholds },
      roles: { ...current.roles, ...judging.roles },
    }) : {} }
  })
}

export function saveConvention(repo: string | null, text: string): Promise<SettingsView> {
  repo = repo?.toLowerCase() ?? null
  return updateStored((stored) => {
    const trimmed = text.trim()
    const { [repo ?? '']: _, ...others } = stored.conventions.repos
    const conventions: Conventions =
      repo === null ? { ...stored.conventions, default: trimmed } : { ...stored.conventions, repos: trimmed ? { ...others, [repo]: trimmed } : others }
    return { ...stored, conventions }
  })
}

/** The convention a repository's reviews are judged by: its own entry, else the default, else none. */
export async function conventionFor(repo: string): Promise<{ policy: string | null; policySource: ConventionSource | null }> {
  repo = repo.toLowerCase()
  const { conventions } = await readStored()
  if (conventions.repos[repo]) return { policy: conventions.repos[repo], policySource: 'repo' }
  if (conventions.default) return { policy: conventions.default, policySource: 'default' }
  return { policy: null, policySource: null }
}
