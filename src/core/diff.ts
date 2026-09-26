export type LineKind = 'add' | 'del' | 'ctx'

export interface DiffLine {
  kind: LineKind
  text: string
  oldNo: number | null
  newNo: number | null
}

export interface Hunk {
  header: string
  lines: DiffLine[]
}

export interface FileDiff {
  path: string
  oldPath: string
  status: 'added' | 'deleted' | 'modified' | 'renamed'
  binary: boolean
  hunks: Hunk[]
}

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

/** Keep complete hunks touching a new-side range, including their removed lines. */
export function diffForRange(diff: FileDiff, start: number, end: number): string {
  const prefix = { add: '+', del: '-', ctx: ' ' }
  return diff.hunks.filter((hunk) => {
    const newLines = hunk.lines.filter((line) => line.newNo !== null)
    const first = newLines[0]?.newNo ?? Number(HUNK_HEADER.exec(hunk.header)![2])
    // A deletion-only hunk sits between `first` and `first + 1` in the new file.
    const last = newLines.at(-1)?.newNo ?? first + 1
    return first <= end && last >= start
  }).map((hunk) => [hunk.header, ...hunk.lines.map((line) => prefix[line.kind] + line.text)].join('\n')).join('\n')
}

/** Git quotes paths with C escapes; octal escapes encode UTF-8 bytes. */
function decodePath(path: string): string {
  if (!path.startsWith('"')) return path
  const escapes: Record<string, string> = { a: '\x07', b: '\b', t: '\t', n: '\n', v: '\v', f: '\f', r: '\r', '"': '"', '\\': '\\' }
  const parts = path.slice(1, -1).match(/\\[0-7]{3}|\\.|[^\\]+/g) ?? []
  return Buffer.concat(parts.map((part) => {
    if (/^\\[0-7]{3}$/.test(part)) return Buffer.from([parseInt(part.slice(1), 8)])
    return Buffer.from(part.startsWith('\\') ? escapes[part[1]] : part)
  })).toString('utf8')
}

/** Parses a multi-file unified diff as printed by `git diff` / `gh pr diff`. */
export function parseDiff(text: string): FileDiff[] {
  const files: FileDiff[] = []
  let file: FileDiff | undefined
  let hunk: Hunk | undefined
  let oldNo = 0
  let newNo = 0

  for (const line of text.split('\n')) {
    if (line.startsWith('diff --git ')) {
      const [, oldPath, path] = /^diff --git ("(?:\\.|[^"\\])*"|a\/.*) ("(?:\\.|[^"\\])*"|b\/.*)$/.exec(line)!
      file = { path: decodePath(path).slice(2), oldPath: decodePath(oldPath).slice(2), status: 'modified', binary: false, hunks: [] }
      files.push(file)
      hunk = undefined
      continue
    }
    if (!file) continue

    const header = HUNK_HEADER.exec(line)
    if (header) {
      hunk = { header: line, lines: [] }
      file.hunks.push(hunk)
      oldNo = Number(header[1])
      newNo = Number(header[2])
      continue
    }

    if (!hunk) {
      if (line.startsWith('new file mode')) file.status = 'added'
      else if (line.startsWith('deleted file mode')) file.status = 'deleted'
      else if (line.startsWith('rename from ')) {
        file.status = 'renamed'
        file.oldPath = decodePath(line.slice('rename from '.length))
      } else if (line.startsWith('rename to ')) file.path = decodePath(line.slice('rename to '.length))
      else if (line.startsWith('Binary files ')) file.binary = true
      else if (line.startsWith('--- ') && line !== '--- /dev/null') file.oldPath = decodePath(line.slice(4).replace(/\t$/, '')).slice(2)
      else if (line.startsWith('+++ ') && line !== '+++ /dev/null') file.path = decodePath(line.slice(4).replace(/\t$/, '')).slice(2)
      continue
    }

    // "\ No newline at end of file" and the trailing empty string are skipped.
    if (line[0] === '+') hunk.lines.push({ kind: 'add', text: line.slice(1), oldNo: null, newNo: newNo++ })
    else if (line[0] === '-') hunk.lines.push({ kind: 'del', text: line.slice(1), oldNo: oldNo++, newNo: null })
    else if (line[0] === ' ') hunk.lines.push({ kind: 'ctx', text: line.slice(1), oldNo: oldNo++, newNo: newNo++ })
  }
  return files
}
