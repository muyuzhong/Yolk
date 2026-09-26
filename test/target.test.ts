import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseTarget } from '../src/renderer/src/target'

test('PR links open the PR and remember its repository', () => {
  assert.deepEqual(parseTarget(' https://github.com/honojs/hono/pull/5377/files '), { kind: 'pr', repo: 'honojs/hono', number: 5377 })
})

test('repository links and owner/repo open the repository', () => {
  assert.deepEqual(parseTarget('https://github.com/tokio-rs/axum'), { kind: 'repo', repo: 'tokio-rs/axum' })
  assert.deepEqual(parseTarget('https://github.com/tokio-rs/axum.git'), { kind: 'repo', repo: 'tokio-rs/axum' })
  assert.deepEqual(parseTarget('https://github.com/tokio-rs/axum/issues'), { kind: 'repo', repo: 'tokio-rs/axum' })
  assert.deepEqual(parseTarget('pallets/flask'), { kind: 'repo', repo: 'pallets/flask' })
})

test('GitHub Enterprise links keep the host, as gh -R expects', () => {
  assert.deepEqual(parseTarget('https://git.corp.example/team/app'), { kind: 'repo', repo: 'git.corp.example/team/app' })
})

test('anything else is only a filter', () => {
  assert.equal(parseTarget('yolk'), null)
  assert.equal(parseTarget(''), null)
})
