import { chunkFile, type Chunks, type HunkRange } from './chunk'
import { parseDiff, type FileDiff } from './diff'
import { languageFor } from './languages'
import { getFileAt, getPullRequest, getPullRequestDiff, type PullRequest } from './sources/gh'

export interface FileResult {
  diff: FileDiff
  language?: string
  chunks?: Chunks
  /** Why the file is shown as a plain diff. */
  skipped?: string
}

export interface PullRequestChunks {
  pr: PullRequest
  files: FileResult[]
}

export async function chunkPullRequest(url: string): Promise<PullRequestChunks> {
  const [pr, diffText] = await Promise.all([getPullRequest(url), getPullRequestDiff(url)])
  const files = await mapLimit(parseDiff(diffText), 8, async (diff): Promise<FileResult> => {
    const spec = languageFor(diff.path)
    const hunks = hunkRanges(diff)
    if (diff.binary) return { diff, skipped: '二进制文件' }
    if (diff.status === 'deleted') return { diff, skipped: '文件已删除' }
    if (!spec) return { diff, skipped: '暂不支持的语言' }
    if (!hunks.some((h) => h.added.length)) return { diff, language: spec.id, skipped: '没有新增行' }
    const source = await getFileAt(pr, diff.path, pr.headSha)
    return { diff, language: spec.id, chunks: await chunkFile(spec, source, hunks) }
  })
  return { pr, files }
}

export function hunkRanges(diff: FileDiff): HunkRange[] {
  return diff.hunks.map((hunk) => {
    const newLines = hunk.lines.flatMap((l) => (l.newNo === null ? [] : [l.newNo]))
    return {
      start: newLines[0] ?? 0,
      end: newLines[newLines.length - 1] ?? 0,
      added: hunk.lines.flatMap((l) => (l.kind === 'add' ? [l.newNo!] : [])),
    }
  })
}

export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}
