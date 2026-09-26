import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

test('desktop launch retries missing gh executables but preserves authentication errors', async () => {
  const calls: string[] = []
  let failure: string | undefined
  const key = '__yolkGhTest'
  ;(globalThis as any)[key] = (file: string, _args: string[], options: object, callback: Function) => {
    calls.push(file)
    assert.equal((options as any).windowsHide, true)
    const code = failure ?? (calls.length === 1 ? 'ENOENT' : undefined)
    callback(code ? Object.assign(new Error(code), { code }) : null, { stdout: 'test-user\n' })
  }
  const url = `data:text/javascript,${encodeURIComponent(`export const execFile = globalThis.${key}`)}`
  const hooks = registerHooks({ resolve: (specifier, context, next) => specifier === 'node:child_process' ? { url, shortCircuit: true } : next(specifier, context) })
  try {
    const { currentUser } = await import('../src/core/sources/gh')
    assert.equal(await currentUser(), 'test-user')
    assert.equal(calls.length, 2)
    failure = 'EAUTH'
    calls.length = 0
    await assert.rejects(currentUser(), /EAUTH/)
    assert.equal(calls.length, 1)
    failure = 'ENOENT'
    await assert.rejects(currentUser(), /找不到 GitHub CLI/)
  } finally {
    hooks.deregister()
    delete (globalThis as any)[key]
  }
})
