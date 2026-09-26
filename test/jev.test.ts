import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chunkFile } from '../src/core/chunk'
import { hunkRanges } from '../src/core/analyze'
import { parseDiff } from '../src/core/diff'
import { buildRequest } from '../src/core/jev'
import { languageById } from '../src/core/languages'

const source = [
  'import { db } from "./db"',
  'async function getUser(id) {',
  '  if (!id) throw new Error("id required");',
  '  const user = await db.find(id);',
  '  return user;',
  '}',
]

async function request(policy: string | null) {
  // Everything but the import line is added.
  const chunks = await chunkFile(languageById('typescript'), source.join('\n'), [{ start: 1, end: 6, added: [2, 3, 4, 5, 6] }])
  const unit = chunks.units[0]
  const blocks = chunks.blocks.filter((b) => b.unit === unit.id)
  const [diff] = parseDiff(['diff --git a/src/user.ts b/src/user.ts', '@@ -1 +1,6 @@', ` ${source[0]}`, ...source.slice(1).map((line) => `+${line}`)].join('\n'))
  return buildRequest({ pr: { title: 'Add getUser', body: 'Loads a user.' }, policy, diff, source, unit, blocks })
}

test('state marks block lines in the unit code and quotes each block', async () => {
  const { state } = await request(null)
  assert.equal(
    state.code,
    [
      '[B1]  async function getUser(id) {',
      '[B2]    if (!id) throw new Error("id required");',
      '[B3]    const user = await db.find(id);',
      '[B4]    return user;',
      '[B1]  }',
    ].join('\n'),
  )
  assert.equal(state.blocks.B1, 'async function getUser(id) {\n...\n}')
  assert.equal(state.blocks.B2, '  if (!id) throw new Error("id required");')
  assert.equal('policy' in state, false)
  assert.ok(state.diff.includes('+  const user = await db.find(id);'))
})

test('requests include replacements and deletion-only hunks in the unit, but exclude distant changes', async () => {
  const source = ['async function getUser(id) {', '  const user = await db.find(id);', '  return user;', '}', '', 'const other = false;']
  const [diff] = parseDiff([
    'diff --git a/src/user.ts b/src/user.ts',
    '@@ -1,4 +1,3 @@',
    ' async function getUser(id) {',
    '-  validateId(id);',
    '-  const user = cache.get(id);',
    '+  const user = await db.find(id);',
    '   return user;',
    '@@ -5 +3,0 @@',
    '-  log(user);',
    '@@ -8 +6 @@',
    '-const other = true;',
    '+const other = false;',
  ].join('\n'))
  const chunks = await chunkFile(languageById('typescript'), source.join('\n'), hunkRanges(diff))
  const unit = chunks.units.find((unit) => unit.kind === 'function')!
  const blocks = chunks.blocks.filter((block) => block.unit === unit.id)
  const { state, questions } = buildRequest({ pr: { title: 'Read from the database', body: '' }, policy: null, diff, source, unit, blocks })
  assert.equal(state.diff, [
    '@@ -1,4 +1,3 @@', ' async function getUser(id) {', '-  validateId(id);', '-  const user = cache.get(id);',
    '+  const user = await db.find(id);', '   return user;', '@@ -5 +3,0 @@', '-  log(user);',
  ].join('\n'))
  assert.deepEqual(Object.keys(questions), blocks.map((block) => `${block.id}_role`))
  assert.ok(!state.code.includes('cache.get') && !state.code.includes('log(user)'))
})

test('one role question per block, plus an exclusion question only with a policy', async () => {
  const without = await request(null)
  assert.deepEqual(Object.keys(without.questions), ['B1_role', 'B2_role', 'B3_role', 'B4_role'])
  const withPolicy = await request('MVP: validate input only at API boundaries.')
  assert.deepEqual(Object.keys(withPolicy.questions), [
    'B1_role', 'B1_excluded', 'B2_role', 'B2_excluded', 'B3_role', 'B3_excluded', 'B4_role', 'B4_excluded',
  ])
  assert.equal((withPolicy.state as { policy?: string }).policy, 'MVP: validate input only at API boundaries.')
})
