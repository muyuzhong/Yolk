import { useState } from 'react'
import { Home } from './Home'
import { rememberRepository } from './recent'
import { Repository } from './Repository'
import { Review } from './Review'
import { Settings } from './Settings'

type Page =
  | { name: 'home' }
  | { name: 'repo'; repo: string }
  | { name: 'review'; url: string; repo: string }
  | { name: 'settings' }

export function App() {
  const [page, setPage] = useState<Page>({ name: 'home' })
  const home = () => setPage({ name: 'home' })
  const openRepo = (repo: string) => {
    rememberRepository(repo)
    setPage({ name: 'repo', repo })
  }
  const openPr = (url: string, repo: string) => {
    rememberRepository(repo)
    setPage({ name: 'review', url, repo })
  }

  if (page.name === 'review') return <Review key={page.url} url={page.url} onBack={() => setPage({ name: 'repo', repo: page.repo })} />
  if (page.name === 'repo') return <Repository key={page.repo} repo={page.repo} onOpenPr={(url) => openPr(url, page.repo)} onBack={home} />
  if (page.name === 'settings') return <Settings onBack={home} />
  return <Home onOpenRepo={openRepo} onOpenPr={openPr} onSettings={() => setPage({ name: 'settings' })} />
}
