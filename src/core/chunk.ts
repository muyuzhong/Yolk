import type { Node, QueryMatch } from '@vscode/tree-sitter-wasm'
import { loadGrammar, type LangSpec } from './languages'

/** A contiguous change region in the new file. Line numbers are 1-based. */
export interface HunkRange {
  start: number
  end: number
  added: number[]
}

/** Added lines owned by one statement-level node; the unit of classification. */
export interface Block {
  id: string
  lines: number[]
  nodeType: string
  unit: string
}

/** Blocks judged together in one Jev request: a changed function, or top-level changes in one hunk. */
export interface Unit {
  id: string
  kind: 'function' | 'toplevel'
  name: string
  start: number
  end: number
  blocks: string[]
}

export interface Chunks {
  blocks: Block[]
  units: Unit[]
  /** Non-blank added lines that no statement-level node owns. */
  unowned: number[]
  hasError: boolean
}

const UNIT_TYPE = /(_statement|_declaration|_definition|_clause|_item)$/
const COLLAPSE_MAX_LINES = 3
/** Anonymous functions (callbacks, closures) this long get their own judgment unit. */
const ANONYMOUS_UNIT_MIN_LINES = 5

/** Last row a node actually occupies (a node ending at column 0 ends on the previous row). */
function lastRow(node: Node): number {
  const { row, column } = node.endPosition
  return column === 0 && row > node.startPosition.row ? row - 1 : row
}

export async function chunkFile(spec: LangSpec, source: string, hunks: HunkRange[]): Promise<Chunks> {
  const { parser, tags } = await loadGrammar(spec)
  const tree = parser.parse(source)!
  const lines = source.split('\n')

  // Comments, attributes and decorators belong to the statement they annotate.
  const isAttached = (n: Node) => /comment$/.test(n.type) || spec.attachToNext.includes(n.type)
  const isUnit = (n: Node) =>
    n.isNamed &&
    !isAttached(n) &&
    !spec.notUnits.includes(n.type) &&
    (UNIT_TYPE.test(n.type) || spec.extraUnits.includes(n.type) || spec.unitParents.includes(n.parent?.type ?? ''))
  const isCollapsed = (n: Node) =>
    spec.collapse.includes(n.type) || lastRow(n) - n.startPosition.row + 1 <= COLLAPSE_MAX_LINES

  // Deepest unit starting on each row, so `} catch (e) {` goes to the catch clause.
  const startsAt = new Map<number, { node: Node; depth: number }>()
  const anonymous: Node[] = []
  const walk = (n: Node, depth: number) => {
    if (isUnit(n)) {
      const row = n.startPosition.row
      const current = startsAt.get(row)
      if (!current || depth > current.depth) startsAt.set(row, { node: n, depth })
    }
    if (spec.anonymousFunctions.includes(n.type) && lastRow(n) - n.startPosition.row + 1 >= ANONYMOUS_UNIT_MIN_LINES) {
      anonymous.push(n)
    }
    for (const child of n.namedChildren) if (child) walk(child, depth + 1)
  }
  walk(tree.rootNode, 0)

  const annotated = (n: Node): Node | null => {
    let next = n.nextNamedSibling
    while (next && isAttached(next)) next = next.nextNamedSibling
    return next && isUnit(next) ? next : null
  }

  const ownerOf = (line: number): Node | null => {
    const row = line - 1
    const column = (lines[row] ?? '').search(/\S/)
    if (column < 0) return null
    let node: Node | null = startsAt.get(row)?.node ?? null
    if (!node) {
      node = tree.rootNode.descendantForPosition({ row, column })
      for (let n: Node | null = node; n && !isUnit(n); n = n.parent) {
        if (isAttached(n)) {
          node = annotated(n) ?? node
          break
        }
      }
    }
    while (node && !isUnit(node)) node = node.parent
    let owner = node
    for (let n = node; n; n = n.parent) if (isUnit(n) && isCollapsed(n)) owner = n
    return owner
  }

  // Group added lines by owner, in line order.
  const byOwner = new Map<number, { node: Node; lines: number[] }>()
  const unowned: number[] = []
  for (const line of hunks.flatMap((h) => h.added)) {
    const owner = ownerOf(line)
    if (!owner) {
      if (lines[line - 1]?.trim()) unowned.push(line)
      continue
    }
    const group = byOwner.get(owner.id) ?? { node: owner, lines: [] }
    group.lines.push(line)
    byOwner.set(owner.id, group)
  }

  const functions = functionRanges(spec, tags.matches(tree.rootNode), anonymous, lines)
  const units = new Map<string, Unit>()
  const blocks: Block[] = []
  for (const { node, lines: blockLines } of byOwner.values()) {
    const id = `B${blocks.length + 1}`
    const start = node.startPosition.row + 1
    const end = lastRow(node) + 1
    const fn = functions
      .filter((f) => f.start <= start && f.end >= end)
      .sort((a, b) => a.end - a.start - (b.end - b.start))[0]
    const hunkIndex = hunks.findIndex((h) => h.start <= blockLines[0] && blockLines[0] <= h.end)
    const key = fn ? `fn:${fn.id}` : `hunk:${hunkIndex}`
    let unit = units.get(key)
    if (!unit) {
      unit = fn
        ? { id: `U${units.size + 1}`, kind: 'function', name: fn.name, start: fn.start, end: fn.end, blocks: [] }
        : { id: `U${units.size + 1}`, kind: 'toplevel', name: '', start: hunks[hunkIndex].start, end: hunks[hunkIndex].end, blocks: [] }
      units.set(key, unit)
    }
    unit.blocks.push(id)
    blocks.push({ id, lines: blockLines, nodeType: node.type, unit: unit.id })
  }

  return { blocks, units: [...units.values()], unowned, hasError: tree.rootNode.hasError }
}

interface FunctionRange {
  id: number
  name: string
  start: number
  end: number
}

/** Named functions from tags.scm, plus long anonymous functions named after their first line. */
function functionRanges(spec: LangSpec, matches: QueryMatch[], anonymous: Node[], lines: string[]): FunctionRange[] {
  const ranges = new Map<number, FunctionRange>()
  const add = (node: Node, name: string) =>
    ranges.set(node.id, { id: node.id, name, start: node.startPosition.row + 1, end: lastRow(node) + 1 })

  for (const match of matches) {
    const def = match.captures.find((c) => c.name === 'definition.function' || c.name === 'definition.method')
    if (!def) continue
    let node = def.node
    if (node.parent && spec.wrappers.includes(node.parent.type)) node = node.parent
    add(node, match.captures.find((c) => c.name === 'name')?.node.text ?? '')
  }
  const named = [...ranges.values()]
  for (const node of anonymous) {
    const start = node.startPosition.row + 1
    const end = lastRow(node) + 1
    // `const f = () => {}` is already a named function from tags.scm.
    if (named.some((f) => f.start === start && f.end === end)) continue
    add(node, lines[start - 1].trim().slice(0, 80))
  }
  return [...ranges.values()]
}
