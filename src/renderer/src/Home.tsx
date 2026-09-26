import { Avatar } from '@astryxdesign/core/Avatar'
import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { Heading } from '@astryxdesign/core/Heading'
import { HStack } from '@astryxdesign/core/HStack'
import { Icon } from '@astryxdesign/core/Icon'
import { Layout, LayoutContent, LayoutHeader } from '@astryxdesign/core/Layout'
import { List, ListItem } from '@astryxdesign/core/List'
import { Skeleton } from '@astryxdesign/core/Skeleton'
import { Text } from '@astryxdesign/core/Text'
import { TextInput } from '@astryxdesign/core/TextInput'
import { Timestamp } from '@astryxdesign/core/Timestamp'
import { Token } from '@astryxdesign/core/Token'
import { VStack } from '@astryxdesign/core/VStack'
import { ArrowRight, GitPullRequest, Search, SearchX } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { RepositorySummary } from '../../core/sources/gh'
import { avatarUrl, errorMessage } from './labels'
import { navigate } from './route'
import { parseTarget } from './target'

// Listed once per app run so going back home is instant; a failed listing is retried next time.
let repositoryList: Promise<RepositorySummary[]> | undefined
const loadRepositories = () =>
  (repositoryList ??= window.yolk.listRepositories().catch((error) => {
    repositoryList = undefined
    throw error
  }))

export function Home() {
  const [query, setQuery] = useState('')
  const [repositories, setRepositories] = useState<RepositorySummary[]>()
  const [error, setError] = useState<string>()
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    setError(undefined)
    loadRepositories().then(setRepositories, (e) => setError(errorMessage(e)))
  }, [attempt])

  const target = parseTarget(query)
  const words = query.trim().toLowerCase()
  const shown = target ? [] : (repositories ?? []).filter((r) => `${r.fullName} ${r.description}`.toLowerCase().includes(words))

  const open = () => {
    if (target?.kind === 'pr') navigate({ page: 'review', repo: target.repo, number: target.number })
    else if (target?.kind === 'repo') navigate({ page: 'repo', repo: target.repo })
    else if (shown.length === 1) navigate({ page: 'repo', repo: shown[0].fullName })
  }

  return (
    <Layout
      padding={6}
      contentWidth={880}
      header={
        <LayoutHeader>
          <VStack gap={3}>
            <VStack gap={1}>
              <Heading level={1}>仓库</Heading>
              <Text type="supporting">选择一个仓库审阅它的 PR，也可以直接粘贴 PR 链接。</Text>
            </VStack>
            <TextInput
              className="home-search"
              label="搜索仓库"
              isLabelHidden
              size="lg"
              startIcon={Search}
              placeholder="搜索仓库，或输入 owner/repo、仓库链接、PR 链接"
              value={query}
              onChange={setQuery}
              onEnter={open}
              hasClear
              hasAutoFocus
            />
          </VStack>
        </LayoutHeader>
      }
      content={
        <LayoutContent>
          <VStack gap={3}>
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
            {!target && !repositories && !error && <ListSkeleton />}
            {!target && repositories && (
              <>
                <Text type="supporting">{words ? `${shown.length} 个匹配的仓库` : `${repositories.length} 个仓库 · 按最近推送排序`}</Text>
                {shown.length === 0 ? (
                  <EmptyState
                    icon={<Icon icon={SearchX} size="lg" />}
                    title="没有匹配的仓库"
                    description="列表里只有你自己的、参与协作的和所在组织的仓库。其他仓库可以直接输入 owner/repo 打开。"
                  />
                ) : (
                  <List hasDividers>
                    {shown.map((repo) => (
                      <ListItem
                        key={repo.fullName}
                        className="repo-item"
                        label={repo.fullName}
                        description={repo.description || undefined}
                        startContent={<Avatar size="sm" shape="rounded" name={repo.fullName.split('/')[0]} src={avatarUrl(repo.fullName.split('/')[0])} tooltip={false} />}
                        endContent={
                          <HStack gap={2}>
                            {repo.private && <Token size="sm" color="gray" label="私有" />}
                            <Timestamp value={repo.pushedAt} format="relative" />
                          </HStack>
                        }
                        onClick={() => navigate({ page: 'repo', repo: repo.fullName })}
                      />
                    ))}
                  </List>
                )}
              </>
            )}
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
