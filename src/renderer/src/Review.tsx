import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Judgment } from '../../core/judgment'
import type { ReviewStart } from '../../shared/api'
import { DiffFile, type Hover } from './DiffFile'
import { errorMessage, LABEL, SHOWN } from './labels'
import { blockStates, lineCounts } from './rows'
import { Tooltip } from './Tooltip'

type Status = { state: 'judging' } | { state: 'done'; model: string; inputTokens: number } | { state: 'error'; message: string }

export function Review({ url, onBack }: { url: string; onBack: () => void }) {
  const [review, setReview] = useState<ReviewStart>()
  const [loadError, setLoadError] = useState<string>()
  const [judgments, setJudgments] = useState<Record<number, Record<string, Judgment>>>({})
  const [unitErrors, setUnitErrors] = useState<Record<number, Record<string, string>>>({})
  const [judgedUnits, setJudgedUnits] = useState(0)
  const [status, setStatus] = useState<Status>({ state: 'judging' })
  const [coreOnly, setCoreOnly] = useState(false)
  const [showPolicy, setShowPolicy] = useState(false)
  const [hover, setHover] = useState<Hover>()

  useEffect(() => {
    const reviewId = crypto.randomUUID()
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
    return unsubscribe
  }, [url])

  const states = useMemo(
    () => review?.files.map((file, i) => blockStates(file, judgments[i] ?? {}, unitErrors[i] ?? {})) ?? [],
    [review, judgments, unitErrors],
  )
  // Units with at least one block that goes to Jev (test blocks do not).
  const totalUnits = useMemo(
    () =>
      review?.files.reduce(
        (sum, file) =>
          sum + (file.chunks?.units.filter((u) => u.blocks.some((b) => !file.testBlocks?.includes(b))).length ?? 0),
        0,
      ) ?? 0,
    [review],
  )

  const onHover = useCallback((next: Hover | undefined) => {
    setHover((current) => (current?.file === next?.file && current?.block === next?.block ? current : next))
  }, [])

  if (loadError) {
    return (
      <div className="page-message">
        <p className="error">打开 PR 失败：{loadError}</p>
        <button onClick={onBack}>返回</button>
      </div>
    )
  }
  if (!review) return <div className="page-message muted">正在读取 PR、切分代码块…</div>

  const { pr, files, policy } = review
  const hovered = hover && review.files[hover.file]
  return (
    <div className="review">
      <header className="review-header">
        <button className="link" onClick={onBack}>
          ◀ 返回
        </button>
        <div className="review-title">
          <a href={pr.url} target="_blank" rel="noreferrer">
            {pr.owner}/{pr.repo} #{pr.number}
          </a>
          <span>{pr.title}</span>
        </div>
        <div className="legend">
          {SHOWN.map((c) => (
            <span key={c} className={`chip cat-${c}`}>
              {LABEL[c]}
            </span>
          ))}
        </div>
        <label className="toggle">
          <input type="checkbox" checked={coreOnly} onChange={(e) => setCoreOnly(e.target.checked)} />
          只看核心
        </label>
        <button className={showPolicy ? 'link active' : 'link'} onClick={() => setShowPolicy((v) => !v)}>
          约定 {showPolicy ? '▾' : '▸'}
        </button>
        <span className="status muted">
          {status.state === 'judging' && `Jev 判断中 ${judgedUnits}/${totalUnits}`}
          {status.state === 'done' && `判断完成 · ${status.model || 'jev'} · ${(status.inputTokens / 1000).toFixed(1)}k token`}
          {status.state === 'error' && <span className="error">判断失败：{status.message}</span>}
        </span>
      </header>
      {showPolicy && (
        <div className="policy">
          {policy ? (
            <>
              <div className="muted">base 分支的 .yolk.md</div>
              <pre>{policy}</pre>
            </>
          ) : (
            <div className="muted">base 分支没有 .yolk.md，不会标 ✂（建议删除）。</div>
          )}
        </div>
      )}
      <div className="review-body">
        <nav className="file-list">
          {files.map((file, i) => {
            const counts = lineCounts(file, states[i])
            const name = file.diff.path.split('/').pop()
            const dir = file.diff.path.slice(0, -name!.length)
            return (
              <button key={file.diff.path} onClick={() => document.getElementById(`file-${i}`)?.scrollIntoView()}>
                <span className="file-name">
                  <span className="muted">{dir}</span>
                  {name}
                </span>
                <span className="file-counts">
                  {file.skipped ? (
                    <span className="muted">{file.skipped}</span>
                  ) : (
                    SHOWN.filter((c) => counts[c]).map((c) => (
                      <span key={c} className={`count cat-${c}`}>
                        {LABEL[c]} {counts[c]}
                      </span>
                    ))
                  )}
                </span>
              </button>
            )
          })}
        </nav>
        <main className="files" onMouseLeave={() => onHover(undefined)}>
          {files.map((file, i) => (
            <DiffFile
              key={file.diff.path}
              index={i}
              file={file}
              states={states[i]}
              unitErrors={unitErrors[i]}
              coreOnly={coreOnly}
              hoveredBlock={hover?.file === i ? hover.block : undefined}
              onHover={onHover}
            />
          ))}
        </main>
      </div>
      {hover && hovered && (
        <Tooltip
          hover={hover}
          file={hovered}
          state={states[hover.file].get(hover.block)}
          judgment={judgments[hover.file]?.[hover.block]}
          error={unitErrors[hover.file]?.[states[hover.file].get(hover.block)?.unit ?? '']}
        />
      )}
    </div>
  )
}
