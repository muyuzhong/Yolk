import { useEffect, useState, type FormEvent } from 'react'
import type { RepositorySummary } from '../../core/sources/gh'
import { errorMessage } from './labels'
import { recentRepositories } from './recent'
import { parseTarget } from './target'

// Listed once per app run so going back home is instant; a failed listing is retried next time.
let repositoryList: Promise<RepositorySummary[]> | undefined
const loadRepositories = () =>
  (repositoryList ??= window.yolk.listRepositories().catch((error) => {
    repositoryList = undefined
    throw error
  }))

interface Props {
  onOpenRepo: (repo: string) => void
  onOpenPr: (url: string, repo: string) => void
  onSettings: () => void
}

export function Home({ onOpenRepo, onOpenPr, onSettings }: Props) {
  const [query, setQuery] = useState('')
  const [repositories, setRepositories] = useState<RepositorySummary[]>()
  const [error, setError] = useState<string>()
  const [recent] = useState(recentRepositories)

  useEffect(() => {
    loadRepositories().then(setRepositories, (e) => setError(errorMessage(e)))
  }, [])

  const target = parseTarget(query)
  const words = query.trim().toLowerCase()
  const matches = (name: string, description = '') => !words || `${name} ${description}`.toLowerCase().includes(words)
  const shownRecent = target ? [] : recent.filter((repo) => matches(repo))
  const shown = target ? [] : (repositories ?? []).filter((repo) => matches(repo.fullName, repo.description))
  // Enter opens what the input names, or the only repository left by the filter.
  const single = shownRecent.length + shown.length === 1 ? (shownRecent[0] ?? shown[0].fullName) : undefined

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (target?.kind === 'pr') onOpenPr(target.url, target.repo)
    else if (target?.kind === 'repo') onOpenRepo(target.repo)
    else if (single) onOpenRepo(single)
  }

  return (
    <div className="home">
      <header className="home-header">
        <h1>
          <span className="logo" /> Yolk
        </h1>
        <button className="link" onClick={onSettings}>
          设置
        </button>
      </header>
      <form className="open-form" onSubmit={submit}>
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索仓库，或输入 owner/repo、仓库链接、PR 链接"
        />
        <button type="submit" disabled={!target && !single}>
          {target?.kind === 'pr' ? '打开 PR' : '打开仓库'}
        </button>
      </form>
      {target && (
        <p className="muted">按回车打开{target.kind === 'pr' ? ' PR ' : '仓库 '}{target.kind === 'pr' ? target.url : target.repo}</p>
      )}
      {shownRecent.length > 0 && (
        <section className="repo-list">
          <h2>最近打开</h2>
          {shownRecent.map((repo) => (
            <button key={repo} className="repo-item" onClick={() => onOpenRepo(repo)}>
              <span className="repo-name">{repo}</span>
            </button>
          ))}
        </section>
      )}
      {!target && (
        <section className="repo-list">
          <h2>
            我的仓库 {repositories && <span className="count">{shown.length}</span>}
          </h2>
          {error && <p className="error">读取仓库列表失败：{error}</p>}
          {!repositories && !error && <p className="muted">正在通过 gh 读取仓库列表…</p>}
          {repositories && shown.length === 0 && <p className="muted">没有匹配的仓库。也可以直接输入 owner/repo 打开其他仓库。</p>}
          {shown.map((repo) => (
            <button key={repo.fullName} className="repo-item" onClick={() => onOpenRepo(repo.fullName)}>
              <span className="repo-name">
                {repo.fullName}
                {repo.private && <span className="tag">私有</span>}
              </span>
              <span className="muted">
                {repo.description && `${repo.description} · `}最近推送 {new Date(repo.pushedAt).toLocaleString('zh-CN')}
              </span>
            </button>
          ))}
        </section>
      )}
    </div>
  )
}
