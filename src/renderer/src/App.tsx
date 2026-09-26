import { useState } from 'react'
import { Home } from './Home'
import { Review } from './Review'
import { Settings } from './Settings'

type Page = { name: 'home' } | { name: 'review'; url: string } | { name: 'settings' }

export function App() {
  const [page, setPage] = useState<Page>({ name: 'home' })
  const home = () => setPage({ name: 'home' })
  if (page.name === 'review') return <Review key={page.url} url={page.url} onBack={home} />
  if (page.name === 'settings') return <Settings onBack={home} />
  return <Home onOpen={(url) => setPage({ name: 'review', url })} onSettings={() => setPage({ name: 'settings' })} />
}
