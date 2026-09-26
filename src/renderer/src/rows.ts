import type { FileResult } from '../../core/analyze'
import type { DiffLine } from '../../core/diff'
import { DEFAULT_THRESHOLDS, isUnsure, suggestsRemoval, type Judgment, type Role, type Thresholds } from '../../core/judgment'

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
  lines: number
  counts: Partial<Record<Category | 'deleted' | 'context' | 'uncertain', number>>
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

export function blockStates(
  file: FileResult,
  judgments: Record<string, Judgment>,
  unitErrors: Record<string, string>,
  error?: string,
  thresholds: Thresholds = DEFAULT_THRESHOLDS,
) {
  const states = new Map<string, BlockState>()
  for (const block of file.chunks?.blocks ?? []) {
    const j = judgments[block.id]
    let category: Category = 'pending'
    if (file.testBlocks?.includes(block.id)) category = 'test'
    else if (j) category = j.role
    else if (unitErrors[block.unit] || error) category = 'failed'
    states.set(block.id, { category, unsure: j ? isUnsure(j, thresholds) : false, cut: j ? suggestsRemoval(j, thresholds) : false, unit: block.unit })
  }
  return states
}

/** Core blocks plus their syntax, one nearby unchanged line, and old lines from the same edit. */
function focusLines(file: FileResult, states: Map<string, BlockState>) {
  const core = new Set<number>()
  const keep = new Set<number>()
  for (const block of file.chunks?.blocks ?? []) {
    const state = states.get(block.id)
    if (state?.category !== 'core' || state.unsure) continue
    const unit = file.chunks!.units.find((unit) => unit.id === block.unit)
    for (const line of block.lines) core.add(line)
    for (const line of [...block.lines, ...(block.context ?? (unit ? [unit.start, unit.end] : []))]) keep.add(line)
  }
  for (const hunk of file.diff.hunks) for (const line of hunk.lines) {
    if (line.kind === 'ctx' && (core.has(line.newNo! - 1) || core.has(line.newNo! + 1))) keep.add(line.newNo!)
  }
  return { core, keep }
}

/** Focus on core implementation; every hidden region can still be expanded. */
export function buildRows(file: FileResult, states: Map<string, BlockState>, coreOnly: boolean, expanded: Set<string>): Row[] {
  const blockOf = new Map<number, string>()
  for (const block of file.chunks?.blocks ?? []) for (const line of block.lines) blockOf.set(line, block.id)

  const rows: Row[] = []
  const { core, keep } = coreOnly ? focusLines(file, states) : { core: new Set<number>(), keep: new Set<number>() }
  const hunks = file.diff.hunks.map((hunk, h) => ({ ...hunk, key: `h${h}`, position: Number(/\+(\d+)/.exec(hunk.header)?.[1] ?? 0) }))
  // Syntax may be outside the diff's three context lines. Add only those missing lines, in source order.
  const present = new Set(file.diff.hunks.flatMap((hunk) => hunk.lines.map((line) => line.newNo)))
  let extra: (typeof hunks)[number] | undefined
  for (const line of [...keep].sort((a, b) => a - b)) {
    if (present.has(line) || file.source?.[line - 1] === undefined) continue
    if (!extra || extra.lines.at(-1)?.newNo !== line - 1) {
      extra = { key: `context${line}`, header: '⋯ 结构上下文', position: line, lines: [] }
      hunks.push(extra)
    }
    extra.lines.push({ kind: 'ctx', text: file.source[line - 1], newNo: line, oldNo: null })
  }
  hunks.sort((a, b) => a.position - b.position)
  const seen = new Set<string>()
  const push = (row: LineRow) => {
    row.firstOfBlock = row.block !== undefined && !seen.has(row.block)
    if (row.block) seen.add(row.block)
    rows.push(row)
  }

  hunks.forEach((hunk, h) => {
    rows.push({ kind: 'hunk', key: hunk.key, header: hunk.header })
    let run: LineRow[] = []
    const flush = () => {
      if (run.length) {
        const key = run[0].key
        if (expanded.has(key)) run.forEach(push)
        else {
          const counts: FoldRow['counts'] = {}
          for (const row of run) {
            if (!row.line.text.trim()) continue
            const category = row.line.kind === 'del' ? 'deleted'
              : row.unsure || row.category === 'pending' || row.category === 'failed' || (row.line.kind === 'add' && !row.block) ? 'uncertain'
              : row.category === 'none' ? 'context' : row.category
            counts[category] = (counts[category] ?? 0) + 1
          }
          rows.push({ kind: 'fold', key, lines: run.length, counts })
        }
      }
      run = []
    }

    const lineRows = hunk.lines.map((line, i): LineRow => {
      const block = line.kind === 'add' ? blockOf.get(line.newNo!) : undefined
      const state = block ? states.get(block) : undefined
      return {
        kind: 'line',
        key: `${hunk.key}l${i}`,
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

    const oldCore = new Set<LineRow>()
    let edit: LineRow[] = []
    const endEdit = () => {
      if (edit.some((row) => row.line.kind === 'add' && core.has(row.line.newNo!))) {
        for (const row of edit) if (row.line.kind === 'del') oldCore.add(row)
      }
      edit = []
    }
    for (const row of lineRows) {
      if (row.line.kind === 'ctx') endEdit()
      else edit.push(row)
    }
    endEdit()
    lineRows.forEach((row) => {
      if (coreOnly && !keep.has(row.line.newNo!) && !oldCore.has(row)) run.push(row)
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
