import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createStore } from '../src/renderer/src/store'

test('stores cache snapshots, invalidate before notifying, and unsubscribe', () => {
  let reads = 0
  const store = createStore(() => ({ version: ++reads }))
  assert.equal(reads, 0)
  const first = store.getSnapshot()
  assert.equal(store.getSnapshot(), first)
  let notified = 0
  const unsubscribe = store.subscribe(() => { notified++; assert.equal(store.getSnapshot().version, 2) })
  store.notify()
  assert.equal(notified, 1)
  assert.notEqual(store.getSnapshot(), first)
  unsubscribe()
  store.notify()
  assert.equal(notified, 1)
  assert.equal(store.getSnapshot().version, 3)
})
