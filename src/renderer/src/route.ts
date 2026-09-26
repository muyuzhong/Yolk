import { useMemo, useSyncExternalStore } from 'react'

/**
 * Pages live in the URL hash, so nav items and breadcrumbs are real links and the mouse back button
 * works. `repo` is OWNER/REPO on github.com and HOST/OWNER/REPO elsewhere, as `gh -R` expects.
 */
export type Route =
  | { page: 'home' }
  | { page: 'settings' }
  | { page: 'repo'; repo: string }
  | { page: 'review'; repo: string; number: number }

export function parseRoute(hash: string): Route {
  const [first, ...rest] = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent)
  if (first === 'settings') return { page: 'settings' }
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
    case 'settings':
      return '#/settings'
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

const subscribe = (onChange: () => void) => {
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => location.hash)
  return useMemo(() => parseRoute(hash), [hash])
}
