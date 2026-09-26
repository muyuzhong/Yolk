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

/** OWNER/REPO on github.com, HOST/OWNER/REPO elsewhere: the key the app uses for a repository everywhere. */
export const repoKey = (pr: Pick<PullRequest, 'host' | 'owner' | 'repo'>) => `${pr.host === 'github.com' ? '' : `${pr.host}/`}${pr.owner}/${pr.repo}`

export interface RepositorySummary {
  fullName: string
  description: string
  private: boolean
  pushedAt: string
}

/** Repositories the user owns, collaborates on or reaches through an organization; the 100 most recently pushed. */
export async function listRepositories(): Promise<RepositorySummary[]> {
  const repos = JSON.parse(await gh(['api', 'user/repos?affiliation=owner,collaborator,organization_member&sort=pushed&per_page=100']))
  return repos
    .filter((repo: { archived: boolean }) => !repo.archived)
    .map((repo: { full_name: string; description: string | null; private: boolean; pushed_at: string }) => ({
      fullName: repo.full_name,
      description: repo.description ?? '',
      private: repo.private,
      pushedAt: repo.pushed_at,
    }))
}

export type PullRequestState = 'open' | 'merged' | 'closed' | 'all'

export interface PullRequestSummary {
  url: string
  number: number
  title: string
  author: string
  updatedAt: string
  state: 'OPEN' | 'MERGED' | 'CLOSED'
  draft: boolean
  additions: number
  deletions: number
  /** APPROVED, CHANGES_REQUESTED, REVIEW_REQUIRED or '' when the repo has no review rules. */
  reviewDecision: string
  /** Logins of users asked to review (team requests are left out). */
  requestedReviewers: string[]
}

/** A repository's PRs in one state, most recently created first (`repo` is OWNER/REPO or HOST/OWNER/REPO). */
export async function listPullRequests(repo: string, state: PullRequestState): Promise<PullRequestSummary[]> {
  const fields = 'number,title,url,author,updatedAt,state,isDraft,additions,deletions,reviewDecision,reviewRequests'
  const prs = JSON.parse(await gh(['pr', 'list', '-R', repo, '--state', state, '--limit', '100', '--json', fields]))
  return prs.map(
    (pr: Omit<PullRequestSummary, 'author' | 'draft' | 'requestedReviewers'> & {
      author: { login: string }
      isDraft: boolean
      reviewRequests: { login?: string }[]
    }) => ({
      url: pr.url,
      number: pr.number,
      title: pr.title,
      author: pr.author.login,
      updatedAt: pr.updatedAt,
      state: pr.state,
      draft: pr.isDraft,
      additions: pr.additions,
      deletions: pr.deletions,
      reviewDecision: pr.reviewDecision,
      requestedReviewers: pr.reviewRequests.flatMap((r) => (r.login ? [r.login] : [])),
    }),
  )
}

export async function currentUser(): Promise<string> {
  return (await gh(['api', 'user', '--jq', '.login'])).trim()
}
