import type { FileResult } from '../../core/analyze'
import type { DiffLine } from '../../core/diff'
import { isUnsure, suggestsRemoval, type Judgment, type Role } from '../../core/judgment'

/** How an added line is colored. `none`: blank or unchunked; `pending`: not judged yet. */
export type Category = Role | 'test' | 'pending' | 'failed' | 'none'

export interface LineRow {
  kind: 'line'
  key: string
  hunk: number
  index: number
  line: DiffLine
  block?: string
  category: Category
  unsure: boolean
  cut: boolean
  /** Markers (? and ✂) are drawn once per block, on its first visible line. */
  firstOfBlock: boolean
}

export interface FoldRow {
  kind: 'fold'
  key: string
  counts: Partial<Record<Category, number>>
}

export interface HunkRow {
  kind: 'hunk'
  key: string
  header: string
}

export type Row = LineRow | FoldRow | HunkRow

export interface BlockState {
  category: Category
  unsure: boolean
  cut: boolean
  unit: string
}

export function blockStates(file: FileResult, judgments: Record<string, Judgment>, unitErrors: Record<string, string>) {
  const states = new Map<string, BlockState>()
  for (const block of file.chunks?.blocks ?? []) {
    const j = judgments[block.id]
    let category: Category = 'pending'
    if (file.testBlocks?.includes(block.id)) category = 'test'
    else if (j) category = j.role
    else if (unitErrors[block.unit]) category = 'failed'
    states.set(block.id, { category, unsure: j ? isUnsure(j) : false, cut: j ? suggestsRemoval(j) : false, unit: block.unit })
  }
  return states
}

const FOLDABLE: Category[] = ['defense', 'support']

/**
 * Rows to render for one file. With `coreOnly`, runs of confidently judged defense/support lines
 * (and blank lines between them) collapse into one fold row unless their key is in `expanded`.
 * Deleted and context lines always stay visible and end a run.
 */
export function buildRows(file: FileResult, states: Map<string, BlockState>, coreOnly: boolean, expanded: Set<string>): Row[] {
  const blockOf = new Map<number, string>()
  for (const block of file.chunks?.blocks ?? []) for (const line of block.lines) blockOf.set(line, block.id)

  const rows: Row[] = []
  const seen = new Set<string>()
  const push = (row: LineRow) => {
    row.firstOfBlock = row.block !== undefined && !seen.has(row.block)
    if (row.block) seen.add(row.block)
    rows.push(row)
  }

  file.diff.hunks.forEach((hunk, h) => {
    rows.push({ kind: 'hunk', key: `h${h}`, header: hunk.header })
    let run: LineRow[] = []
    const flush = () => {
      let end = run.length
      while (end > 0 && run[end - 1].category === 'none') end--
      const folded = run.slice(0, end)
      if (folded.length) {
        const key = folded[0].key
        if (expanded.has(key)) folded.forEach(push)
        else {
          const counts: FoldRow['counts'] = {}
          for (const row of folded) if (row.line.text.trim()) counts[row.category] = (counts[row.category] ?? 0) + 1
          rows.push({ kind: 'fold', key, counts })
        }
      }
      run.slice(end).forEach(push)
      run = []
    }

    const lineRows = hunk.lines.map((line, i): LineRow => {
      const block = line.kind === 'add' ? blockOf.get(line.newNo!) : undefined
      const state = block ? states.get(block) : undefined
      return {
        kind: 'line',
        key: `h${h}l${i}`,
        hunk: h,
        index: i,
        line,
        block,
        category: state?.category ?? 'none',
        unsure: state?.unsure ?? false,
        cut: state?.cut ?? false,
        firstOfBlock: false,
      }
    })
    fillBlankLines(lineRows)

    lineRows.forEach((row) => {
      const { line } = row
      const foldable = coreOnly && FOLDABLE.includes(row.category) && !row.unsure
      const blankBetween = isBlankAdd(row) && row.category === 'none' && run.length > 0
      if (foldable || blankBetween) run.push(row)
      else {
        flush()
        push(row)
      }
    })
    flush()
  })
  return rows
}

const isBlankAdd = (row: LineRow) => row.line.kind === 'add' && !row.line.text.trim()

/** A blank added line between two added lines of the same category takes that category, so bands stay unbroken. */
function fillBlankLines(rows: LineRow[]) {
  rows.forEach((row, i) => {
    if (!isBlankAdd(row) || row.category !== 'none') return
    let before = i - 1
    while (before >= 0 && isBlankAdd(rows[before])) before--
    let after = i + 1
    while (after < rows.length && isBlankAdd(rows[after])) after++
    const [prev, next] = [rows[before], rows[after]]
    if (prev?.line.kind === 'add' && next?.line.kind === 'add' && prev.category === next.category) {
      row.category = prev.category
      row.unsure = prev.unsure && next.unsure
    }
  })
}

/** Non-blank added lines per category, for the file list. */
export function lineCounts(file: FileResult, states: Map<string, BlockState>) {
  const counts: Partial<Record<Category, number>> = {}
  for (const block of file.chunks?.blocks ?? []) {
    const category = states.get(block.id)?.category ?? 'pending'
    counts[category] = (counts[category] ?? 0) + block.lines.length
  }
  return counts
}
