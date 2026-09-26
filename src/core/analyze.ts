import { TypeSafeClient } from '@typesafe-ai/sdk'
import { chunkFile, type Chunks, type HunkRange } from './chunk'
import { parseDiff, type FileDiff } from './diff'
import { judgeUnit } from './jev'
import type { Judgment, Role } from './judgment'
import { languageFor } from './languages'
import { getFileAt, getPullRequest, getPullRequestDiff, type PullRequest } from './sources/gh'
import { inlineTestRanges, isTestPath } from './testcode'

export interface FileResult {
  diff: FileDiff
  language?: string
  chunks?: Chunks
  /** Lines of the new version, present when the file was chunked. */
  source?: string[]
  /** Why the file is shown as a plain diff. */
  skipped?: string
  /** Blocks of test code: labeled as tests, not judged, not folded. */
  testBlocks?: string[]
  /** Jev judgments by block id. */
  judgments?: Record<string, Judgment>
  /** Errors by unit id; the unit's blocks stay unjudged. */
  unitErrors?: Record<string, string>
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
    const chunks = await chunkFile(spec, source, hunks)
    const testRanges = isTestPath(diff.path) ? null : await inlineTestRanges(spec, source)
    const testBlocks = chunks.blocks
      .filter((b) => testRanges === null || testRanges.some(([start, end]) => start <= b.lines[0] && b.lines[0] <= end))
      .map((b) => b.id)
    return { diff, language: spec.id, chunks, source: source.split('\n'), testBlocks }
  })
  return { pr, files }
}

/** One judged (or failed) unit, reported as soon as its Jev request returns. */
export interface UnitResult {
  fileIndex: number
  unitId: string
  judgments?: Record<string, Judgment>
  error?: string
}

export interface JudgeOptions {
  policy: string | null
  client: TypeSafeClient
  /** Role criteria to ask with; the defaults when omitted. */
  roles?: Record<Role, string>
  signal?: AbortSignal
  onUnit?: (result: UnitResult) => void
}

/** Asks Jev about every judgment unit, at most 8 requests at a time; results are also merged into `files`. */
export async function judgeFiles(pr: PullRequest, files: FileResult[], { policy, client, roles, onUnit, signal }: JudgeOptions) {
  let model = ''
  let inputTokens = 0
  const tasks = files.flatMap((file, fileIndex) => file.chunks?.units.map((unit) => ({ file, fileIndex, unit })) ?? [])
  await mapLimit(tasks, 8, async ({ file, fileIndex, unit }) => {
    if (signal?.aborted) return
    const blocks = file.chunks!.blocks.filter((b) => b.unit === unit.id && !file.testBlocks!.includes(b.id))
    if (!blocks.length) return
    try {
      const result = await judgeUnit(client, { pr, policy, diff: file.diff, source: file.source!, unit, blocks, roles }, signal)
      if (signal?.aborted) return
      file.judgments = { ...file.judgments, ...result.judgments }
      model = result.model
      inputTokens += result.inputTokens
      onUnit?.({ fileIndex, unitId: unit.id, judgments: result.judgments })
    } catch (error) {
      if (signal?.aborted) return
      const message = error instanceof Error ? error.message : String(error)
      file.unitErrors = { ...file.unitErrors, [unit.id]: message }
      onUnit?.({ fileIndex, unitId: unit.id, error: message })
    }
  })
  return { model, inputTokens }
}

/** Chunks and judges a PR in one go, for the terminal scripts. The Jev key comes from TYPESAFE_API_KEY. */
export async function judgePullRequest(url: string, options: { policy?: string } = {}) {
  const { pr, files } = await chunkPullRequest(url)
  const policy = options.policy ?? null
  const { model, inputTokens } = await judgeFiles(pr, files, { policy, client: new TypeSafeClient() })
  return { pr, files, policy, model, inputTokens }
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
