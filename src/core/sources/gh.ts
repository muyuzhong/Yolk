import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)

async function gh(args: string[]): Promise<string> {
  const { stdout } = await exec('gh', args, { maxBuffer: 256 * 1024 * 1024 })
  return stdout
}

export interface PullRequest {
  host: string
  owner: string
  repo: string
  number: number
  title: string
  body: string
  url: string
  baseSha: string
  headSha: string
}

export function parsePrUrl(url: string) {
  const m = /^https?:\/\/([^/]+)\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(url)
  if (!m) throw new Error(`不是 PR 链接：${url}`)
  return { host: m[1], owner: m[2], repo: m[3], number: Number(m[4]) }
}

export async function getPullRequest(url: string): Promise<PullRequest> {
  const ref = parsePrUrl(url)
  const pr = JSON.parse(await gh(['pr', 'view', url, '--json', 'title,body,url,baseRefOid,headRefOid']))
  return { ...ref, title: pr.title, body: pr.body, url: pr.url, baseSha: pr.baseRefOid, headSha: pr.headRefOid }
}

export function getPullRequestDiff(url: string): Promise<string> {
  return gh(['pr', 'diff', url, '--color', 'never'])
}

/** Reads a file at a commit. Fork PR heads are reachable from the base repo via refs/pull/N/head. */
export function getFileAt(pr: PullRequest, path: string, ref: string): Promise<string> {
  const encoded = path.split('/').map(encodeURIComponent).join('/')
  return gh([
    'api',
    '--hostname', pr.host,
    `repos/${pr.owner}/${pr.repo}/contents/${encoded}?ref=${ref}`,
    '-H', 'Accept: application/vnd.github.raw',
  ])
}

/** The project convention `.yolk.md`, read from the base so a PR cannot change the rules it is judged by. */
export async function getConvention(pr: PullRequest): Promise<string | null> {
  try {
    return await getFileAt(pr, '.yolk.md', pr.baseSha)
  } catch (error) {
    if (String((error as { stderr?: string }).stderr).includes('HTTP 404')) return null
    throw error
  }
}

export interface PullRequestSummary {
  url: string
  number: number
  title: string
  repository: string
  author: string
  updatedAt: string
}

/** Open PRs matching a `gh search prs` qualifier, e.g. `--review-requested=@me` or `--author=@me`. */
export async function searchPullRequests(qualifier: string): Promise<PullRequestSummary[]> {
  const prs = JSON.parse(
    await gh(['search', 'prs', qualifier, '--state=open', '--limit=50', '--json', 'number,title,url,repository,author,updatedAt']),
  )
  return prs.map((pr: { url: string; number: number; title: string; repository: { nameWithOwner: string }; author: { login: string }; updatedAt: string }) => ({
    url: pr.url,
    number: pr.number,
    title: pr.title,
    repository: pr.repository.nameWithOwner,
    author: pr.author.login,
    updatedAt: pr.updatedAt,
  }))
}
