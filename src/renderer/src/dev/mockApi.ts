// `window.yolk` for `npm run dev:web`: replays fixtures/yolk.json (from `npm run capture`) in a plain browser.
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
  const readConventions = (): Conventions => JSON.parse(localStorage.getItem(CONVENTIONS) ?? '{"default":"","repos":{}}')
  let settings: SettingsView = {
    jev: { model: 'jev-latest', hasKey: true },
    llm: { baseURL: 'http://mock', model: 'mock', hasKey: true, ready: true },
    conventions: readConventions(),
  }
  const listeners = new Set<(progress: ReviewProgress) => void>()
  const emit = (progress: ReviewProgress) => listeners.forEach((listener) => listener(progress))
  const cancelled = new Set<string>()

  return {
    getSettings: async () => settings,
    saveSettings: async (update: SettingsUpdate) => {
      settings = {
        jev: { model: update.jev.model, hasKey: update.jev.apiKey !== '' },
        llm: { ...update.llm, hasKey: update.llm.apiKey !== '', ready: true },
        conventions: settings.conventions,
      }
      return settings
    },
    saveConvention: async (repo, text) => {
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
      const repo = `${pr.host === 'github.com' ? '' : `${pr.host}/`}${pr.owner}/${pr.repo}`
      const { default: fallback, repos } = settings.conventions
      const policy = repos[repo] || fallback || null
      return { ...structuredClone(review.start), policy, policySource: repos[repo] ? 'repo' : fallback ? 'default' : null }
    },
    cancelReview: (reviewId) => cancelled.add(reviewId),
    explainBlock: async (_reviewId, fileIndex, blockId) => {
      await sleep(400)
      return `（mock）第 ${fileIndex} 个文件的 ${blockId} 块：这里是模型的一段解释，用来检查 tooltip 的排版和长度。`
    },
    onReviewProgress: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
