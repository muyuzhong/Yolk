import { Button } from '@astryxdesign/core/Button'
import { Icon } from '@astryxdesign/core/Icon'
import { IconButton } from '@astryxdesign/core/IconButton'
import { Kbd } from '@astryxdesign/core/Kbd'
import { Spinner } from '@astryxdesign/core/Spinner'
import { Sparkles, X } from 'lucide-react'
import type { SelectionLine } from '../../shared/api'
import type { Explanation } from './Tooltip'

/** What the reviewer selected in one file's diff, and where on screen the selection ends. */
export interface DiffSelection {
  fileIndex: number
  lines: SelectionLine[]
  x: number
  y: number
  /** Identifies the selection for caching its explanation. */
  key: string
  /** The selected line elements, highlighted while the selection or its answer is up. */
  elements: HTMLElement[]
}

const WIDTH = 420

/**
 * Maps the current text selection to diff lines of one file (the file the selection starts in), or null when nothing
 * in the diff is selected. Lines carry their position as data attributes (see DiffFile's Line).
 */
export function readSelection(): DiffSelection | null {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null
  const range = selection.getRangeAt(0)
  const start = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement
  const section = start?.closest<HTMLElement>('section.file')
  if (!section) return null
  const elements = [...section.querySelectorAll<HTMLElement>('.line')].filter((el) => range.intersectsNode(el))
  const lines = elements.map(
      (el): SelectionLine => ({
        kind: el.dataset.kind as SelectionLine['kind'],
        oldNo: el.dataset.old ? Number(el.dataset.old) : null,
        newNo: el.dataset.new ? Number(el.dataset.new) : null,
      }),
    )
  if (!lines.length) return null
  const rects = range.getClientRects()
  const end = rects[rects.length - 1] ?? range.getBoundingClientRect()
  const fileIndex = Number(section.dataset.index)
  return { fileIndex, lines, x: end.right, y: end.bottom, key: `sel:${fileIndex}:${JSON.stringify(lines)}`, elements }
}

let marked: HTMLElement[] = []

/**
 * Brackets a finished selection: a bar down each side of the selected lines, with ticks at the first and last line,
 * like [ … ]. It sets a data attribute React does not manage, so it survives the lines re-rendering for hover.
 */
export function markLines(elements: HTMLElement[]) {
  for (const el of marked) if (!elements.includes(el)) delete el.dataset.selected
  elements.forEach((el, i) => {
    const first = i === 0
    const last = i === elements.length - 1
    el.dataset.selected = first && last ? 'only' : first ? 'first' : last ? 'last' : 'middle'
  })
  marked = elements
}

/** "第 12–18 行" from the new-version numbers of a selection, or the old ones when only removed lines are selected. */
function rangeLabel(lines: SelectionLine[]): string {
  const numbers = lines.flatMap((l) => (l.newNo === null ? [] : [l.newNo]))
  const [first, last, prefix] = numbers.length
    ? [Math.min(...numbers), Math.max(...numbers), '']
    : [Math.min(...lines.map((l) => l.oldNo!)), Math.max(...lines.map((l) => l.oldNo!)), '旧版']
  return first === last ? `${prefix}第 ${first} 行` : `${prefix}第 ${first}–${last} 行`
}

/**
 * Beside a selection in the diff: first a small "explain" action, then the explanation itself in a card that stays
 * until it is closed (Esc, ×, or a click elsewhere).
 */
export function SelectionExplain({
  selection,
  explanation,
  llmReady,
  onExplain,
  onClose,
}: {
  selection: DiffSelection
  explanation?: Explanation
  llmReady: boolean
  onExplain: () => void
  onClose: () => void
}) {
  const left = Math.max(16, Math.min(selection.x - WIDTH / 2, window.innerWidth - WIDTH - 16))
  // Open upwards in the lower part of the window so the card stays on screen.
  const vertical = selection.y < window.innerHeight * 0.6 ? { top: selection.y + 8 } : { bottom: window.innerHeight - selection.y + 28 }
  const count = selection.lines.length
  if (!explanation) {
    return (
      <div className="selection-action" style={{ left: Math.min(selection.x, window.innerWidth - 260), top: selection.y + 8 }}>
        {llmReady ? (
          <>
            <Button size="sm" variant="ghost" icon={<Icon icon={Sparkles} size="sm" color="inherit" />} label={`解释所选的 ${count} 行`} onClick={onExplain} />
            <Kbd keys="e" />
          </>
        ) : (
          <span className="muted">在设置里配置通用模型后，可以解释选中的代码</span>
        )}
      </div>
    )
  }
  return (
    <div className="selection-card" role="dialog" aria-label="所选代码的解释" style={{ left, width: WIDTH, ...vertical }}>
      <div className="selection-card-header">
        <Icon icon={Sparkles} size="sm" color="accent" />
        <span className="explanation-subject">
          关于所选的 {count} 行（{rangeLabel(selection.lines)}）
        </span>
        <IconButton size="sm" variant="ghost" label="关闭" tooltip="关闭（Esc）" icon={<Icon icon={X} size="sm" />} onClick={onClose} />
      </div>
      {explanation.state === 'loading' && (
        <span className="muted explanation-loading">
          <Spinner size="sm" /> 正在分析所选代码…
        </span>
      )}
      {explanation.state === 'done' && <div className="explanation">{explanation.text}</div>}
      {explanation.state === 'error' && <span className="tooltip-error">解释失败：{explanation.text}（再按 E 重试）</span>}
    </div>
  )
}
