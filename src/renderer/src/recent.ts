// Recently opened and pinned repositories, per machine, most recent first. Pinned ones never age out.
import { useSyncExternalStore } from 'react'
import { createStore } from './store'

const RECENT = 'yolk.recentRepositories'
const PINNED = 'yolk.pinnedRepositories'
const LIMIT = 8

export interface RepositoryShortcuts {
  pinned: string[]
  /** Recent repositories that are not pinned. */
  recent: string[]
}

const read = (key: string): string[] => JSON.parse(localStorage.getItem(key) ?? '[]')
const store = createStore<RepositoryShortcuts>(() => {
  const pinned = read(PINNED)
  return { pinned, recent: read(RECENT).filter((r) => !pinned.includes(r)) }
})

function write(key: string, repos: string[]) {
  localStorage.setItem(key, JSON.stringify(repos))
  store.notify()
}

export function useRepositoryShortcuts(): RepositoryShortcuts {
  return useSyncExternalStore(store.subscribe, store.getSnapshot)
}

export function rememberRepository(repo: string) {
  const recent = read(RECENT)
  if (recent[0] !== repo) write(RECENT, [repo, ...recent.filter((r) => r !== repo)].slice(0, LIMIT))
}

export function setPinned(repo: string, pinned: boolean) {
  const rest = read(PINNED).filter((r) => r !== repo)
  write(PINNED, pinned ? [...rest, repo] : rest)
}
