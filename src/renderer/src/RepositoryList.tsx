import { Avatar } from '@astryxdesign/core/Avatar'
import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { ClickableCard } from '@astryxdesign/core/ClickableCard'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { Grid } from '@astryxdesign/core/Grid'
import { Heading } from '@astryxdesign/core/Heading'
import { HStack } from '@astryxdesign/core/HStack'
import { Icon } from '@astryxdesign/core/Icon'
import { Layout, LayoutContent, LayoutHeader } from '@astryxdesign/core/Layout'
import { List, ListItem } from '@astryxdesign/core/List'
import { Skeleton } from '@astryxdesign/core/Skeleton'
import { Text } from '@astryxdesign/core/Text'
import { Timestamp } from '@astryxdesign/core/Timestamp'
import { Token } from '@astryxdesign/core/Token'
import { VStack } from '@astryxdesign/core/VStack'
import { ArrowRight, ChevronRight, GitPullRequest, History, Pin, SearchX } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { RepositorySummary } from '../../core/sources/gh'
import { DitherBackdrop } from './DitherBackdrop'
import { FilterField } from './FilterField'
import { avatarUrl, errorMessage } from './labels'
import { useRepositoryShortcuts } from './recent'
import { navigate } from './route'
import { parseTarget } from './target'

// Listed once per app run so going back home is instant; a failed listing is retried next time.
let repositoryList: Promise<RepositorySummary[]> | undefined
export const loadRepositories = () =>
  (repositoryList ??= window.yolk.listRepositories().catch((error) => {
    repositoryList = undefined
    throw error
  }))

const DAY_MS = 24 * 60 * 60 * 1000
/** Activity buckets for the full list, by days since the last push. */
const GROUPS: [label: string, maxDays: number][] = [
  ['本周活跃', 7],
  ['本月', 30],
  ['更早', Infinity],
]
const QUICK_ACCESS = 4

const ownerOf = (repo: string) => repo.split('/').slice(0, -1).join('/')
const nameOf = (repo: string) => repo.split('/').at(-1)!

export function RepositoryList() {
  const [query, setQuery] = useState('')
  const [repositories, setRepositories] = useState<RepositorySummary[]>()
  const [error, setError] = useState<string>()
  const [attempt, setAttempt] = useState(0)
  const { pinned, recent } = useRepositoryShortcuts()

  useEffect(() => {
    setError(undefined)
    loadRepositories().then(setRepositories, (e) => setError(errorMessage(e)))
  }, [attempt])

  const target = parseTarget(query)
  const words = query.trim().toLowerCase()
  const shown = target ? [] : (repositories ?? []).filter((r) => `${r.fullName} ${r.description}`.toLowerCase().includes(words))
  const byName = new Map((repositories ?? []).map((r) => [r.fullName, r]))
  const quick = [...pinned.map((repo) => ({ repo, isPinned: true })), ...recent.map((repo) => ({ repo, isPinned: false }))].slice(0, QUICK_ACCESS)
  const now = Date.now()
  const groups = GROUPS.map(([label, maxDays], i) => ({
    label,
    repos: shown.filter((r) => {
      const days = (now - Date.parse(r.pushedAt)) / DAY_MS
      return days <= maxDays && (i === 0 || days > GROUPS[i - 1][1])
    }),
  })).filter((g) => g.repos.length)

  const open = () => {
    if (target?.kind === 'pr') navigate({ page: 'review', repo: target.repo, number: target.number })
    else if (target?.kind === 'repo') navigate({ page: 'repo', repo: target.repo })
    else if (shown.length === 1) navigate({ page: 'repo', repo: shown[0].fullName })
  }

  return (
    <Layout
      className="list-page"
      padding={6}
      contentWidth={880}
      header={
        <LayoutHeader>
          <DitherBackdrop className="list-page-backdrop" />
          <DitherBackdrop className="list-page-backdrop-bottom" rotation={180} />
          <HStack gap={4} align="end" wrap="wrap">
            <VStack gap={1} className="page-heading">
              <Heading level={1}>全部仓库</Heading>
              <Text type="supporting" className="page-meta">
                {repositories ? (words && !target ? `${shown.length} / ${repositories.length} 个仓库` : `${repositories.length} 个仓库`) : '读取中…'}
              </Text>
            </VStack>
            <FilterField label="筛选仓库" placeholder="筛选仓库" value={query} onChange={setQuery} onEnter={open} />
          </HStack>
        </LayoutHeader>
      }
      content={
        <LayoutContent>
          <VStack gap={6}>
            {target && (
              <List hasDividers>
                <ListItem
                  className="open-target"
                  label={target.kind === 'pr' ? `打开 PR #${target.number}` : `打开仓库 ${target.repo}`}
                  description={target.kind === 'pr' ? target.repo : '按 Enter 打开'}
                  startContent={<Icon icon={target.kind === 'pr' ? GitPullRequest : ArrowRight} color="accent" />}
                  onClick={open}
                />
              </List>
            )}
            {!target && error && (
              <Banner status="error" title="读取仓库列表失败" description={error} endContent={<Button label="重试" onClick={() => setAttempt((n) => n + 1)} />} />
            )}
            {!target && !words && quick.length > 0 && (
              <VStack gap={2}>
                <Text type="supporting" weight="medium">
                  快速访问
                </Text>
                <Grid columns={{ minWidth: 180, repeat: 'fill' }} gap={3}>
                  {quick.map(({ repo, isPinned }) => {
                    const pushedAt = byName.get(repo)?.pushedAt
                    return (
                      <ClickableCard key={repo} label={`打开 ${repo}`} padding={3} elevation="low" onClick={() => navigate({ page: 'repo', repo })}>
                        <VStack gap={3}>
                          <HStack gap={2} align="center">
                            <Avatar size="sm" shape="rounded" name={ownerOf(repo)} src={avatarUrl(ownerOf(repo))} tooltip={false} />
                            <VStack gap={0} className="page-heading">
                              <Text weight="semibold" maxLines={1}>
                                {nameOf(repo)}
                              </Text>
                              <Text type="supporting" maxLines={1}>
                                {ownerOf(repo)}
                              </Text>
                            </VStack>
                          </HStack>
                          <HStack gap={1} align="center">
                            <Icon icon={isPinned ? Pin : History} size="xsm" color="secondary" />
                            <Text type="supporting" className="page-meta">
                              {isPinned ? '已固定' : '最近打开'}
                              {pushedAt && (
                                <>
                                  {' · '}
                                  <Timestamp value={pushedAt} format="relative" />
                                </>
                              )}
                            </Text>
                          </HStack>
                        </VStack>
                      </ClickableCard>
                    )
                  })}
                </Grid>
              </VStack>
            )}
            {!target && !repositories && !error && <ListSkeleton />}
            {!target && repositories && shown.length === 0 && (
              <EmptyState
                icon={<Icon icon={SearchX} size="lg" />}
                title="没有匹配的仓库"
                description="列表里只有你自己的、参与协作的和所在组织的仓库。其他仓库可以直接输入 owner/repo 打开。"
              />
            )}
            {!target &&
              groups.map((group) => (
                <List
                  key={group.label}
                  hasDividers
                  header={
                    <HStack gap={2} align="center">
                      <Text type="supporting" weight="medium">
                        {group.label}
                      </Text>
                      <Text type="supporting" className="page-meta">
                        {group.repos.length}
                      </Text>
                    </HStack>
                  }
                >
                  {group.repos.map((repo) => (
                    <ListItem
                      key={repo.fullName}
                      className="repo-item"
                      label={nameOf(repo.fullName)}
                      description={[ownerOf(repo.fullName), repo.description].filter(Boolean).join(' · ')}
                      startContent={<Avatar size="md" shape="rounded" name={ownerOf(repo.fullName)} src={avatarUrl(ownerOf(repo.fullName))} tooltip={false} />}
                      endContent={
                        <HStack gap={3} align="center">
                          {repo.private && <Token size="sm" color="gray" label="私有" />}
                          <Text type="supporting" className="page-meta">
                            <Timestamp value={repo.pushedAt} format="relative" />
                          </Text>
                          <Icon icon={ChevronRight} size="sm" />
                        </HStack>
                      }
                      onClick={() => navigate({ page: 'repo', repo: repo.fullName })}
                    />
                  ))}
                </List>
              ))}
          </VStack>
        </LayoutContent>
      }
    />
  )
}

export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <VStack gap={2}>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} index={i} height={48} />
      ))}
    </VStack>
  )
}
