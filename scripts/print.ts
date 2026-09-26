import type { FileResult } from '../src/core/analyze'
import type { DiffLine } from '../src/core/diff'

export const color = (code: number | string, text: string) => `\x1b[${code}m${text}\x1b[0m`
export const dim = (text: string) => color(2, text)

/** Terminal columns taken by `text`, counting CJK characters as two. */
const columns = (text: string) => [...text].reduce((n, ch) => n + (ch.codePointAt(0)! >= 0x2e80 ? 2 : 1), 0)
export const pad = (text: string, width: number) => text + ' '.repeat(Math.max(0, width - columns(text)))

/** Tag and ANSI color for an added line; `paint: null` leaves it uncolored. */
export type Gutter = (line: DiffLine) => { tag: string; paint: number | string | null }

export function printHunks(file: FileResult, gutter: Gutter, width: number) {
  const blank = ' '.repeat(width + 1)
  for (const hunk of file.diff.hunks) {
    console.log(dim(hunk.header))
    for (const line of hunk.lines) {
      const nos = dim(`${String(line.oldNo ?? '').padStart(5)} ${String(line.newNo ?? '').padStart(5)}`)
      if (line.kind === 'del') console.log(`${blank}${nos} ${color(31, `-${line.text}`)}`)
      else if (line.kind === 'ctx') console.log(`${blank}${nos}  ${dim(line.text)}`)
      else {
        const { tag, paint } = gutter(line)
        const paintText = (t: string) => (paint === null ? t : color(paint, t))
        console.log(` ${paintText(pad(tag, width))}${nos} ${paintText(`+${line.text}`)}`)
      }
    }
  }
}

/** Maps each added line number to its block index. */
export function blockIndex(file: FileResult) {
  const index = new Map<number, number>()
  file.chunks?.blocks.forEach((b, i) => b.lines.forEach((line) => index.set(line, i)))
  return index
}
