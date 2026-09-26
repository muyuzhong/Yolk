// Prints how a PR is chunked into blocks and judgment units, for tuning chunk.ts by eye.
// Usage: npm run chunk -- <PR URL>
import { chunkPullRequest, type FileResult } from '../src/core/analyze'

const url = process.argv[2]
if (!url) {
  console.error('用法：npm run chunk -- <PR 链接>')
  process.exit(1)
}

const PALETTE = [33, 36, 35, 32, 34, 93, 96, 95]
const color = (code: number, text: string) => `\x1b[${code}m${text}\x1b[0m`
const dim = (text: string) => color(2, text)

const { pr, files } = await chunkPullRequest(url)
console.log(`${pr.owner}/${pr.repo}#${pr.number}  ${pr.title}\n`)
for (const file of files) printFile(file)

function printFile({ diff, language, chunks, skipped }: FileResult) {
  const title = `━━ ${diff.path}  ${language ?? ''}`
  if (!chunks) {
    console.log(`${title}  ${dim(`跳过：${skipped}`)}\n`)
    return
  }
  console.log(`${title}  ${chunks.blocks.length} 块 · ${chunks.units.length} 个判断单元${chunks.hasError ? color(31, '  ⚠ 语法树有错误节点') : ''}`)

  const blockOf = new Map<number, number>()
  chunks.blocks.forEach((b, i) => b.lines.forEach((line) => blockOf.set(line, i)))

  for (const hunk of diff.hunks) {
    console.log(dim(hunk.header))
    for (const line of hunk.lines) {
      const nos = `${String(line.oldNo ?? '').padStart(5)} ${String(line.newNo ?? '').padStart(5)}`
      if (line.kind === 'del') {
        console.log(`${' '.repeat(9)}${dim(nos)} ${color(31, `-${line.text}`)}`)
      } else if (line.kind === 'ctx') {
        console.log(`${' '.repeat(9)}${dim(nos)}  ${dim(line.text)}`)
      } else {
        const i = blockOf.get(line.newNo!)
        const block = i === undefined ? undefined : chunks.blocks[i]
        const tag = block
          ? `${block.id.padEnd(4)}${block.unit.padEnd(4)}`
          : line.text.trim() ? color(31, '??'.padEnd(8)) : ' '.repeat(8)
        const paint = (t: string) => (i === undefined ? t : color(PALETTE[i % PALETTE.length], t))
        console.log(` ${paint(tag)}${dim(nos)} ${paint(`+${line.text}`)}`)
      }
    }
  }

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
