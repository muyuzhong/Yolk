import { Avatar } from '@astryxdesign/core/Avatar'
import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { Heading } from '@astryxdesign/core/Heading'
import { HStack } from '@astryxdesign/core/HStack'
import { Icon } from '@astryxdesign/core/Icon'
import { IconButton } from '@astryxdesign/core/IconButton'
import { Layout, LayoutContent, LayoutHeader } from '@astryxdesign/core/Layout'
import { List, ListItem } from '@astryxdesign/core/List'
import { Tab, TabList } from '@astryxdesign/core/TabList'
import { Text } from '@astryxdesign/core/Text'
import { TextInput } from '@astryxdesign/core/TextInput'
import { Timestamp } from '@astryxdesign/core/Timestamp'
import { Token } from '@astryxdesign/core/Token'
import { VStack } from '@astryxdesign/core/VStack'
import { Filter, GitPullRequest, RotateCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { PullRequestState, PullRequestSummary } from '../../core/sources/gh'
import type { PullRequestList } from '../../shared/api'
import { ListSkeleton } from './Home'
import { avatarUrl, errorMessage } from './labels'
import { navigate } from './route'

const STATES: [PullRequestState, string][] = [
  ['open', '打开的'],
  ['merged', '已合并'],
  ['closed', '已关闭'],
  ['all', '全部'],
]
const EMPTY: Record<PullRequestState, string> = { open: '没有打开的 PR', merged: '没有已合并的 PR', closed: '没有已关闭的 PR', all: '还没有 PR' }

type TokenColor = 'default' | 'gray' | 'yellow' | 'green' | 'red' | 'purple'

/** Status tags in reading order: lifecycle first, then what it means for the viewer. */
function tags(pr: PullRequestSummary, login: string): [string, TokenColor][] {
  const list: [string, TokenColor][] = []
  if (pr.state === 'MERGED') list.push(['已合并', 'purple'])
  if (pr.state === 'CLOSED') list.push(['已关闭', 'gray'])
  if (pr.draft) list.push(['草稿', 'gray'])
  if (pr.requestedReviewers.includes(login)) list.push(['请你审阅', 'yellow'])
  if (pr.reviewDecision === 'APPROVED') list.push(['已批准', 'green'])
  if (pr.reviewDecision === 'CHANGES_REQUESTED') list.push(['需修改', 'red'])
  return list
}

export function Repository({ repo }: { repo: string }) {
  const [state, setState] = useState<PullRequestState>('open')
  const [list, setList] = useState<PullRequestList>()
  const [error, setError] = useState<string>()
  const [filter, setFilter] = useState('')
  const [attempt, setAttempt] = useState(0)

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
  const shown = (list?.pullRequests ?? []).filter((pr) => `#${pr.number} ${pr.title} ${pr.author}`.toLowerCase().includes(words))

  return (
    <Layout
      padding={6}
      contentWidth={960}
      header={
        <LayoutHeader>
          <VStack gap={3}>
            <HStack gap={2}>
              <VStack gap={1}>
                <Heading level={1}>{repo}</Heading>
                <Text type="supporting">选择一个 PR 开始审阅</Text>
              </VStack>
              <span className="spacer" />
              <IconButton variant="ghost" label="刷新" tooltip="刷新" icon={<Icon icon={RotateCw} size="sm" />} onClick={() => setAttempt((n) => n + 1)} />
            </HStack>
            <HStack gap={3}>
              <TabList className="state-tabs" value={state} onChange={(value) => setState(value as PullRequestState)}>
                {STATES.map(([value, label]) => (
                  <Tab key={value} value={value} label={label} />
                ))}
              </TabList>
              <span className="spacer" />
              <TextInput
                label="筛选 PR"
                isLabelHidden
                size="sm"
                width={260}
                startIcon={Filter}
                placeholder="筛选标题、作者或编号"
                value={filter}
                onChange={setFilter}
                hasClear
              />
            </HStack>
          </VStack>
        </LayoutHeader>
      }
      content={
        <LayoutContent>
          <VStack gap={3}>
            {error && <Banner status="error" title="读取 PR 列表失败" description={error} endContent={<Button label="重试" onClick={() => setAttempt((n) => n + 1)} />} />}
            {!list && !error && <ListSkeleton />}
            {list && (
              <>
                <Text type="supporting" className="pr-count">
                  {words ? `${shown.length} 个匹配的 PR` : list.pullRequests.length === 100 ? '最近 100 个' : `${list.pullRequests.length} 个`}
                </Text>
                {shown.length === 0 ? (
                  <EmptyState icon={<Icon icon={GitPullRequest} size="lg" />} title={words ? '没有匹配的 PR' : EMPTY[state]} description={words ? '换个关键词试试。' : undefined} />
                ) : (
                  <List hasDividers>
                    {shown.map((pr) => (
                      <ListItem
                        key={pr.url}
                        className="pr-item"
                        data-number={pr.number}
                        label={pr.title}
                        description={
                          <HStack gap={1}>
                            <span>
                              #{pr.number} · {pr.author} · 更新于
                            </span>
                            <Timestamp value={pr.updatedAt} format="relative" />
                          </HStack>
                        }
                        startContent={<Avatar size="sm" name={pr.author} src={avatarUrl(pr.author)} tooltip={false} />}
                        endContent={
                          <HStack gap={2}>
                            {tags(pr, list.login).map(([label, color]) => (
                              <Token key={label} size="sm" color={color} label={label} />
                            ))}
                            <span className="diffstat">
                              <span className="additions">+{pr.additions}</span> <span className="deletions">−{pr.deletions}</span>
                            </span>
                          </HStack>
                        }
                        onClick={() => navigate({ page: 'review', repo, number: pr.number })}
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
