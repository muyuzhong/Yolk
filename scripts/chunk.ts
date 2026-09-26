// Prints how a PR is chunked into blocks and judgment units, for tuning chunk.ts by eye.
// Usage: npm run chunk -- <PR URL>
import { chunkPullRequest, type FileResult } from '../src/core/analyze'
import { blockIndex, color, dim, printHunks } from './print'

const url = process.argv[2]
if (!url) {
  console.error('用法：npm run chunk -- <PR 链接>')
  process.exit(1)
}

const PALETTE = [33, 36, 35, 32, 34, 93, 96, 95]

const { pr, files } = await chunkPullRequest(url)
console.log(`${pr.owner}/${pr.repo}#${pr.number}  ${pr.title}\n`)
for (const file of files) printFile(file)

function printFile(file: FileResult) {
  const { diff, language, chunks, skipped } = file
  const title = `━━ ${diff.path}  ${language ?? ''}`
  if (!chunks) {
    console.log(`${title}  ${dim(`跳过：${skipped}`)}\n`)
    return
  }
  console.log(`${title}  ${chunks.blocks.length} 块 · ${chunks.units.length} 个判断单元${chunks.hasError ? color(31, '  ⚠ 语法树有错误节点') : ''}`)

  const index = blockIndex(file)
  printHunks(
    file,
    (line) => {
      const i = index.get(line.newNo!)
      if (i !== undefined) return { tag: `${chunks.blocks[i].id} ${chunks.blocks[i].unit}`, paint: PALETTE[i % PALETTE.length] }
      return line.text.trim() ? { tag: '??', paint: 31 } : { tag: '', paint: null }
    },
    8,
  )

  for (const unit of chunks.units) {
    const label = unit.kind === 'function' ? `函数 ${unit.name}` : '顶层改动'
    console.log(`  ${unit.id} ${label}  L${unit.start}–${unit.end}  ${unit.blocks.join(' ')}`)
  }
  for (const block of chunks.blocks) {
    console.log(dim(`  ${block.id} ${block.nodeType}  L${block.lines.join(',')}`))
  }
  if (chunks.unowned.length) console.log(color(31, `  没有归属的新增行：${chunks.unowned.join(', ')}`))
  console.log()
}
