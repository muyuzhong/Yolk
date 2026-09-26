import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chunkFile, type Chunks } from '../src/core/chunk'
import { languageById } from '../src/core/languages'

/** Chunks `code` with every line (or only `added`) marked as added, in a single hunk. */
function chunk(lang: string, code: string[], added?: number[]): Promise<Chunks> {
  const all = added ?? code.map((_, i) => i + 1)
  return chunkFile(languageById(lang), code.join('\n'), [{ start: 1, end: code.length, added: all }])
}

const blockLines = (c: Chunks) => c.blocks.map((b) => b.lines)
const units = (c: Chunks) => c.units.map((u) => [u.kind, u.name, u.blocks])

const getUser = [
  'async function getUser(id) {',
  "  if (!id) throw new Error('id required');",
  '  try {',
  '    const res = await fetch(`/api/users/${id}`);',
  '    return await res.json();',
  '  } catch (err) {',
  '    console.error(err);',
  '    return null;',
  '  }',
  '}',
]

test('typescript: frame, guard, try frame, statements, collapsed catch (DESIGN.md example)', async () => {
  const c = await chunk('typescript', getUser)
  assert.deepEqual(blockLines(c), [[1, 10], [2], [3], [4], [5], [6, 7, 8, 9]])
  assert.deepEqual(units(c), [['function', 'getUser', ['B1', 'B2', 'B3', 'B4', 'B5', 'B6']]])
  assert.deepEqual(c.unowned, [])
})

test('typescript: only added lines become blocks', async () => {
  const c = await chunk('typescript', getUser, [4, 5])
  assert.deepEqual(blockLines(c), [[4], [5]])
})

test('typescript: compound statements of 3 lines or fewer stay whole', async () => {
  const c = await chunk('typescript', [
    'function f(x) {',
    '  if (!x) {',
    '    return null;',
    '  }',
    '  const y = g(x);',
    '  return y;',
    '}',
  ])
  assert.deepEqual(blockLines(c), [[1, 7], [2, 3, 4], [5], [6]])
})

test('typescript: methods are their own units, class frame and top level share a hunk unit', async () => {
  const c = await chunk('typescript', [
    'const LIMIT = 10;',
    'class Repo {',
    '  find(id) {',
    '    return db.get(id);',
    '  }',
    '  save(x) {',
    '    db.put(x);',
    '  }',
    '}',
  ])
  assert.deepEqual(blockLines(c), [[1], [2, 9], [3, 4, 5], [6, 7, 8]])
  assert.deepEqual(units(c), [
    ['toplevel', '', ['B1', 'B2']],
    ['function', 'find', ['B3']],
    ['function', 'save', ['B4']],
  ])
})

test('python: decorator, guard, try, collapsed except, comment attached to next statement', async () => {
  const c = await chunk('python', [
    '@app.get("/users/{id}")',
    'def get_user(id):',
    '    if not id:',
    '        raise ValueError("id required")',
    '    try:',
    '        user = db.find(id)',
    '    except DbError as e:',
    '        log.error(e)',
    '        return None',
    '    # found',
    '    return user',
  ])
  assert.deepEqual(blockLines(c), [[1, 2], [3, 4], [5], [6], [7, 8, 9], [10, 11]])
  assert.deepEqual(units(c), [['function', 'get_user', ['B1', 'B2', 'B3', 'B4', 'B5', 'B6']]])
})

test('python: with header stays with the with statement', async () => {
  const c = await chunk('python', [
    'def read(p):',
    '    with open(p) as f:',
    '        data = f.read()',
    '        data = data.strip()',
    '        return parse(data)',
  ])
  assert.deepEqual(blockLines(c), [[1], [2], [3], [4], [5]])
  assert.equal(c.blocks[1].nodeType, 'with_statement')
})

test('rust: match arms, tail expression, expression-based control flow', async () => {
  const c = await chunk('rust', [
    'fn load(id: u32) -> Result<User> {',
    '    let user = match db.find(id) {',
    '        Ok(u) => u,',
    '        Err(e) => {',
    '            log::warn!("missing {}", id);',
    '            return Err(e.into());',
    '        }',
    '    };',
    '    let name = user.name.clone();',
    '    Ok(user)',
    '}',
  ])
  assert.deepEqual(blockLines(c), [[1, 11], [2, 8], [3], [4, 7], [5], [6], [9], [10]])
  assert.deepEqual(units(c), [['function', 'load', ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8']]])
  assert.deepEqual(c.unowned, [])
})

test('rust: attributes and doc comments belong to the item below', async () => {
  const c = await chunk('rust', [
    'use std::io;',
    '',
    '/// Loads it.',
    '#[tokio::test]',
    '#[ignore]',
    'async fn loads() {',
    '    let a = 1;',
    '    let b = 2;',
    '    assert_eq!(a + 1, b);',
    '}',
  ])
  assert.deepEqual(blockLines(c), [[1], [3, 4, 5, 6, 10], [7], [8], [9]])
  assert.deepEqual(units(c), [
    ['toplevel', '', ['B1']],
    ['function', 'loads', ['B2', 'B3', 'B4', 'B5']],
  ])
})

test('typescript: consecutive comments belong to the statement below; trailing comment to the enclosing frame', async () => {
  const c = await chunk('typescript', [
    'function f() {',
    '  // first line of the explanation',
    '  // second line',
    '  const a = load();',
    '  const b = {',
    '    // inside an object literal',
    '    x: 1,',
    '    y: 2,',
    '  };',
    '  return a;',
    '  // trailing',
    '}',
  ])
  assert.deepEqual(blockLines(c), [[1, 11, 12], [2, 3, 4], [5, 6, 7, 8, 9], [10]])
})

test('typescript: long callbacks are judgment units, short ones stay in their parent', async () => {
  const c = await chunk('typescript', [
    "describe('api', () => {",
    "  it('returns the user', async () => {",
    '    const app = new App()',
    "    app.get('/x', (c) => {",
    '      return c.json(user)',
    '    })',
    "    const res = await app.request('/x')",
    '    expect(res.status).toBe(200)',
    '  })',
    '})',
  ])
  assert.deepEqual(units(c), [
    ['function', "describe('api', () => {", ['B1']],
    ['function', "it('returns the user', async () => {", ['B2', 'B3', 'B4', 'B5', 'B6']],
  ])
})

test('blank added lines belong to no block and are not reported', async () => {
  const c = await chunk('typescript', ['const a = 1;', '', 'const b = 2;'])
  assert.deepEqual(blockLines(c), [[1], [3]])
  assert.deepEqual(c.unowned, [])
})
