import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rememberReview } from '../src/renderer/src/reviewed'

test('failed and pending reviews preserve the last successful summary', (t) => {
  const values = new Map<string, string>()
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  } })
  t.after(() => previous ? Object.defineProperty(globalThis, 'localStorage', previous) : Reflect.deleteProperty(globalThis, 'localStorage'))
  const url = 'https://github.com/owner/repo/pull/1'
  rememberReview(url, { core: 12, defense: 3 })
  const saved = values.get('yolk.reviewedPullRequests')!
  for (const counts of [{ failed: 4 }, { core: 2, failed: 1 }, { core: 2, pending: 1 }]) {
    rememberReview(url, counts)
    assert.equal(values.get('yolk.reviewedPullRequests'), saved)
  }
  rememberReview(url, { core: 0, support: 5 })
  assert.equal(JSON.parse(values.get('yolk.reviewedPullRequests')!)[url].core, 0)
})
