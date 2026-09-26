import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { registerHooks } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildRequest } from '../src/core/jev'
import { DEFAULT_JUDGING, isUnsure, suggestsRemoval, type Judgment } from '../src/core/judgment'

test('settings store only the judging values that differ from the defaults', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'yolk-judging-'))
  const electron = `data:text/javascript,${encodeURIComponent(`
    export const app = { getPath: () => ${JSON.stringify(dir)} };
    export const safeStorage = { encryptString: s => Buffer.from(s), decryptString: b => b.toString() };
  `)}`
  const hooks = registerHooks({ resolve: (specifier, context, next) => (specifier === 'electron' ? { url: electron, shortCircuit: true } : next(specifier, context)) })
  try {
    const { loadSettings, saveJudging, settingsView } = await import('../src/main/settings')
    const changed = { thresholds: { ...DEFAULT_JUDGING.thresholds, excluded: 0.6 }, roles: { ...DEFAULT_JUDGING.roles, core: '  新的核心标准  ' } }
    const view = await saveJudging(changed)
    assert.deepEqual(view.judging, { thresholds: { lowConfidence: 0.5, excluded: 0.6 }, roles: { ...DEFAULT_JUDGING.roles, core: '新的核心标准' } })
    const stored = JSON.parse(await readFile(join(dir, 'settings.json'), 'utf8'))
    assert.deepEqual(stored.judging, { thresholds: { excluded: 0.6 }, roles: { core: '新的核心标准' } })
    assert.deepEqual((await loadSettings()).judging.roles.core, '新的核心标准')
    // Blank role text falls back to the default instead of sending Jev an empty option.
    await saveJudging({ ...changed, roles: { ...changed.roles, core: ' ' } })
    assert.equal((await settingsView()).judging.roles.core, DEFAULT_JUDGING.roles.core)
    await saveJudging(null)
    assert.deepEqual((await settingsView()).judging, DEFAULT_JUDGING)
  } finally {
    hooks.deregister()
    await rm(dir, { recursive: true, force: true })
  }
})

test('thresholds decide ? and ✂', () => {
  const j: Judgment = { role: 'defense', confidence: 0.6, probabilities: { core: 0.1, defense: 0.6, support: 0.3 }, excluded: 0.65 }
  assert.equal(isUnsure(j), false)
  assert.equal(suggestsRemoval(j), false)
  assert.equal(isUnsure(j, { lowConfidence: 0.7, excluded: 0.7 }), true)
  assert.equal(suggestsRemoval(j, { lowConfidence: 0.5, excluded: 0.6 }), true)
})

test('custom role criteria are what Jev is asked with', () => {
  const roles = { core: '核心：PR 要做的事', defense: '防御：出错时才用到', support: '支撑：不改变行为' }
  const { questions } = buildRequest({
    pr: { title: 't', body: '' },
    policy: null,
    path: 'a.ts',
    source: ['const a = 1'],
    unit: { id: 'U1', start: 1, end: 1 } as never,
    blocks: [{ id: 'B1', unit: 'U1', lines: [1] } as never],
    roles,
  })
  assert.match(JSON.stringify(questions.B1_role), /核心：PR 要做的事/)
  assert.doesNotMatch(JSON.stringify(questions.B1_role), /Implements what the PR is for/)
})
