// Recently opened repositories, per machine, most recent first.
const KEY = 'yolk.recentRepositories'
const LIMIT = 8

export function recentRepositories(): string[] {
  return JSON.parse(localStorage.getItem(KEY) ?? '[]')
}

export function rememberRepository(repo: string) {
  localStorage.setItem(KEY, JSON.stringify([repo, ...recentRepositories().filter((r) => r !== repo)].slice(0, LIMIT)))
}
