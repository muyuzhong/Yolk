// Recently opened and pinned repositories, per machine, most recent first. Pinned ones never age out.
import { useSyncExternalStore } from 'react'

const RECENT = 'yolk.recentRepositories'
const PINNED = 'yolk.pinnedRepositories'
const LIMIT = 8

export interface RepositoryShortcuts {
  pinned: string[]
  /** Recent repositories that are not pinned. */
  recent: string[]
}

const read = (key: string): string[] => JSON.parse(localStorage.getItem(key) ?? '[]')
const listeners = new Set<() => void>()
let snapshot: RepositoryShortcuts | undefined

function write(key: string, repos: string[]) {
  localStorage.setItem(key, JSON.stringify(repos))
  snapshot = undefined
  listeners.forEach((listener) => listener())
}

function shortcuts(): RepositoryShortcuts {
  if (!snapshot) {
    const pinned = read(PINNED)
    snapshot = { pinned, recent: read(RECENT).filter((r) => !pinned.includes(r)) }
  }
  return snapshot
}

export function useRepositoryShortcuts(): RepositoryShortcuts {
  return useSyncExternalStore((listener) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }, shortcuts)
}

export function rememberRepository(repo: string) {
  const recent = read(RECENT)
  if (recent[0] !== repo) write(RECENT, [repo, ...recent.filter((r) => r !== repo)].slice(0, LIMIT))
}

export function setPinned(repo: string, pinned: boolean) {
  const rest = read(PINNED).filter((r) => r !== repo)
  write(PINNED, pinned ? [...rest, repo] : rest)
}
