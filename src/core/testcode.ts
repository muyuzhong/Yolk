import type { Node } from '@vscode/tree-sitter-wasm'
import { loadGrammar, type LangSpec } from './languages'

// Test code is labeled here in code, never judged by Jev and never folded (DESIGN.md §7.4).
const TEST_PATHS = [
  /(^|\/)(__tests__|tests?|spec)\//,
  /\.(test|spec)\.[cm]?[jt]sx?$/,
  /(^|\/)test_[^/]*\.py$/,
  /_test\.py$/,
  /(^|\/)conftest\.py$/,
]

export function isTestPath(path: string): boolean {
  return TEST_PATHS.some((pattern) => pattern.test(path))
}

/** 1-based inclusive line ranges of test code inside a source file, e.g. Rust `#[cfg(test)] mod tests`. */
export async function inlineTestRanges(spec: LangSpec, source: string): Promise<[number, number][]> {
  if (!spec.testAttribute) return []
  const { parser } = await loadGrammar(spec)
  const tree = parser.parse(source)!
  try {
    const ranges: [number, number][] = []
    const walk = (n: Node) => {
      const line = n.startPosition.row + 1
      if (ranges.some(([start, end]) => start <= line && line <= end)) return
      if (spec.attachToNext.includes(n.type) && spec.testAttribute!.test(n.text)) {
        let item = n.nextNamedSibling
        while (item && (spec.attachToNext.includes(item.type) || /comment$/.test(item.type))) item = item.nextNamedSibling
        if (item) {
          ranges.push([n.startPosition.row + 1, item.endPosition.row + 1])
          return
        }
      }
      for (const child of n.namedChildren) if (child) walk(child)
    }
    walk(tree.rootNode)
    return ranges
  } finally {
    tree.delete()
  }
}
