// Prints each added block colored by Jev's judgment, for tuning questions and thresholds.
// Usage: TYPESAFE_API_KEY=... npm run judge -- <PR URL> [--convention <file>]
import { readFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { judgePullRequest, type FileResult } from '../src/core/analyze'
import { isUnsure, suggestsRemoval, type Role } from '../src/core/judgment'
import { blockIndex, color, dim, printHunks } from './print'

const { values, positionals } = parseArgs({ allowPositionals: true, options: { convention: { type: 'string' } } })
const [url] = positionals
const conventionPath = values.convention
if (!url) {
  console.error('用法：npm run judge -- <PR 链接> [--convention <约定文件>]')
  process.exit(1)
}

const LABEL: Record<Role, string> = { core: '核心', defense: '防御', support: '支撑' }
const COLOR: Record<Role, number> = { core: 33, defense: 34, support: 90 }
const TEST_COLOR = 32

const started = performance.now()
const policy = conventionPath ? await readFile(conventionPath, 'utf8') : undefined
const result = await judgePullRequest(url, { policy })
const seconds = ((performance.now() - started) / 1000).toFixed(1)

console.log(`${result.pr.owner}/${result.pr.repo}#${result.pr.number}  ${result.pr.title}`)
console.log(dim(`模型 ${result.model} · 输入 ${result.inputTokens} token · 耗时 ${seconds}s · 约定：${conventionPath ?? '无'}\n`))
for (const file of result.files) printFile(file)

function printFile(file: FileResult) {
  const { diff, chunks, judgments = {}, unitErrors = {}, testBlocks = [] } = file
  if (!chunks) {
    console.log(`━━ ${diff.path}  ${dim(`跳过：${file.skipped}`)}\n`)
    return
  }
  console.log(`━━ ${diff.path}  ${file.language}`)

  const index = blockIndex(file)
  printHunks(
    file,
    (line) => {
      const i = index.get(line.newNo!)
      if (i === undefined) return line.text.trim() ? { tag: '??', paint: 31 } : { tag: '', paint: null }
      const block = chunks.blocks[i]
      if (testBlocks.includes(block.id)) return { tag: `${block.id.padEnd(4)}测试`, paint: TEST_COLOR }
      const j = judgments[block.id]
      if (!j) return { tag: `${block.id} 未判断`, paint: 31 }
      const unsure = isUnsure(j)
      return {
        tag: `${block.id.padEnd(4)}${LABEL[j.role]}${unsure ? '?' : ' '}${suggestsRemoval(j) ? '✂' : ' '}`,
        paint: unsure ? `2;${COLOR[j.role]}` : COLOR[j.role],
      }
    },
    12,
  )

  for (const block of chunks.blocks) {
    const j = judgments[block.id]
    if (!j) continue
    const probs = (Object.keys(LABEL) as Role[]).map((r) => `${LABEL[r]} ${j.probabilities[r].toFixed(2)}`).join(' ')
    const excluded = j.excluded === null ? '' : `  约定排除 ${j.excluded.toFixed(2)}${suggestsRemoval(j) ? ' ✂' : ''}`
    console.log(color(COLOR[j.role], `  ${block.id.padEnd(4)}${LABEL[j.role]} 置信度 ${j.confidence.toFixed(2)}  (${probs})${excluded}`))
  }
  if (testBlocks.length) console.log(color(TEST_COLOR, `  测试代码 ${testBlocks.length} 块，不做判断`))
  for (const [unit, error] of Object.entries(unitErrors)) console.log(color(31, `  ${unit} 判断失败：${error}`))
  console.log()
}
