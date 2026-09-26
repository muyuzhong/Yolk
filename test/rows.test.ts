import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { FileResult } from '../src/core/analyze'
import type { Judgment, Role } from '../src/core/judgment'
import { chunkFile } from '../src/core/chunk'
import { languageById } from '../src/core/languages'
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

test('core only folds all non-core additions, preserving deletions in the core edit', () => {
  const rows = buildRows(file, blockStates(file, judgments, {}), true, new Set())
  assert.deepEqual(describe(rows), ['hunk', '1:none', '2:core', 'fold {"defense":2,"uncertain":1}', '-:none', 'fold {"test":1}'])
  assert.deepEqual(rows.filter(r => r.kind === 'fold').map(r => r.lines), [5, 1])
})

test('an expanded fold shows its lines again', () => {
  const folded = buildRows(file, blockStates(file, judgments, {}), true, new Set())
  const keys = folded.filter((r) => r.kind === 'fold').map(r => r.key)
  const states = blockStates(file, judgments, {})
  const rows = buildRows(file, states, true, new Set(keys))
  assert.deepEqual(rows, buildRows(file, states, false, new Set()))
})

test('without confident core, pending, failed, unsure and unclassified code remains expandable', () => {
  for (const states of [blockStates(file, {}, {}), blockStates(file, {}, { U1: 'boom' }), blockStates(file, { B1: judgment('core', 0.2) }, {})]) {
    const rows = buildRows(file, states, true, new Set())
    assert.deepEqual(describe(rows), ['hunk', 'fold {"context":1,"uncertain":4,"deleted":1,"test":1}'])
  }
  const unclassified = { diff: file.diff }
  const rows = buildRows(unclassified, new Map(), true, new Set())
  assert.deepEqual(describe(rows), ['hunk', 'fold {"context":1,"uncertain":5,"deleted":1}'])
  assert.deepEqual(buildRows(unclassified, new Map(), true, new Set(['h0l0'])), buildRows(unclassified, new Map(), false, new Set()))
})

test('AST context keeps enclosing syntax and multiline core; unrelated deletions fold', async () => {
  const source = [
    'function f(flag) {',
    '  debug()',
    '  if (flag) {',
    '    trace()',
    '    const value = compute(',
    '      flag,',
    '      42',
    '    )',
    '    consume(value)',
    '  }',
    '  log()',
    '}',
  ]
  const chunks = await chunkFile(languageById('typescript'), source.join('\n'), [{ start: 6, end: 6, added: [6] }])
  assert.deepEqual(chunks.blocks[0].context, [1, 3, 5, 6, 7, 8, 10, 12])
  const input: FileResult = { source, chunks, diff: { ...file.diff, hunks: [
    { header: '@@ -6 +6 @@', lines: [
      { kind: 'del', text: '      false,', newNo: null, oldNo: 6 },
      { kind: 'add', text: source[5], newNo: 6, oldNo: null },
    ] },
    { header: '@@ -10,3 +10,2 @@', lines: [
      { kind: 'ctx', text: source[9], newNo: 10, oldNo: 10 },
      { kind: 'del', text: '  oldLog()', newNo: null, oldNo: 11 },
      { kind: 'ctx', text: source[10], newNo: 11, oldNo: 12 },
    ] },
  ] } }
  const states = blockStates(input, { B1: judgment('core', 0.9) }, {})
  const rows = buildRows(input, states, true, new Set())
  const visible = rows.filter(r => r.kind === 'line')
  assert.deepEqual(visible.map(r => r.line.newNo), [1, 3, 5, null, 6, 7, 8, 10, 12])
  assert.equal(visible.find(r => r.line.newNo === 6)?.key, 'h0l1')
  assert.deepEqual(rows.filter(r => r.kind === 'fold').map(r => r.counts), [{ deleted: 1, context: 1 }])
  assert.deepEqual(buildRows(input, states, false, new Set()).filter(r => r.kind === 'line').map(r => r.line), input.diff.hunks.flatMap(h => h.lines))
})

test('unjudged blocks are pending, blocks of failed units are failed', () => {
  const states = blockStates(file, {}, { U1: 'boom' })
  assert.equal(states.get('B1')!.category, 'failed')
  assert.equal(states.get('B5')!.category, 'test')
  assert.equal(blockStates(file, {}, {}).get('B1')!.category, 'pending')
})
