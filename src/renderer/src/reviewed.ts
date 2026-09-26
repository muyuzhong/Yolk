// What Yolk found the last time each PR was fully judged, per machine, so PR lists can show it without re-judging.
import { useSyncExternalStore } from 'react'

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

const listeners = new Set<() => void>()
let snapshot: Store | undefined

function read(): Store {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}')
  } catch {
    return {}
  }
}

export function rememberReview(url: string, summary: ReviewedSummary) {
  const { [url]: _, ...rest } = read()
  const entries = Object.entries({ ...rest, [url]: summary }).slice(-LIMIT)
  localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(entries)))
  snapshot = undefined
  listeners.forEach((listener) => listener())
}

/** Last judged summaries by PR URL. */
export function useReviewedPullRequests(): Store {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => (snapshot ??= read()),
  )
}
