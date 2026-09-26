import { useMemo, useSyncExternalStore } from 'react'

/**
 * Pages live in the URL hash, so nav items and breadcrumbs are real links and the mouse back button
 * works. `repo` is OWNER/REPO on github.com and HOST/OWNER/REPO elsewhere, as `gh -R` expects.
 */
export type Route =
  | { page: 'home' }
  | { page: 'repos' }
  | { page: 'repo'; repo: string }
  | { page: 'review'; repo: string; number: number }

export function parseRoute(hash: string): Route {
  const [first, ...rest] = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent)
  if (first === 'repos') return { page: 'repos' }
  if (first === 'r') {
    const pull = rest.length - 2
    if (pull >= 2 && rest[pull] === 'pull' && /^\d+$/.test(rest[pull + 1])) {
      return { page: 'review', repo: rest.slice(0, pull).join('/'), number: Number(rest[pull + 1]) }
    }
    if (rest.length === 2 || rest.length === 3) return { page: 'repo', repo: rest.join('/') }
  }
  return { page: 'home' }
}

export function href(route: Route): string {
  switch (route.page) {
    case 'home':
      return '#/'
    case 'repos':
      return '#/repos'
    case 'repo':
      return `#/r/${route.repo}`
    case 'review':
      return `#/r/${route.repo}/pull/${route.number}`
  }
}

export function navigate(route: Route) {
  location.hash = href(route)
}

export function repositoryUrl(repo: string): string {
  const parts = repo.split('/')
  const [host, owner, name] = parts.length === 3 ? parts : ['github.com', ...parts]
  return `https://${host}/${owner}/${name}`
}

export const pullRequestUrl = (repo: string, number: number) => `${repositoryUrl(repo)}/pull/${number}`

/** One level up: where "back" goes when this session has no earlier page to return to. */
export function parentOf(route: Route): Route | undefined {
  switch (route.page) {
    case 'review':
      return { page: 'repo', repo: route.repo }
    case 'repo':
      return { page: 'repos' }
    case 'repos':
      return { page: 'home' }
    case 'home':
      return undefined
  }
}

// Each history entry this session created is stamped with its depth, so "back" can tell whether there is an earlier
// Yolk page to return to (history.length also counts pages from before the app loaded).
let depth = 0
/** Set while going up a level in place, so the entry it replaces keeps the current depth. */
let replacing = false
if (typeof window !== 'undefined') {
  const initial = (history.state as { yolkDepth?: number } | null)?.yolkDepth
  if (initial === undefined) history.replaceState({ yolkDepth: 0 }, '')
  else depth = initial
  window.addEventListener('hashchange', () => {
    const stamped = (history.state as { yolkDepth?: number } | null)?.yolkDepth
    if (stamped === undefined) history.replaceState({ yolkDepth: replacing ? depth : ++depth }, '')
    else depth = stamped
    replacing = false
  })
}

/**
 * Back to the previous page if this session has one, otherwise one level up. Going up replaces the current entry,
 * so the next "back" keeps climbing instead of returning to the page just left.
 */
export function goBack(route: Route) {
  if (depth > 0) return history.back()
  const parent = parentOf(route)
  if (!parent) return
  replacing = true
  location.replace(href(parent))
}

const subscribe = (onChange: () => void) => {
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => location.hash)
  return useMemo(() => parseRoute(hash), [hash])
}
