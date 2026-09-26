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

/** Parses a multi-file unified diff as printed by `git diff` / `gh pr diff`. */
export function parseDiff(text: string): FileDiff[] {
  const files: FileDiff[] = []
  let file: FileDiff | undefined
  let hunk: Hunk | undefined
  let oldNo = 0
  let newNo = 0

  for (const line of text.split('\n')) {
    if (line.startsWith('diff --git ')) {
      const [, oldPath, path] = /^diff --git a\/(.*) b\/(.*)$/.exec(line)!
      file = { path, oldPath, status: 'modified', binary: false, hunks: [] }
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
        file.oldPath = line.slice('rename from '.length)
      } else if (line.startsWith('rename to ')) file.path = line.slice('rename to '.length)
      else if (line.startsWith('Binary files ')) file.binary = true
      else if (line.startsWith('--- a/')) file.oldPath = line.slice(6)
      else if (line.startsWith('+++ b/')) file.path = line.slice(6)
      continue
    }

    // "\ No newline at end of file" and the trailing empty string are skipped.
    if (line[0] === '+') hunk.lines.push({ kind: 'add', text: line.slice(1), oldNo: null, newNo: newNo++ })
    else if (line[0] === '-') hunk.lines.push({ kind: 'del', text: line.slice(1), oldNo: oldNo++, newNo: null })
    else if (line[0] === ' ') hunk.lines.push({ kind: 'ctx', text: line.slice(1), oldNo: oldNo++, newNo: newNo++ })
  }
  return files
}
