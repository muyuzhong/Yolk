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
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DEFAULT_THRESHOLDS, type Judgment } from '../../core/judgment'
import type { ReviewStart } from '../../shared/api'
import { DiffFile, type Hover } from './DiffFile'
import { markLines, readSelection, SelectionExplain, type DiffSelection } from './SelectionExplain'
import { errorMessage, LABEL, SHOWN } from './labels'
import { openSettings, useSettingsDialog } from './settingsDialog'
import { navigate, pullRequestUrl } from './route'
import { rememberReview } from './reviewed'
import { blockStates, lineCounts, type Category } from './rows'
import { Tooltip, type Explanation } from './Tooltip'

type Status = { state: 'judging' } | { state: 'done'; model: string; inputTokens: number; cachedUnits?: number } | { state: 'error'; message: string }

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
      } else if (progress.type === 'done') setStatus({ state: 'done', model: progress.model, inputTokens: progress.inputTokens, cachedUnits: progress.cachedUnits })
      else setStatus({ state: 'error', message: progress.message })
    })
    window.yolk.startReview(url, reviewId).then(setReview, (e) => setLoadError(errorMessage(e)))
    return () => {
      unsubscribe()
      window.yolk.cancelReview(reviewId)
    }
  }, [url, attempt])

  const judgmentError = status.state === 'error' ? status.message : undefined
  // Per file, recompute only when that file's inputs change: judgments arrive one unit at a time, and handing every
  // file a fresh Map would re-render every diff line of the PR on each one.
  const stateCache = useRef<{ inputs: unknown[]; states: ReturnType<typeof blockStates>; counts: ReturnType<typeof lineCounts> }[]>([])
  const perFile = useMemo(
    () =>
      review?.files.map((file, i) => {
        const inputs = [file, judgments[i], unitErrors[i], judgmentError, thresholds]
        const cached = stateCache.current[i]
        if (cached && cached.inputs.every((input, k) => input === inputs[k])) return cached
        const states = blockStates(file, judgments[i] ?? {}, unitErrors[i] ?? {}, judgmentError, thresholds)
        return (stateCache.current[i] = { inputs, states, counts: lineCounts(file, states) })
      }) ?? [],
    [review, judgments, unitErrors, judgmentError, thresholds],
  )
  const states = useMemo(() => perFile.map((f) => f.states), [perFile])
  const counts = useMemo(() => perFile.map((f) => f.counts), [perFile])
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

  const openPolicy = useCallback(() => setShowPolicy(true), [])
  const onHover = useCallback((next: Hover | undefined) => {
    setHover((current) => (current?.file === next?.file && current?.block === next?.block ? current : next))
  }, [])

  // Explanations are per judgment unit (a function, or top-level changes) and only asked for on request: E or a click
  // on the code. Hovering any block of the unit shows the same answer; the main process caches them too.
  const hoverUnit = hover ? states[hover.file]?.get(hover.block)?.unit : undefined
  const unitKey = hover && hoverUnit ? `${hover.file}:${hoverUnit}` : undefined
  const requestExplanation = useCallback(() => {
    if (!hover || !hoverUnit || !unitKey || !llmReady) return
    const current = explanations[unitKey]
    if (current && current.state !== 'error') return
    setExplanations((all) => ({ ...all, [unitKey]: { state: 'loading' } }))
    const reviewId = reviewIdRef.current
    window.yolk.explainUnit(reviewId, hover.file, hoverUnit).then(
      (text) => reviewIdRef.current === reviewId && setExplanations((all) => ({ ...all, [unitKey]: { state: 'done', text } })),
      (e) => reviewIdRef.current === reviewId && setExplanations((all) => ({ ...all, [unitKey]: { state: 'error', text: errorMessage(e) } })),
    )
  }, [hover, hoverUnit, unitKey, llmReady, explanations])

  // Lines selected with the mouse can be explained too: a small action appears beside the selection, and its answer
  // stays in a card until closed. While a selection is up, E explains it rather than the hovered unit.
  const [selection, setSelection] = useState<DiffSelection>()
  const selectionAnswer = selection ? explanations[selection.key] : undefined
  const closeSelection = useCallback(() => {
    setSelection(undefined)
    window.getSelection()?.removeAllRanges()
  }, [])
  const requestSelectionExplanation = useCallback(() => {
    if (!selection || !llmReady) return
    const { key, fileIndex, lines } = selection
    const current = explanations[key]
    if (current && current.state !== 'error') return
    setExplanations((all) => ({ ...all, [key]: { state: 'loading' } }))
    const reviewId = reviewIdRef.current
    window.yolk.explainSelection(reviewId, fileIndex, lines).then(
      (text) => reviewIdRef.current === reviewId && setExplanations((all) => ({ ...all, [key]: { state: 'done', text } })),
      (e) => reviewIdRef.current === reviewId && setExplanations((all) => ({ ...all, [key]: { state: 'error', text: errorMessage(e) } })),
    )
  }, [selection, llmReady, explanations])
  // A new selection replaces the old one; clearing the selection drops the action, but an answer card stays open.
  const onSelectionEnd = useCallback(() => {
    requestAnimationFrame(() => {
      const next = readSelection()
      if (next) setSelection(next)
      else setSelection((current) => (current && explanations[current.key] ? current : undefined))
    })
  }, [explanations])

  // While dragging, the browser's own selection shows (restyled); once it ends, the selected lines are bracketed and
  // stay bracketed while their action or answer is up.
  useEffect(() => markLines(selection?.elements ?? []), [selection])
  useEffect(() => () => markLines([]), [])
  // No hover card while a mouse button is down in the diff: it would sit on the lines being selected.
  const [isDragging, setIsDragging] = useState(false)
  useEffect(() => {
    if (!isDragging) return
    const onUp = () => setIsDragging(false)
    window.addEventListener('mouseup', onUp)
    return () => window.removeEventListener('mouseup', onUp)
  }, [isDragging])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key.toLowerCase() === 'e') {
        if (selection) requestSelectionExplanation()
        else requestExplanation()
      }
      if (e.key === 'Escape' && selection) closeSelection()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [requestExplanation, requestSelectionExplanation, closeSelection, selection])
  // A click outside the card closes an answered selection; starting a new selection outside it does the same.
  useEffect(() => {
    if (!selection) return
    const onDown = (e: MouseEvent) => {
      if ((e.target as Element).closest('.selection-card, .selection-action')) return
      setSelection(undefined)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [selection])

  // C toggles "core only" anywhere on the page except while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'c' && !e.metaKey && !e.ctrlKey && !e.altKey && !isTyping(e.target)) setCoreOnly((v) => !v)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // The file list follows the file being read: the last one whose top has scrolled up to the top of the diff.
  // (Counting any visible file made the previous file's last pixels win right after jumping to the next one.)
  useEffect(() => {
    if (!review) return
    const scroller = scrollParent(document.querySelector('.files'))
    const target: EventTarget = scroller ?? window
    let frame = 0
    const update = () => {
      frame = 0
      const top = (scroller?.getBoundingClientRect().top ?? 0) + READING_LINE
      const sections = document.querySelectorAll<HTMLElement>('section.file')
      let active = 0
      sections.forEach((el, i) => {
        if (el.getBoundingClientRect().top <= top) active = i
      })
      setActiveFile(active)
    }
    const onScroll = () => (frame ||= requestAnimationFrame(update))
    update()
    target.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      target.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(frame)
    }
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
          <ReviewHeader
            title={pr.title}
            meta={`${repo} #${pr.number} · ${files.length} 个文件`}
            status={status}
            judged={judgedUnits}
            total={totalUnits}
            totals={totals}
            coreOnly={coreOnly}
            onCoreOnlyChange={setCoreOnly}
            onShowPolicy={openPolicy}
          />
        }
        start={<FileList files={files} counts={counts} activeFile={activeFile} />}
        content={
          <LayoutContent padding={0}>
            <div
              className="files"
              onMouseLeave={() => onHover(undefined)}
              onMouseDown={(e) => e.button === 0 && setIsDragging(true)}
              onMouseUp={onSelectionEnd}
              // A plain click on code asks for its explanation; a click that ends a text selection does not.
              onClick={() => window.getSelection()?.isCollapsed !== false && requestExplanation()}
            >
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
      {selection && (
        <SelectionExplain
          selection={selection}
          explanation={selectionAnswer}
          llmReady={llmReady}
          onExplain={requestSelectionExplanation}
          onClose={closeSelection}
        />
      )}
      {hover && hovered && !selection && !isDragging && (
        <Tooltip
          hover={hover}
          file={hovered}
          state={states[hover.file].get(hover.block)}
          judgment={judgments[hover.file]?.[hover.block]}
          error={unitErrors[hover.file]?.[states[hover.file].get(hover.block)?.unit ?? ''] ?? judgmentError}
          llmReady={llmReady}
          explanation={unitKey ? explanations[unitKey] : undefined}
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

/**
 * The header and file list are memoized apart from the diff: hovering changes only the review's hover state, and
 * neither of these should re-render for it.
 */
const ReviewHeader = memo(function ReviewHeader({
  title,
  meta,
  status,
  judged,
  total,
  totals,
  coreOnly,
  onCoreOnlyChange,
  onShowPolicy,
}: {
  title: string
  meta: string
  status: Status
  judged: number
  total: number
  totals: Partial<Record<Category, number>>
  coreOnly: boolean
  onCoreOnlyChange: (value: boolean) => void
  onShowPolicy: () => void
}) {
  return (
    <LayoutHeader hasDivider>
      <HStack gap={4} align="center" wrap="wrap" className="review-header">
        <VStack gap={1} className="page-heading">
          <Heading level={1} maxLines={1}>
            {title}
          </Heading>
          <HStack gap={2} align="center" wrap="wrap">
            <Text type="supporting" className="review-title">
              {meta}
            </Text>
            <JudgeStatus status={status} judged={judged} total={total} />
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
            <Switch size="sm" label="只看核心" value={coreOnly} onChange={onCoreOnlyChange} />
            <Kbd keys="c" />
          </HStack>
          <Button size="sm" variant="ghost" label="审阅约定" icon={<Icon icon={ScrollText} size="sm" />} onClick={onShowPolicy} />
        </HStack>
      </HStack>
    </LayoutHeader>
  )
})

const FileList = memo(function FileList({
  files,
  counts,
  activeFile,
}: {
  files: ReviewStart['files']
  counts: Partial<Record<Category, number>>[]
  activeFile: number
}) {
  return (
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
  )
})

/** How far below the top of the diff a file's top may be and still count as the one being read. */
const READING_LINE = 24

/** The nearest ancestor that scrolls vertically, or null (the viewport). */
function scrollParent(element: Element | null): Element | null {
  for (let el = element?.parentElement; el; el = el.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(el).overflowY)) return el
  }
  return null
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
          {!!status.cachedUnits && ` · ${status.cachedUnits} 处复用缓存`}
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
