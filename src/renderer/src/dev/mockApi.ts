// `window.yolk` for `npm run dev:web`: replays fixtures/yolk.json (from `npm run capture`) in a plain browser.
import { DEFAULT_JUDGING, type JudgingSettings } from '../../../core/judgment'
import type { Conventions, ReviewProgress, SettingsUpdate, SettingsView, YolkApi } from '../../../shared/api'
import type { Fixture } from './fixture'

/** Delay between replayed Jev units, so the progress UI is visible. */
const UNIT_DELAY_MS = 150

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export async function mockApi(): Promise<YolkApi> {
  const response = await fetch('/yolk.json')
  if (!response.ok) throw new Error('没有 fixtures/yolk.json，先运行 npm run capture -- <PR 链接>')
  const fixture: Fixture = await response.json()

  // Conventions persist in localStorage so a reload keeps them, like the real settings file would.
  const CONVENTIONS = 'yolk.mockConventions'
  const readConventions = (): Conventions => {
    const saved: Conventions = JSON.parse(localStorage.getItem(CONVENTIONS) ?? '{"default":"","repos":{}}')
    return { ...saved, repos: Object.fromEntries(Object.entries(saved.repos).map(([repo, text]) => [repo.toLowerCase(), text])) }
  }
  const JUDGING = 'yolk.mockJudging'
  const readJudging = (): JudgingSettings => JSON.parse(localStorage.getItem(JUDGING) ?? 'null') ?? DEFAULT_JUDGING
  let settings: SettingsView = {
    jev: { model: 'jev-latest', hasKey: true },
    llm: { baseURL: 'http://mock', model: 'mock', hasKey: true, ready: true },
    conventions: readConventions(),
    judging: readJudging(),
  }
  const listeners = new Set<(progress: ReviewProgress) => void>()
  const emit = (progress: ReviewProgress) => listeners.forEach((listener) => listener(progress))
  const cancelled = new Set<string>()

  return {
    getUpdateState: async () => ({ status: 'unsupported', currentVersion: 'dev', message: '网页预览不支持安装更新。' }),
    update: async () => {},
    onUpdateState: () => () => {},
    getSettings: async () => settings,
    saveSettings: async (update: SettingsUpdate) => {
      settings = {
        jev: { model: update.jev?.model ?? settings.jev.model, hasKey: update.jev?.apiKey === undefined ? settings.jev.hasKey : update.jev.apiKey !== '' },
        llm: { baseURL: update.llm?.baseURL ?? settings.llm.baseURL, model: update.llm?.model ?? settings.llm.model, hasKey: update.llm?.apiKey === undefined ? settings.llm.hasKey : update.llm.apiKey !== '', ready: true },
        conventions: settings.conventions,
        judging: settings.judging,
      }
      return settings
    },
    saveJudging: async (judging) => {
      const next = judging ? {
        thresholds: { ...settings.judging.thresholds, ...judging.thresholds },
        roles: { ...settings.judging.roles, ...judging.roles },
      } : DEFAULT_JUDGING
      localStorage.setItem(JUDGING, JSON.stringify(next))
      settings = { ...settings, judging: next }
      return settings
    },
    saveConvention: async (repo, text) => {
      repo = repo?.toLowerCase() ?? null
      const { default: fallback, repos } = settings.conventions
      const { [repo ?? '']: _, ...others } = repos
      const trimmed = text.trim()
      const conventions = repo === null ? { default: trimmed, repos } : { default: fallback, repos: trimmed ? { ...others, [repo]: trimmed } : others }
      localStorage.setItem(CONVENTIONS, JSON.stringify(conventions))
      settings = { ...settings, conventions }
      return settings
    },
    listRepositories: async () => fixture.repositories,
    listPullRequests: async (repo, state) => {
      const all = fixture.pullRequests[repo] ?? []
      // Set localStorage 'yolk.mockLogin' to view the lists as someone else, e.g. a maintainer with review requests.
      const login = localStorage.getItem('yolk.mockLogin') ?? fixture.login
      return { login, pullRequests: state === 'all' ? all : all.filter((pr) => pr.state === state.toUpperCase()) }
    },
    startReview: async (url, reviewId) => {
      const review = fixture.reviews[url]
      if (!review) throw new Error(`fixture 里没有这个 PR：${url}`)
      void (async () => {
        for (const unit of review.units) {
          await sleep(UNIT_DELAY_MS)
          if (cancelled.has(reviewId)) return
          emit({ type: 'unit', reviewId, ...unit })
        }
        emit({ type: 'done', reviewId, model: review.model, inputTokens: review.inputTokens })
      })()
      // The renderer merges judgments into what it receives; hand out a fresh copy each time. The judgments were
      // recorded without a convention, so the one applied here only changes what the review page shows.
      const { pr } = review.start
      const repo = `${pr.host === 'github.com' ? '' : `${pr.host}/`}${pr.owner}/${pr.repo}`.toLowerCase()
      const { default: fallback, repos } = settings.conventions
      const policy = repos[repo] || fallback || null
      return { ...structuredClone(review.start), policy, policySource: repos[repo] ? 'repo' : fallback ? 'default' : null }
    },
    cancelReview: (reviewId) => cancelled.add(reviewId),
    explainUnit: async (_reviewId, fileIndex, unitId) => {
      await sleep(600)
      return [
        `（mock）第 ${fileIndex} 个文件的 ${unitId}：先用一两句说这段代码整体在做什么，用来检查悬停卡片的排版。`,
        '第 12–15 行是核心：这里会写核心代码在做的事。',
        '第 18 行是防御：这里会写它在防什么错误。',
      ].join('\n')
    },
    explainSelection: async (_reviewId, fileIndex, lines) => {
      await sleep(600)
      const numbers = lines.flatMap((l) => (l.newNo === null ? [] : [l.newNo]))
      const removed = lines.filter((l) => l.kind === 'del').length
      return [
        `（mock）第 ${fileIndex} 个文件里选中的 ${lines.length} 行${numbers.length ? `（第 ${Math.min(...numbers)}–${Math.max(...numbers)} 行）` : ''}：这里会说明它们在做什么。`,
        removed ? `其中有 ${removed} 行是删掉的旧代码：这里会说明改了什么、为什么这样改。` : '选中部分没有删掉的代码。',
      ].join('\n')
    },
    onReviewProgress: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
