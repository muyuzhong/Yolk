import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chunkFile } from '../src/core/chunk'
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
  return buildRequest({ pr: { title: 'Add getUser', body: 'Loads a user.' }, policy, path: 'src/user.ts', source, unit, blocks })
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
