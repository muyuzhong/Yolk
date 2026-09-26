import { memo, useEffect, useMemo, useState, type CSSProperties } from 'react'
import type { ThemedToken } from 'shiki'
import type { FileResult } from '../../core/analyze'
import { highlightHunks } from './highlight'
import { LABEL } from './labels'
import { buildRows, type BlockState, type Category, type LineRow } from './rows'

export interface Hover {
  file: number
  block: string
  x: number
  y: number
}

interface Props {
  index: number
  file: FileResult
  states: Map<string, BlockState>
  unitErrors?: Record<string, string>
  coreOnly: boolean
  hoveredBlock?: string
  onHover: (hover: Hover | undefined) => void
}

const STATUS: Record<FileResult['diff']['status'], string> = { added: '新增', deleted: '删除', modified: '', renamed: '重命名' }

export const DiffFile = memo(function DiffFile({ index, file, states, unitErrors, coreOnly, hoveredBlock, onHover }: Props) {
  const [tokens, setTokens] = useState<Map<string, ThemedToken[]>>()
  const [expanded, setExpanded] = useState(new Set<string>())

  useEffect(() => {
    highlightHunks(file.diff.path, file.diff.hunks).then(setTokens)
  }, [file])
  // Turning "core only" back on folds everything again.
  useEffect(() => setExpanded(new Set()), [coreOnly])

  const rows = useMemo(() => buildRows(file, states, coreOnly, expanded), [file, states, coreOnly, expanded])
  const { diff } = file

  return (
    <section className="file" id={`file-${index}`}>
      <header className="file-header">
        <span className="file-path">
          {diff.status === 'renamed' && <span className="muted">{diff.oldPath} → </span>}
          {diff.path}
        </span>
        {STATUS[diff.status] && <span className="tag">{STATUS[diff.status]}</span>}
        {file.skipped && <span className="muted">{file.skipped}，只显示 diff</span>}
      </header>
      {unitErrors &&
        Object.entries(unitErrors).map(([unit, error]) => (
          <div key={unit} className="unit-error">
            {unit} 判断失败：{error}
          </div>
        ))}
      <div className="diff">
        {rows.map((row) => {
          if (row.kind === 'hunk') return <div key={row.key} className="hunk-header">{row.header}</div>
          if (row.kind === 'fold') {
            const summary = (Object.entries(row.counts) as [Category, number][]).map(([c, n]) => `${LABEL[c]} ${n} 行`).join(' · ')
            return (
              <button key={row.key} className="fold" onClick={() => setExpanded((s) => new Set(s).add(row.key))}>
                ⋯ {summary}（点击展开）
              </button>
            )
          }
          return (
            <Line
              key={row.key}
              row={row}
              tokens={tokens?.get(row.key)}
              hovered={row.block !== undefined && row.block === hoveredBlock}
              onEnter={(e) => onHover(row.block ? { file: index, block: row.block, x: e.clientX, y: e.clientY } : undefined)}
            />
          )
        })}
      </div>
    </section>
  )
})

const SIGN = { add: '+', del: '-', ctx: ' ' }

function Line({ row, tokens, hovered, onEnter }: { row: LineRow; tokens?: ThemedToken[]; hovered: boolean; onEnter: (e: React.MouseEvent) => void }) {
  const { line } = row
  const classes = ['line', line.kind, `cat-${row.category}`, row.unsure && 'unsure', hovered && 'hovered'].filter(Boolean).join(' ')
  const mark = row.firstOfBlock ? `${row.cut ? '✂' : ''}${row.unsure ? '?' : ''}` : ''
  return (
    <div className={classes} onMouseEnter={onEnter}>
      <span className="num">{line.oldNo ?? ''}</span>
      <span className="num">{line.newNo ?? ''}</span>
      <span className="mark">{mark}</span>
      <code>
        <span className="sign">{SIGN[line.kind]}</span>
        {tokens
          ? tokens.map((t, i) => (
              <span key={i} style={t.htmlStyle as CSSProperties}>
                {t.content}
              </span>
            ))
          : line.text}
      </code>
    </div>
  )
}
