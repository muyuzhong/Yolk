import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { registerHooks } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('settings preserve concurrent updates, normalize existing keys, and recover after a failed save', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'yolk-settings-'))
  const electron = `data:text/javascript,${encodeURIComponent(`
    export const app = { getPath: () => ${JSON.stringify(dir)} };
    export const safeStorage = { encryptString: s => Buffer.from(s), decryptString: b => b.toString() };
  `)}`
  const hooks = registerHooks({ resolve: (specifier, context, next) => specifier === 'electron' ? { url: electron, shortCircuit: true } : next(specifier, context) })
  try {
    const { saveConvention, saveSettings, settingsView, conventionFor } = await import('../src/main/settings')
    const file = join(dir, 'settings.json')
    await writeFile(file, JSON.stringify({ conventions: { default: 'fallback', repos: { 'Owner/Repo': 'old rule' } } }))
    assert.deepEqual(await conventionFor('OWNER/REPO'), { policy: 'old rule', policySource: 'repo' })
    await Promise.all([
      saveConvention('OWNER/Repo', 'new rule'),
      saveConvention('Git.Corp/Team/App', 'enterprise rule'),
      saveSettings({ jev: { model: 'test-model', apiKey: 'test-key' }, llm: { baseURL: '', model: '' } }),
      saveConvention(null, 'new default'),
    ])
    const view = await settingsView()
    assert.deepEqual(view.conventions, { default: 'new default', repos: { 'owner/repo': 'new rule', 'git.corp/team/app': 'enterprise rule' } })
    assert.deepEqual(view.jev, { model: 'test-model', hasKey: true })
    await saveConvention('OwNeR/RePo', '')
    assert.deepEqual(await conventionFor('OWNER/REPO'), { policy: 'new default', policySource: 'default' })
    const before = await readFile(file, 'utf8')
    await assert.rejects(saveConvention('broken/repo', null as unknown as string))
    assert.equal(await readFile(file, 'utf8'), before)
    await saveConvention('Owner/Recovered', 'saved')
    assert.equal((await conventionFor('OWNER/RECOVERED')).policy, 'saved')
  } finally {
    hooks.deregister()
    await rm(dir, { recursive: true, force: true })
  }
})
