import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { FileResult } from '../src/core/analyze'
import type { Judgment, Role } from '../src/core/judgment'
import { blockStates, buildRows, type Row } from '../src/renderer/src/rows'

// One hunk: a core line, a blank line, two defense blocks (one unsure), a support line, a test block, a deleted line.
const file: FileResult = {
  diff: {
    path: 'src/a.ts',
    oldPath: 'src/a.ts',
    status: 'modified',
    binary: false,
    hunks: [
      {
        header: '@@ -1,2 +1,8 @@',
        lines: [
          { kind: 'ctx', text: 'function f() {', oldNo: 1, newNo: 1 },
          { kind: 'add', text: '  const a = load()', oldNo: null, newNo: 2 },
          { kind: 'add', text: '', oldNo: null, newNo: 3 },
          { kind: 'add', text: '  if (!a) return', oldNo: null, newNo: 4 },
          { kind: 'add', text: '', oldNo: null, newNo: 5 },
          { kind: 'add', text: '  try {', oldNo: null, newNo: 6 },
          { kind: 'add', text: '  log(a)', oldNo: null, newNo: 7 },
          { kind: 'del', text: '  old()', oldNo: 2, newNo: null },
          { kind: 'add', text: '  assert(a)', oldNo: null, newNo: 8 },
        ],
      },
    ],
  },
  chunks: {
    blocks: [
      { id: 'B1', lines: [2], nodeType: 'lexical_declaration', unit: 'U1' },
      { id: 'B2', lines: [4], nodeType: 'if_statement', unit: 'U1' },
      { id: 'B3', lines: [6], nodeType: 'try_statement', unit: 'U1' },
      { id: 'B4', lines: [7], nodeType: 'expression_statement', unit: 'U1' },
      { id: 'B5', lines: [8], nodeType: 'expression_statement', unit: 'U1' },
    ],
    units: [{ id: 'U1', kind: 'function', name: 'f', start: 1, end: 9, blocks: ['B1', 'B2', 'B3', 'B4', 'B5'] }],
    unowned: [],
    hasError: false,
  },
  testBlocks: ['B5'],
}

const judgment = (role: Role, confidence: number, excluded: number | null = null): Judgment => ({
  role,
  confidence,
  probabilities: { core: 0, defense: 0, support: 0, [role]: 1 },
  excluded,
})

const judgments = {
  B1: judgment('core', 0.9),
  B2: judgment('defense', 0.8, 0.9),
  B3: judgment('defense', 0.8),
  B4: judgment('support', 0.3),
}

const describe = (rows: Row[]) =>
  rows.map((r) => (r.kind === 'line' ? `${r.line.newNo ?? '-'}:${r.category}${r.unsure ? '?' : ''}${r.cut ? '✂' : ''}` : r.kind === 'fold' ? `fold ${JSON.stringify(r.counts)}` : 'hunk'))

test('all lines shown with categories; blank lines between same-category lines join the band', () => {
  const rows = buildRows(file, blockStates(file, judgments, {}), false, new Set())
  assert.deepEqual(describe(rows), ['hunk', '1:none', '2:core', '3:none', '4:defense✂', '5:defense', '6:defense', '7:support?', '-:none', '8:test'])
})

test('core only folds confident defense/support runs; unsure, test and deleted lines stay', () => {
  const rows = buildRows(file, blockStates(file, judgments, {}), true, new Set())
  assert.deepEqual(describe(rows), ['hunk', '1:none', '2:core', '3:none', 'fold {"defense":2}', '7:support?', '-:none', '8:test'])
})

test('an expanded fold shows its lines again', () => {
  const folded = buildRows(file, blockStates(file, judgments, {}), true, new Set())
  const fold = folded.find((r) => r.kind === 'fold')!
  const rows = buildRows(file, blockStates(file, judgments, {}), true, new Set([fold.key]))
  assert.equal(rows.some((r) => r.kind === 'fold'), false)
})

test('unjudged blocks are pending, blocks of failed units are failed', () => {
  const states = blockStates(file, {}, { U1: 'boom' })
  assert.equal(states.get('B1')!.category, 'failed')
  assert.equal(states.get('B5')!.category, 'test')
  assert.equal(blockStates(file, {}, {}).get('B1')!.category, 'pending')
})
