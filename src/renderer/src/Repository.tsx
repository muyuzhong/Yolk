import { useEffect, useState } from 'react'
import type { PullRequestState } from '../../core/sources/gh'
import type { PullRequestList } from '../../shared/api'
import { errorMessage } from './labels'

const STATES: [PullRequestState, string][] = [
  ['open', '打开的'],
  ['merged', '已合并'],
  ['closed', '已关闭'],
  ['all', '全部'],
]

const DECISION: Record<string, string> = { APPROVED: '已批准', CHANGES_REQUESTED: '需修改', REVIEW_REQUIRED: '待审阅' }
const CLOSED: Record<string, string> = { MERGED: '已合并', CLOSED: '已关闭' }

export function Repository({ repo, onOpenPr, onBack }: { repo: string; onOpenPr: (url: string) => void; onBack: () => void }) {
  const [state, setState] = useState<PullRequestState>('open')
  const [list, setList] = useState<PullRequestList>()
  const [error, setError] = useState<string>()

  useEffect(() => {
    setList(undefined)
    setError(undefined)
    window.yolk.listPullRequests(repo, state).then(setList, (e) => setError(errorMessage(e)))
  }, [repo, state])

  const host = repo.split('/').length === 3 ? '' : 'github.com/'
  return (
    <div className="repo-page">
      <header className="page-header">
        <button className="link" onClick={onBack}>
          ◀ 返回
        </button>
        <h1>
          <a href={`https://${host}${repo}/pulls`} target="_blank" rel="noreferrer">
            {repo}
          </a>
        </h1>
      </header>
      <div className="state-tabs">
        {STATES.map(([value, label]) => (
          <button key={value} className={value === state ? 'active' : ''} onClick={() => setState(value)}>
            {label}
          </button>
        ))}
        {list && <span className="muted">{list.pullRequests.length === 100 ? '最近 100 个' : `${list.pullRequests.length} 个`}</span>}
      </div>
      {error && <p className="error">读取 PR 列表失败：{error}</p>}
      {!list && !error && <p className="muted">正在通过 gh 读取 PR…</p>}
      {list?.pullRequests.length === 0 && <p className="muted">没有这个状态的 PR</p>}
      {list?.pullRequests.map((pr) => (
        <button key={pr.url} className="pr-item" data-number={pr.number} onClick={() => onOpenPr(pr.url)}>
          <span className="pr-title">
            {pr.title}
            {pr.draft && <span className="tag">草稿</span>}
            {CLOSED[pr.state] && <span className="tag">{CLOSED[pr.state]}</span>}
            {pr.requestedReviewers.includes(list.login) && <span className="tag accent">请你审阅</span>}
            {DECISION[pr.reviewDecision] && <span className="tag">{DECISION[pr.reviewDecision]}</span>}
          </span>
          <span className="muted">
            #{pr.number} · {pr.author} · 更新于 {new Date(pr.updatedAt).toLocaleString('zh-CN')} ·{' '}
            <span className="additions">+{pr.additions}</span> <span className="deletions">−{pr.deletions}</span>
          </span>
        </button>
      ))}
    </div>
  )
}
