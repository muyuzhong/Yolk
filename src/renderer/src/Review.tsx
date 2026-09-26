import { Button } from '@astryxdesign/core/Button'
import { Center } from '@astryxdesign/core/Center'
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { Heading } from '@astryxdesign/core/Heading'
import { HStack } from '@astryxdesign/core/HStack'
import { Icon } from '@astryxdesign/core/Icon'
import { Kbd } from '@astryxdesign/core/Kbd'
import { Layout, LayoutContent, LayoutHeader, LayoutPanel } from '@astryxdesign/core/Layout'
import { List, ListItem } from '@astryxdesign/core/List'
import { Markdown } from '@astryxdesign/core/Markdown'
import { Spinner } from '@astryxdesign/core/Spinner'
import { Switch } from '@astryxdesign/core/Switch'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'
import { CircleAlert, CircleCheck, FileWarning, ScrollText } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DEFAULT_THRESHOLDS, type Judgment } from '../../core/judgment'
import type { ReviewStart } from '../../shared/api'
import { DiffFile, type Hover } from './DiffFile'
import { errorMessage, LABEL, SHOWN } from './labels'
import { openSettings, useSettingsDialog } from './settingsDialog'
import { navigate, pullRequestUrl } from './route'
import { rememberReview } from './reviewed'
import { blockStates, lineCounts, type Category } from './rows'
import { Tooltip, type Explanation } from './Tooltip'

type Status = { state: 'judging' } | { state: 'done'; model: string; inputTokens: number } | { state: 'error'; message: string }

const isTyping = (target: EventTarget | null) => target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)

export function Review({ repo, number }: { repo: string; number: number }) {
  const url = pullRequestUrl(repo, number)
  const [attempt, setAttempt] = useState(0)
  const [review, setReview] = useState<ReviewStart>()
  const [loadError, setLoadError] = useState<string>()
  const [judgments, setJudgments] = useState<Record<number, Record<string, Judgment>>>({})
  const [unitErrors, setUnitErrors] = useState<Record<number, Record<string, string>>>({})
  const [judgedUnits, setJudgedUnits] = useState(0)
  const [status, setStatus] = useState<Status>({ state: 'judging' })
  const [coreOnly, setCoreOnly] = useState(false)
  const [showPolicy, setShowPolicy] = useState(false)
  const [hover, setHover] = useState<Hover>()
  const [activeFile, setActiveFile] = useState(0)
  const [llmReady, setLlmReady] = useState(false)
  const [explanations, setExplanations] = useState<Record<string, Explanation>>({})
  const reviewIdRef = useRef('')

  const [thresholds, setThresholds] = useState(DEFAULT_THRESHOLDS)
  // Re-read when the settings card closes: new thresholds change ✂ and ? at once, without judging again.
  const settingsOpen = useSettingsDialog().isOpen
  useEffect(() => {
    if (settingsOpen) return
    window.yolk.getSettings().then((settings) => {
      setLlmReady(settings.llm.ready)
      setThresholds(settings.judging.thresholds)
    })
  }, [settingsOpen])

  useEffect(() => {
    const reviewId = crypto.randomUUID()
    reviewIdRef.current = reviewId
    setReview(undefined)
    setLoadError(undefined)
    setJudgments({})
    setUnitErrors({})
    setJudgedUnits(0)
    setStatus({ state: 'judging' })
    const unsubscribe = window.yolk.onReviewProgress((progress) => {
      if (progress.reviewId !== reviewId) return
      if (progress.type === 'unit') {
        setJudgedUnits((n) => n + 1)
        const { fileIndex, unitId, judgments: unitJudgments, error } = progress
        if (unitJudgments) setJudgments((all) => ({ ...all, [fileIndex]: { ...all[fileIndex], ...unitJudgments } }))
        if (error) setUnitErrors((all) => ({ ...all, [fileIndex]: { ...all[fileIndex], [unitId]: error } }))
      } else if (progress.type === 'done') setStatus({ state: 'done', model: progress.model, inputTokens: progress.inputTokens })
      else setStatus({ state: 'error', message: progress.message })
    })
    window.yolk.startReview(url, reviewId).then(setReview, (e) => setLoadError(errorMessage(e)))
    return () => {
      unsubscribe()
      window.yolk.cancelReview(reviewId)
    }
  }, [url, attempt])

  const judgmentError = status.state === 'error' ? status.message : undefined
  const states = useMemo(
    () => review?.files.map((file, i) => blockStates(file, judgments[i] ?? {}, unitErrors[i] ?? {}, judgmentError, thresholds)) ?? [],
    [review, judgments, unitErrors, judgmentError, thresholds],
  )
  const counts = useMemo(() => review?.files.map((file, i) => lineCounts(file, states[i])) ?? [], [review, states])
  const totals = useMemo(() => {
    const sum: Partial<Record<Category, number>> = {}
    for (const c of counts) for (const [category, n] of Object.entries(c) as [Category, number][]) sum[category] = (sum[category] ?? 0) + n
    return sum
  }, [counts])
  // Once Jev has judged everything, remember the split so PR lists can show it next time.
  useEffect(() => {
    if (status.state !== 'done' || !review) return
    rememberReview(url, totals)
  }, [status, review, url, totals])
  // Units with at least one block that goes to Jev (test blocks do not).
  const totalUnits = useMemo(
    () =>
      review?.files.reduce(
        (sum, file) => sum + (file.chunks?.units.filter((u) => u.blocks.some((b) => !file.testBlocks?.includes(b))).length ?? 0),
        0,
      ) ?? 0,
    [review],
  )

  const onHover = useCallback((next: Hover | undefined) => {
    setHover((current) => (current?.file === next?.file && current?.block === next?.block ? current : next))
  }, [])

  // Resting 400ms on a block asks the general model; the main process caches the answers.
  const hoverKey = hover ? `${hover.file}:${hover.block}:${states[hover.file]?.get(hover.block)?.cut ?? false}` : undefined
  useEffect(() => {
    if (!hover || !hoverKey || !llmReady) return
    let active = true
    const timer = setTimeout(() => {
      setExplanations((all) => (all[hoverKey] && all[hoverKey].state !== 'error' ? all : { ...all, [hoverKey]: { state: 'loading' } }))
      window.yolk.explainBlock(reviewIdRef.current, hover.file, hover.block).then(
        (text) => {
          if (active) setExplanations((all) => ({ ...all, [hoverKey]: { state: 'done', text } }))
        },
        (e) => {
          if (active) setExplanations((all) => ({ ...all, [hoverKey]: { state: 'error', text: errorMessage(e) } }))
        },
      )
    }, 400)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [hoverKey, llmReady])

  // C toggles "core only" anywhere on the page except while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'c' && !e.metaKey && !e.ctrlKey && !e.altKey && !isTyping(e.target)) setCoreOnly((v) => !v)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // The file list follows the first file visible in the diff.
  useEffect(() => {
    if (!review) return
    const visible = new Set<number>()
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const index = Number((entry.target as HTMLElement).dataset.index)
        if (entry.isIntersecting) visible.add(index)
        else visible.delete(index)
      }
      if (visible.size) setActiveFile(Math.min(...visible))
    })
    document.querySelectorAll<HTMLElement>('section.file').forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [review])

  if (loadError) {
    return (
      <Center>
        <EmptyState
          icon={<Icon icon={FileWarning} size="lg" />}
          title="打开 PR 失败"
          description={loadError}
          actions={
            <>
              <Button label="返回仓库" onClick={() => navigate({ page: 'repo', repo })} />
              <Button variant="primary" label="重试" onClick={() => setAttempt((n) => n + 1)} />
            </>
          }
        />
      </Center>
    )
  }
  if (!review) {
    return (
      <Center>
        <Spinner size="lg" label="正在读取 PR，切分代码块…" />
      </Center>
    )
  }

  const { pr, files, policy, policySource } = review
  const hovered = hover && files[hover.file]
  return (
    <>
      <Layout
        header={
          <LayoutHeader hasDivider>
            <HStack gap={4} align="center" wrap="wrap" className="review-header">
              <VStack gap={1} className="page-heading">
                <Heading level={1} maxLines={1}>
                  {pr.title}
                </Heading>
                <HStack gap={2} align="center" wrap="wrap">
                  <Text type="supporting" className="review-title">
                    {repo} #{pr.number} · {files.length} 个文件
                  </Text>
                  <JudgeStatus status={status} judged={judgedUnits} total={totalUnits} />
                </HStack>
              </VStack>
              <HStack gap={4} align="center" className="review-toolbar">
                <HStack gap={3} align="center" className="legend">
                  {SHOWN.map((c) => (
                    <Text key={c} type="supporting" className={`legend-item cat-${c}`}>
                      {LABEL[c]} <Text color="inherit" className="legend-count">{totals[c] ?? 0}</Text>
                    </Text>
                  ))}
                </HStack>
                <HStack gap={1} align="center" className="toggle">
                  <Switch size="sm" label="只看核心" value={coreOnly} onChange={setCoreOnly} />
                  <Kbd keys="c" />
                </HStack>
                <Button size="sm" variant="ghost" label="审阅约定" icon={<Icon icon={ScrollText} size="sm" />} onClick={() => setShowPolicy(true)} />
              </HStack>
            </HStack>
          </LayoutHeader>
        }
        start={
          <LayoutPanel width={300} hasDivider label="文件" padding={2}>
            <VStack gap={4}>
              {[
                { key: 'judged', indexes: files.flatMap((f, i) => (f.skipped ? [] : [i])), header: undefined },
                { key: 'skipped', indexes: files.flatMap((f, i) => (f.skipped ? [i] : [])), header: '只显示 diff' },
              ].map(
                ({ key, indexes, header }) =>
                  indexes.length > 0 && (
                    <List
                      key={key}
                      density="compact"
                      className="file-list"
                      header={
                        header && (
                          <Text type="supporting" weight="medium" className="file-list-header">
                            {header}
                          </Text>
                        )
                      }
                    >
                      {indexes.map((i) => {
                        const file = files[i]
                        const name = file.diff.path.split('/').pop()!
                        const dir = file.diff.path.slice(0, -name.length)
                        // The group says "diff only"; name the reason only when it is not the usual unsupported language.
                        const reason = file.skipped && file.skipped !== '暂不支持的语言' ? file.skipped : ''
                        return (
                          <ListItem
                            key={file.diff.path}
                            className={`file-list-item${file.skipped ? ' is-skipped' : ''}`}
                            label={name}
                            description={[dir, reason].filter(Boolean).join(' · ') || undefined}
                            isSelected={i === activeFile}
                            endContent={!file.skipped && <FileCounts counts={counts[i]} />}
                            onClick={(e) => {
                              document.getElementById(`file-${i}`)?.scrollIntoView({ block: 'start' })
                              // A mouse click should not leave a focus ring behind; keyboard focus keeps it.
                              if (e.detail > 0) (e.currentTarget as HTMLElement).blur()
                            }}
                          />
                        )
                      })}
                    </List>
                  ),
              )}
            </VStack>
          </LayoutPanel>
        }
        content={
          <LayoutContent padding={0}>
            <div className="files" onMouseLeave={() => onHover(undefined)}>
              {files.map((file, i) => (
                <DiffFile
                  key={file.diff.path}
                  index={i}
                  file={file}
                  states={states[i]}
                  counts={counts[i]}
                  unitErrors={unitErrors[i]}
                  coreOnly={coreOnly}
                  hoveredBlock={hover?.file === i ? hover.block : undefined}
                  onHover={onHover}
                />
              ))}
            </div>
          </LayoutContent>
        }
      />
      {hover && hovered && (
        <Tooltip
          hover={hover}
          file={hovered}
          state={states[hover.file].get(hover.block)}
          judgment={judgments[hover.file]?.[hover.block]}
          error={unitErrors[hover.file]?.[states[hover.file].get(hover.block)?.unit ?? ''] ?? judgmentError}
          llmReady={llmReady}
          explanation={hoverKey ? explanations[hoverKey] : undefined}
        />
      )}
      <Dialog isOpen={showPolicy} onOpenChange={setShowPolicy} width={640}>
        <DialogHeader
          title="审阅约定"
          subtitle={policySource === 'repo' ? `${repo} 的约定` : policySource === 'default' ? '默认约定（这个仓库没有单独的约定）' : '还没有约定'}
          onOpenChange={setShowPolicy}
        />
        <div className="policy">
          {policy ? (
            <VStack gap={4}>
              <Markdown density="compact">{policy}</Markdown>
              <HStack gap={2}>
                <Button size="sm" label={policySource === 'repo' ? '编辑约定' : '给这个仓库单独写一份'} onClick={() => openSettings(repo)} />
                <Text type="supporting">改动在下次打开这个 PR 时生效。</Text>
              </HStack>
            </VStack>
          ) : (
            <EmptyState
              isCompact
              icon={<Icon icon={ScrollText} size="lg" />}
              title="还没有审阅约定"
              description="写下项目现阶段不需要哪些代码，例如「MVP 阶段不需要重试和降级」，Jev 会据此标出建议删除（✂）的块。"
              actions={<Button size="sm" label="写一份约定" onClick={() => openSettings(repo)} />}
            />
          )}
        </div>
      </Dialog>
    </>
  )
}

function JudgeStatus({ status, judged, total }: { status: Status; judged: number; total: number }) {
  if (status.state === 'error') {
    return (
      <HStack gap={1} align="center" className="status">
        <Icon icon={CircleAlert} size="xsm" color="error" />
        <Text type="supporting" color="inherit" maxLines={1} className="status-error">
          判断失败：{status.message}
        </Text>
      </HStack>
    )
  }
  if (status.state === 'done') {
    return (
      <HStack gap={1} align="center" className="status">
        <Text type="supporting">·</Text>
        <Icon icon={CircleCheck} size="xsm" color="success" />
        <Text type="supporting">
          判断完成 · {status.model || 'jev'} · {(status.inputTokens / 1000).toFixed(1)}k token
        </Text>
      </HStack>
    )
  }
  return (
    <HStack gap={1} align="center" className="status">
      <Text type="supporting">·</Text>
      <Spinner size="sm" />
      <Text type="supporting" className="status-count">
        Jev 判断中 {judged}/{total}
      </Text>
    </HStack>
  )
}

function FileCounts({ counts }: { counts: Partial<Record<Category, number>> }) {
  return (
    <HStack gap={2} align="center" className="file-counts">
      {SHOWN.filter((c) => counts[c]).map((c) => (
        <Text key={c} type="supporting" className={`legend-item cat-${c}`}>
          {counts[c]}
        </Text>
      ))}
    </HStack>
  )
}
