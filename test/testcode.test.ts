import { test } from 'node:test'
import assert from 'node:assert/strict'
import { languageById } from '../src/core/languages'
import { inlineTestRanges, isTestPath } from '../src/core/testcode'

test('test files are recognized by path', () => {
  const tests = [
    'src/middleware/pretty-json/index.test.ts',
    'src/app.spec.tsx',
    'src/__tests__/app.ts',
    'tests/test_helpers.py',
    'pkg/conftest.py',
    'src/util_test.py',
    'axum/tests/integration.rs',
    'test/chunk.test.ts',
  ]
  const sources = ['src/core/chunk.ts', 'src/testing.py', 'src/attest.rs', 'src/latest/index.ts', 'contest.py']
  assert.deepEqual(tests.filter((p) => !isTestPath(p)), [])
  assert.deepEqual(sources.filter(isTestPath), [])
})

test('rust: #[cfg(test)] modules and #[test] functions are inline test code', async () => {
  const source = [
    'fn add(a: i32, b: i32) -> i32 {',
    '    a + b',
    '}',
    '',
    '#[tokio::test]',
    'async fn standalone() {',
    '    assert_eq!(add(1, 2), 3);',
    '}',
    '',
    '#[cfg(test)]',
    '/// Unit tests.',
    'mod tests {',
    '    use super::*;',
    '    #[test]',
    '    fn adds() {',
    '        assert_eq!(add(1, 1), 2);',
    '    }',
    '}',
  ].join('\n')
  assert.deepEqual(await inlineTestRanges(languageById('rust'), source), [[5, 8], [10, 18]])
})

test('languages without a test attribute have no inline test ranges', async () => {
  assert.deepEqual(await inlineTestRanges(languageById('python'), 'def test_x():\n    assert True\n'), [])
})
