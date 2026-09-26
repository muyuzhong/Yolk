// What Yolk found the last time each PR was fully judged, per machine, so PR lists can show it without re-judging.
import { useSyncExternalStore } from 'react'
import type { Category } from './rows'
import { createStore } from './store'

const KEY = 'yolk.reviewedPullRequests'
/** Oldest entries are dropped past this many PRs. */
const LIMIT = 500

export interface ReviewedSummary {
  /** ISO time the judgment finished. */
  at: string
  /** Changed lines per category. */
  core: number
  defense: number
  support: number
}

type Store = Record<string, ReviewedSummary>

const store = createStore(read)

function read(): Store {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}')
  } catch {
    return {}
  }
}

export function rememberReview(url: string, counts: Partial<Record<Category, number>>) {
  if (counts.failed || counts.pending) return
  const summary: ReviewedSummary = { at: new Date().toISOString(), core: counts.core ?? 0, defense: counts.defense ?? 0, support: counts.support ?? 0 }
  const { [url]: _, ...rest } = read()
  const entries = Object.entries({ ...rest, [url]: summary }).slice(-LIMIT)
  localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(entries)))
  store.notify()
}

/** Last judged summaries by PR URL. */
export function useReviewedPullRequests(): Store {
  return useSyncExternalStore(store.subscribe, store.getSnapshot)
}
