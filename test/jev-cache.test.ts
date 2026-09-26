import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TypeSafeClient } from '@typesafe-ai/sdk'
import { judgeFiles, type FileResult } from '../src/core/analyze'
import { judgeUnit, type UnitInput } from '../src/core/jev'
import { DEFAULT_ROLE_CRITERIA } from '../src/core/judgment'
import { parseDiff } from '../src/core/diff'

const pr = { host: 'github.com', owner: 'o', repo: 'r', number: 1, title: 'Load data', body: 'Use the database', url: 'https://github.com/o/r/pull/1', baseSha: 'a', headSha: 'b' }
const source = ['const first = load()', '', 'const second = save()']
const [diff] = parseDiff('diff --git a/a.ts b/a.ts\n@@ -1 +1 @@\n-const first = old()\n+const first = load()\n@@ -3 +3 @@\n-const second = old()\n+const second = save()')
const blocks = [1, 3].map((line, i) => ({ id: `B${i + 1}`, lines: [line], nodeType: 'lexical_declaration', unit: `U${i + 1}` }))
const units = blocks.map(b => ({ id: b.unit, kind: 'toplevel' as const, name: '', start: b.lines[0], end: b.lines[0], blocks: [b.id] }))
const input: UnitInput = { pr, source, diff, blocks: [blocks[0]], unit: units[0], policy: null }
const file: FileResult = { source, diff, chunks: { blocks, units, unowned: [], hasError: false }, testBlocks: [] }

function mockJev() {
  let calls = 0
  let failSecond = false
  const client = (defaultModel = 'jev-test', baseURL = 'https://jev.test') => new TypeSafeClient({
    apiKey: 'test-secret', defaultModel, baseURL, retry: { maxRetries: 0 },
    fetch: async (_url, init) => {
      calls++
      const request = JSON.parse(init!.body as string)
      if (failSecond && request.state.code.includes('second')) return new Response('unavailable', { status: 503 })
      const answers = Object.fromEntries(Object.keys(request.questions).map(key => [key, key.endsWith('_excluded') ? { noul: 0.1 } : {
        choice: 'core', confidence: 0.9, probabilities: { core: 0.9, defense: 0.05, support: 0.05 },
      }]))
      return Response.json({ answers, model: request.model, usage: { input_tokens: 10 } })
    },
  })
  return { client, calls: () => calls, fail: (value: boolean) => { failSecond = value } }
}

test('disk cache survives clients, keys every request input, and recovers from corrupt entries', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'yolk-jev-cache-'))
  const api = mockJev()
  const run = (value = input, model?: string, baseURL?: string) => judgeUnit(api.client(model, baseURL), value, undefined, dir)
  try {
    const first = await run()
    const saved = join(dir, (await readdir(dir))[0])
    assert.equal(first.inputTokens, 10)
    assert.deepEqual(await run(), { ...first, inputTokens: 0, cached: true })
    assert.equal(api.calls(), 1)
    assert.deepEqual(Object.keys(JSON.parse(await readFile(saved, 'utf8'))).sort(), ['judgments', 'model'])
    for (const changed of [
      { ...input, pr: { ...pr, title: 'Another goal' } },
      { ...input, pr: { ...pr, body: 'Another description' } },
      { ...input, source: ['const first = fetch()', ...source.slice(1)] },
      { ...input, diff: { ...diff, path: 'renamed.ts' } },
      { ...input, diff: { ...diff, hunks: [{ ...diff.hunks[0], lines: diff.hunks[0].lines.map(l => l.kind === 'del' ? { ...l, text: 'const first = cache()' } : l) }] } },
      { ...input, policy: 'No retries' },
      { ...input, roles: { ...DEFAULT_ROLE_CRITERIA, core: 'New criteria' } },
    ]) {
      const before = api.calls()
      assert.equal((await run(changed)).cached, false)
      assert.equal(api.calls(), before + 1)
    }
    assert.equal((await run(input, 'another-model')).cached, false)
    assert.equal((await run(input, undefined, 'https://another.test')).cached, false)
    for (const damaged of ['{', JSON.stringify({ model: 'jev-test', judgments: { B1: { role: 'core', confidence: 42 } } })]) {
      await writeFile(saved, damaged)
      assert.equal((await run()).cached, false)
      assert.equal((await run()).cached, true)
    }
    const before = api.calls()
    await assert.rejects(judgeUnit(api.client(), input, AbortSignal.abort(), dir), { name: 'AbortError' })
    assert.equal(api.calls(), before)
    assert.ok((await readdir(dir)).every(name => name.endsWith('.json')))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('reopening replays successful units, retries only failures, and tolerates unwritable cache', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'yolk-jev-cache-'))
  const api = mockJev()
  const run = async () => {
    const files = [structuredClone(file)]
    const seen: string[] = []
    const result = await judgeFiles(pr, files, { policy: null, client: api.client(), cacheDir: dir, onUnit: u => { seen.push(u.unitId) } })
    assert.deepEqual(seen.sort(), ['U1', 'U2'])
    return { ...result, file: files[0] }
  }
  try {
    api.fail(true)
    const first = await run()
    assert.equal(first.cachedUnits, 0)
    assert.ok(first.file.unitErrors?.U2)
    assert.equal(api.calls(), 2)
    api.fail(false)
    const second = await run()
    assert.equal(second.cachedUnits, 1)
    assert.equal(second.inputTokens, 10)
    assert.equal(second.file.unitErrors, undefined)
    assert.equal(api.calls(), 3)
    const third = await run()
    assert.equal(third.cachedUnits, 2)
    assert.equal(third.inputTokens, 0)
    assert.deepEqual(third.file.judgments, second.file.judgments)
    assert.equal(api.calls(), 3)
    const notDirectory = join(dir, 'not-a-directory')
    await writeFile(notDirectory, '')
    const warning = t.mock.method(console, 'warn', () => {})
    assert.equal((await judgeUnit(api.client(), input, undefined, notDirectory)).inputTokens, 10)
    assert.equal(warning.mock.callCount(), 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
