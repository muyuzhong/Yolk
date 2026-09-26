import { useEffect, useState, type FormEvent } from 'react'
import type { PullRequestSummary } from '../../core/sources/gh'
import type { PullRequestLists } from '../../shared/api'
import { errorMessage } from './labels'

export function Home({ onOpen, onSettings }: { onOpen: (url: string) => void; onSettings: () => void }) {
  const [url, setUrl] = useState('')
  const [lists, setLists] = useState<PullRequestLists>()
  const [error, setError] = useState<string>()

  useEffect(() => {
    window.yolk.listPullRequests().then(setLists, (e) => setError(errorMessage(e)))
  }, [])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (url.trim()) onOpen(url.trim())
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
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="粘贴 PR 链接，例如 https://github.com/owner/repo/pull/123" />
        <button type="submit" disabled={!url.trim()}>
          打开
        </button>
      </form>
      {error && <p className="error">读取 PR 列表失败：{error}</p>}
      {!lists && !error && <p className="muted">正在通过 gh 读取 PR 列表…</p>}
      {lists && (
        <>
          <PullRequestList title="待我审阅" prs={lists.reviewRequested} onOpen={onOpen} />
          <PullRequestList title="我创建的" prs={lists.authored} onOpen={onOpen} />
        </>
      )}
    </div>
  )
}

function PullRequestList({ title, prs, onOpen }: { title: string; prs: PullRequestSummary[]; onOpen: (url: string) => void }) {
  return (
    <section className="pr-list">
      <h2>
        {title} <span className="count">{prs.length}</span>
      </h2>
      {prs.length === 0 && <p className="muted">没有打开的 PR</p>}
      {prs.map((pr) => (
        <button key={pr.url} className="pr-item" onClick={() => onOpen(pr.url)}>
          <span className="pr-title">{pr.title}</span>
          <span className="muted">
            {pr.repository} #{pr.number} · {pr.author} · {new Date(pr.updatedAt).toLocaleString('zh-CN')}
          </span>
        </button>
      ))}
    </section>
  )
}
