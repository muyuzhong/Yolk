import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chunkFile } from '../src/core/chunk'
import { languageById } from '../src/core/languages'
import { explainMessages } from '../src/core/llm'

const source = [
  'import { db } from "./db"',
  'async function getUser(id) {',
  '  if (!id) throw new Error("id required");',
  '  return db.find(id);',
  '}',
]

async function messages(policy: string | null) {
  const chunks = await chunkFile(languageById('typescript'), source.join('\n'), [{ start: 1, end: 5, added: [2, 3, 4, 5] }])
  const block = chunks.blocks.find((b) => b.lines.includes(3))!
  const unit = chunks.units.find((u) => u.id === block.unit)!
  return explainMessages({ pr: { title: 'Add getUser' }, path: 'src/user.ts', source, unit, block, policy })
}

test('the block is marked with >> inside its whole unit', async () => {
  const [system, user] = await messages(null)
  assert.equal(system.role, 'system')
  assert.match(String(system.content), /中文写 2 到 4 句话/)
  assert.doesNotMatch(String(system.content), /约定/)
  assert.equal(
    String(user.content),
    [
      'PR：Add getUser',
      '文件：src/user.ts',
      '所在代码（行首是 >> 的是要解释的代码块）：',
      [
        '   async function getUser(id) {',
        '>>   if (!id) throw new Error("id required");',
        '     return db.find(id);',
        '   }',
      ].join('\n'),
    ].join('\n\n'),
  )
})

test('the convention and the extra instruction are included only for ✂ blocks', async () => {
  const [system, user] = await messages('MVP: validate input only at API boundaries.')
  assert.match(String(system.content), /约定为什么可能不需要它/)
  assert.match(String(user.content), /项目约定：\n\nMVP: validate input only at API boundaries\.$/)
})
