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

async function messages(policy: string | null, cutGuard: boolean) {
  const chunks = await chunkFile(languageById('typescript'), source.join('\n'), [{ start: 1, end: 5, added: [2, 3, 4, 5] }])
  const guard = chunks.blocks.find((b) => b.lines.includes(3))!
  const unit = chunks.units.find((u) => u.id === guard.unit)!
  const blocks = chunks.blocks
    .filter((b) => b.unit === unit.id)
    .map((block) => ({ block, role: block === guard ? ('defense' as const) : ('core' as const), cut: cutGuard && block === guard }))
  return explainMessages({ pr: { title: 'Add getUser' }, path: 'src/user.ts', source, unit, blocks, policy })
}

test('the whole unit is sent with each line numbered and labeled with its category', async () => {
  const [system, user] = await messages(null, false)
  assert.equal(system.role, 'system')
  assert.match(String(system.content), /整体在做什么/)
  assert.match(String(system.content), /不超过 6 句/)
  assert.doesNotMatch(String(system.content), /约定/)
  const content = String(user.content)
  assert.match(content, /^PR：Add getUser\n\n文件：src\/user\.ts\n\n代码：函数 getUser\n\n/)
  assert.match(content, /^2 核心　　\| async function getUser\(id\) \{$/m)
  assert.match(content, /^3 防御　　\|   if \(!id\) throw new Error\("id required"\);$/m)
  assert.match(content, /^5 核心　　\| \}$/m)
  assert.doesNotMatch(content, /项目约定/)
})

test('the convention and the ✂ instruction come along only when a block in the unit has ✂', async () => {
  const [system, user] = await messages('MVP: validate input only at API boundaries.', true)
  assert.match(String(system.content), /约定为什么可能不需要它们/)
  assert.match(String(user.content), /^3 防御 ✂\|/m)
  assert.match(String(user.content), /项目约定：\n\nMVP: validate input only at API boundaries\.$/)
})
