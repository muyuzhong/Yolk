import { test } from 'node:test'
import assert from 'node:assert/strict'
import { href, parentOf, parseRoute, pullRequestUrl, repositoryUrl, type Route } from '../src/renderer/src/route'

const routes: Route[] = [
  { page: 'home' },
  { page: 'repos' },
  { page: 'repo', repo: 'honojs/hono' },
  { page: 'repo', repo: 'git.corp.example/team/app' },
  { page: 'review', repo: 'honojs/hono', number: 5377 },
  { page: 'review', repo: 'git.corp.example/team/app', number: 12 },
]

test('every route survives href -> parseRoute', () => {
  for (const route of routes) assert.deepEqual(parseRoute(href(route)), route)
})

test('empty and unknown hashes go home', () => {
  assert.deepEqual(parseRoute(''), { page: 'home' })
  assert.deepEqual(parseRoute('#/nowhere'), { page: 'home' })
  assert.deepEqual(parseRoute('#/r/only-owner'), { page: 'home' })
})

test('GitHub and GitHub Enterprise URLs', () => {
  assert.equal(pullRequestUrl('honojs/hono', 5377), 'https://github.com/honojs/hono/pull/5377')
  assert.equal(repositoryUrl('git.corp.example/team/app'), 'https://git.corp.example/team/app')
})

test('back without an earlier page goes one level up, and stops at home', () => {
  assert.deepEqual(parentOf({ page: 'review', repo: 'honojs/hono', number: 5377 }), { page: 'repo', repo: 'honojs/hono' })
  assert.deepEqual(parentOf({ page: 'repo', repo: 'honojs/hono' }), { page: 'repos' })
  assert.deepEqual(parentOf({ page: 'repos' }), { page: 'home' })
  assert.equal(parentOf({ page: 'home' }), undefined)
})
