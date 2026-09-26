/** What the home page input points at: a PR to open, a repository to list, or neither (just a filter). */
export type Target = { kind: 'pr'; url: string; repo: string } | { kind: 'repo'; repo: string } | null

/** `repo` is OWNER/REPO on github.com and HOST/OWNER/REPO elsewhere, as `gh -R` expects. */
export function parseTarget(input: string): Target {
  const text = input.trim()
  const url = /^https?:\/\/([^/\s]+)\/([^/\s]+)\/([^/\s#?]+)(\/pull\/\d+)?/.exec(text)
  if (url) {
    const [, host, owner, name, pull] = url
    const repo = `${host === 'github.com' ? '' : `${host}/`}${owner}/${name.replace(/\.git$/, '')}`
    return pull ? { kind: 'pr', url: text, repo } : { kind: 'repo', repo }
  }
  if (/^[\w.-]+\/[\w.-]+$/.test(text)) return { kind: 'repo', repo: text }
  return null
}
