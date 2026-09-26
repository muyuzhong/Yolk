import { Icon } from '@astryxdesign/core/Icon'
import { IconButton } from '@astryxdesign/core/IconButton'
import { Text } from '@astryxdesign/core/Text'
import { Token } from '@astryxdesign/core/Token'
import { ChevronDown, ChevronRight, ChevronsUpDown } from 'lucide-react'
import { memo, useEffect, useMemo, useState, type CSSProperties } from 'react'
import type { ThemedToken } from 'shiki'
import type { FileResult } from '../../core/analyze'
import { highlightHunks } from './highlight'
import { LABEL, SHOWN } from './labels'
import { buildRows, type BlockState, type Category, type FoldRow, type LineRow } from './rows'

const FOLD_LABEL = { ...LABEL, deleted: '删除', context: '上下文', uncertain: '未确定' }

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
  counts: Partial<Record<Category, number>>
  unitErrors?: Record<string, string>
  coreOnly: boolean
  hoveredBlock?: string
  onHover: (hover: Hover | undefined) => void
}

const STATUS: Record<FileResult['diff']['status'], [string, 'green' | 'red' | 'blue'] | undefined> = {
  added: ['新增', 'green'],
  deleted: ['删除', 'red'],
  renamed: ['重命名', 'blue'],
  modified: undefined,
}

export const DiffFile = memo(function DiffFile({ index, file, states, counts, unitErrors, coreOnly, hoveredBlock, onHover }: Props) {
  const [tokens, setTokens] = useState<Map<string, ThemedToken[]>>()
  const [expanded, setExpanded] = useState(new Set<string>())
  const [isCollapsed, setIsCollapsed] = useState(false)

  useEffect(() => {
    highlightHunks(file.diff.path, file.diff.hunks).then(setTokens)
  }, [file])
  // Turning "core only" back on folds everything again.
  useEffect(() => setExpanded(new Set()), [coreOnly])

  const rows = useMemo(() => buildRows(file, states, coreOnly, expanded), [file, states, coreOnly, expanded])
  const { diff } = file
  const status = STATUS[diff.status]

  return (
    <section className="file" id={`file-${index}`} data-index={index}>
      <header className="file-header">
        <IconButton
          size="sm"
          variant="ghost"
          label={isCollapsed ? '展开文件' : '折叠文件'}
          icon={<Icon icon={isCollapsed ? ChevronRight : ChevronDown} size="sm" />}
          onClick={() => setIsCollapsed((v) => !v)}
        />
        <span className="file-path">
          {diff.status === 'renamed' && <span className="file-old-path">{diff.oldPath} → </span>}
          {diff.path}
        </span>
        {status && <Token size="sm" color={status[1]} label={status[0]} />}
        <span className="spacer" />
        {file.skipped ? (
          <Text type="supporting">{file.skipped}，只显示 diff</Text>
        ) : (
          SHOWN.filter((c) => counts[c]).map((c) => (
            <span key={c} className={`legend-item cat-${c}`}>
              {LABEL[c]} {counts[c]}
            </span>
          ))
        )}
      </header>
      {!isCollapsed && unitErrors && (
        <div className="unit-errors">
          {Object.entries(unitErrors).map(([unit, error]) => (
            <div key={unit}>
              {unit} 判断失败：{error}
            </div>
          ))}
        </div>
      )}
      {!isCollapsed && (
        <div className="diff">
          {rows.map((row) => {
            if (row.kind === 'hunk') return <div key={row.key} className="hunk-header">{row.header}</div>
            if (row.kind === 'fold') {
              const summary = (Object.entries(row.counts) as [keyof FoldRow['counts'], number][]).map(([c, n]) => `${FOLD_LABEL[c]} ${n} 行`).join(' · ')
              return (
                <button key={row.key} className="fold" onClick={() => setExpanded((s) => new Set(s).add(row.key))}>
                  <Icon icon={ChevronsUpDown} size="xsm" />
                  已折叠 {row.lines} 行{summary && ` · ${summary}`}
                </button>
              )
            }
            return (
              <Line
                key={row.key}
                row={row}
                tokens={tokens?.get(row.key)}
                hovered={row.block !== undefined && row.block === hoveredBlock}
                fileIndex={index}
                onHover={onHover}
              />
            )
          })}
        </div>
      )}
    </section>
  )
})

const SIGN = { add: '+', del: '−', ctx: ' ' }

/**
 * One diff line. Memoized with only stable props, so moving the mouse between blocks re-renders just the lines that
 * gain or lose the hover highlight, not every highlighted token of the file.
 */
const Line = memo(function Line({
  row,
  tokens,
  hovered,
  fileIndex,
  onHover,
}: {
  row: LineRow
  tokens?: ThemedToken[]
  hovered: boolean
  fileIndex: number
  onHover: (hover: Hover | undefined) => void
}) {
  const { line } = row
  const onEnter = (e: React.MouseEvent) => onHover(row.block ? { file: fileIndex, block: row.block, x: e.clientX, y: e.clientY } : undefined)
  const classes = ['line', line.kind, `cat-${row.category}`, row.unsure && 'unsure', hovered && 'hovered'].filter(Boolean).join(' ')
  const mark = row.firstOfBlock ? `${row.cut ? '✂' : ''}${row.unsure ? '?' : ''}` : ''
  return (
    // Position data lets a mouse selection be mapped back to diff lines (see SelectionExplain).
    <div className={classes} onMouseEnter={onEnter} data-kind={line.kind} data-old={line.oldNo ?? undefined} data-new={line.newNo ?? undefined}>
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
})
