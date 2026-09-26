import { Avatar } from '@astryxdesign/core/Avatar'
import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { Center } from '@astryxdesign/core/Center'
import { ClickableCard } from '@astryxdesign/core/ClickableCard'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { Grid } from '@astryxdesign/core/Grid'
import { Heading } from '@astryxdesign/core/Heading'
import { HStack } from '@astryxdesign/core/HStack'
import { Icon } from '@astryxdesign/core/Icon'
import { IconButton } from '@astryxdesign/core/IconButton'
import { Layout, LayoutContent, LayoutHeader } from '@astryxdesign/core/Layout'
import { List, ListItem } from '@astryxdesign/core/List'
import { Tab, TabList } from '@astryxdesign/core/TabList'
import { Text } from '@astryxdesign/core/Text'
import { Timestamp } from '@astryxdesign/core/Timestamp'
import { Token } from '@astryxdesign/core/Token'
import { VStack } from '@astryxdesign/core/VStack'
import { GitMerge, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft, RotateCw, ScanEye, ScrollText } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { PullRequestState, PullRequestSummary } from '../../core/sources/gh'
import type { Conventions, PullRequestList } from '../../shared/api'
import { DiffStat } from './DiffStat'
import { DitherBackdrop } from './DitherBackdrop'
import { FilterField } from './FilterField'
import { ListSkeleton } from './RepositoryList'
import { avatarUrl, errorMessage } from './labels'
import { useReviewedPullRequests } from './reviewed'
import { navigate } from './route'

const STATES: [PullRequestState, string][] = [
  ['open', '打开的'],
  ['merged', '已合并'],
  ['closed', '已关闭'],
  ['all', '全部'],
]
const EMPTY: Record<PullRequestState, string> = { open: '没有打开的 PR', merged: '没有已合并的 PR', closed: '没有已关闭的 PR', all: '还没有 PR' }

type TokenColor = 'default' | 'gray' | 'yellow' | 'green' | 'red' | 'purple'

/** What a PR means for the viewer; its lifecycle (open, draft, merged, closed) is the status icon's job. */
function tags(pr: PullRequestSummary, login: string): [string, TokenColor][] {
  const list: [string, TokenColor][] = []
  if (pr.requestedReviewers.includes(login)) list.push(['请你审阅', 'yellow'])
  if (pr.reviewDecision === 'APPROVED') list.push(['已批准', 'green'])
  if (pr.reviewDecision === 'CHANGES_REQUESTED') list.push(['需修改', 'red'])
  return list
}

const STATUS = {
  open: { icon: GitPullRequest, label: '打开' },
  draft: { icon: GitPullRequestDraft, label: '草稿' },
  merged: { icon: GitMerge, label: '已合并' },
  closed: { icon: GitPullRequestClosed, label: '已关闭' },
}
const statusOf = (pr: PullRequestSummary): keyof typeof STATUS =>
  pr.state === 'MERGED' ? 'merged' : pr.state === 'CLOSED' ? 'closed' : pr.draft ? 'draft' : 'open'

function StatusIcon({ pr }: { pr: PullRequestSummary }) {
  const status = statusOf(pr)
  return (
    <Center isInline className={`pr-status is-${status}`} aria-label={STATUS[status].label}>
      <Icon icon={STATUS[status].icon} size="sm" />
    </Center>
  )
}

/** The header's one-line summary of the list in the current tab. */
function summary(state: PullRequestState, prs: PullRequestSummary[], login: string): string {
  const capped = prs.length === 100 ? '最近 100 个' : `${prs.length} 个`
  if (state !== 'open') return `${capped}${state === 'merged' ? '已合并' : state === 'closed' ? '已关闭' : ' PR'}`
  const drafts = prs.filter((pr) => pr.draft).length
  const waiting = prs.filter((pr) => pr.requestedReviewers.includes(login)).length
  return [`${capped}打开`, drafts && `${drafts} 个草稿`, waiting && `${waiting} 个等你审阅`].filter(Boolean).join(' · ')
}

export function Repository({ repo }: { repo: string }) {
  const [state, setState] = useState<PullRequestState>('open')
  const [list, setList] = useState<PullRequestList>()
  const [error, setError] = useState<string>()
  const [filter, setFilter] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [conventions, setConventions] = useState<Conventions>()

  useEffect(() => {
    window.yolk.getSettings().then((settings) => setConventions(settings.conventions))
  }, [])

  useEffect(() => {
    let active = true
    setList(undefined)
    setError(undefined)
    window.yolk.listPullRequests(repo, state).then(
      (result) => active && setList(result),
      (e) => active && setError(errorMessage(e)),
    )
    return () => {
      active = false
    }
  }, [repo, state, attempt])

  const words = filter.trim().toLowerCase()
  const reviewed = useReviewedPullRequests()
  const login = list?.login ?? ''
  const matching = (list?.pullRequests ?? []).filter((pr) => `#${pr.number} ${pr.title} ${pr.author}`.toLowerCase().includes(words))
  // Review requests get their own shelf, unless the user is searching: then everything stays in one list.
  const waiting = words ? [] : matching.filter((pr) => pr.state === 'OPEN' && pr.requestedReviewers.includes(login))
  const rest = matching.filter((pr) => !waiting.includes(pr))
  const open = (pr: PullRequestSummary) => navigate({ page: 'review', repo, number: pr.number })

  return (
    <Layout
      className="list-page"
      padding={6}
      contentWidth={960}
      header={
        <LayoutHeader>
          <DitherBackdrop className="list-page-backdrop" />
          <DitherBackdrop className="list-page-backdrop-bottom" rotation={180} />
          <VStack gap={4}>
            <HStack gap={2} align="start">
              <VStack gap={1} className="page-heading">
                <Heading level={1}>{repo}</Heading>
                <Text type="supporting" className="page-meta">
                  {!list ? '读取中…' : words ? `${matching.length} / ${list.pullRequests.length} 个匹配` : summary(state, list.pullRequests, login)}
                </Text>
              </VStack>
              {conventions && (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Icon icon={ScrollText} size="sm" />}
                  label={conventions.repos[repo] ? '审阅约定 · 本仓库' : conventions.default ? '审阅约定 · 默认' : '审阅约定 · 未设置'}
                  tooltip="Jev 按这份约定标出建议删除（✂）的代码"
                  onClick={() => navigate({ page: 'settings', repo })}
                />
              )}
              <IconButton variant="ghost" label="刷新" tooltip="刷新" icon={<Icon icon={RotateCw} size="sm" />} onClick={() => setAttempt((n) => n + 1)} />
            </HStack>
            <HStack gap={3} align="center" wrap="wrap">
              <TabList className="state-tabs page-heading" value={state} onChange={(value) => setState(value as PullRequestState)}>
                {STATES.map(([value, label]) => (
                  <Tab key={value} value={value} label={label} />
                ))}
              </TabList>
              <FilterField label="筛选 PR" placeholder="筛选标题、作者或编号" value={filter} onChange={setFilter} />
            </HStack>
          </VStack>
        </LayoutHeader>
      }
      content={
        <LayoutContent>
          <VStack gap={6}>
            {error && <Banner status="error" title="读取 PR 列表失败" description={error} endContent={<Button label="重试" onClick={() => setAttempt((n) => n + 1)} />} />}
            {!list && !error && <ListSkeleton />}
            {waiting.length > 0 && (
              <VStack gap={2}>
                <HStack gap={2} align="center">
                  <Text type="supporting" weight="medium">
                    等你审阅
                  </Text>
                  <Text type="supporting" className="page-meta">
                    {waiting.length}
                  </Text>
                </HStack>
                <Grid columns={{ minWidth: 380, repeat: 'fill' }} gap={3}>
                  {waiting.map((pr) => (
                    <ClickableCard key={pr.url} className="pr-card" data-number={pr.number} label={`审阅 #${pr.number} ${pr.title}`} padding={4} elevation="low" onClick={() => open(pr)}>
                      <VStack gap={3}>
                        <HStack gap={2} align="start">
                          <StatusIcon pr={pr} />
                          <Text weight="semibold" maxLines={2} className="page-heading">
                            {pr.title}
                          </Text>
                        </HStack>
                        <HStack gap={2} align="center" wrap="wrap">
                          <Avatar size="xsm" name={pr.author} src={avatarUrl(pr.author)} tooltip={false} />
                          <Text type="supporting" className="page-heading" maxLines={1}>
                            #{pr.number} · {pr.author} · <Timestamp value={pr.updatedAt} format="relative" />
                          </Text>
                          <DiffStat additions={pr.additions} deletions={pr.deletions} />
                        </HStack>
                      </VStack>
                    </ClickableCard>
                  ))}
                </Grid>
              </VStack>
            )}
            {list && matching.length === 0 && (
              <EmptyState icon={<Icon icon={GitPullRequest} size="lg" />} title={words ? '没有匹配的 PR' : EMPTY[state]} description={words ? '换个关键词试试。' : undefined} />
            )}
            {list && rest.length > 0 && (
              <List
                hasDividers
                header={
                  waiting.length > 0 && (
                    <HStack gap={2} align="center">
                      <Text type="supporting" weight="medium">
                        其他 PR
                      </Text>
                      <Text type="supporting" className="page-meta">
                        {rest.length}
                      </Text>
                    </HStack>
                  )
                }
              >
                {rest.map((pr) => {
                  const lastReview = reviewed[pr.url]
                  return (
                    <ListItem
                      key={pr.url}
                      className="pr-item"
                      data-number={pr.number}
                      label={pr.title}
                      description={
                        <HStack gap={1} align="center">
                          <Avatar size="xsm" name={pr.author} src={avatarUrl(pr.author)} tooltip={false} />
                          <Text type="supporting">
                            #{pr.number} · {pr.author} · 更新于 <Timestamp value={pr.updatedAt} format="relative" />
                          </Text>
                        </HStack>
                      }
                      startContent={<StatusIcon pr={pr} />}
                      endContent={
                        <HStack gap={3} align="center">
                          {lastReview && (
                            <Text type="supporting" className="pr-reviewed" maxLines={1}>
                              <Icon icon={ScanEye} size="xsm" color="inherit" /> 核心 {lastReview.core} 行
                            </Text>
                          )}
                          {tags(pr, login).map(([label, color]) => (
                            <Token key={label} size="sm" color={color} label={label} />
                          ))}
                          <DiffStat additions={pr.additions} deletions={pr.deletions} />
                        </HStack>
                      }
                      onClick={() => open(pr)}
                    />
                  )
                })}
              </List>
            )}
          </VStack>
        </LayoutContent>
      }
    />
  )
}
