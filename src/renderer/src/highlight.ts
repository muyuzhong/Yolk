import { bundledLanguagesInfo, createHighlighter, type BundledLanguage, type ThemedToken } from 'shiki'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import type { Hunk } from '../../core/diff'

const THEMES = { light: 'github-light', dark: 'github-dark' } as const

const highlighter = createHighlighter({
  themes: Object.values(THEMES),
  langs: [],
  engine: createJavaScriptRegexEngine(),
})

function languageOf(path: string): BundledLanguage | 'text' {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  const info = bundledLanguagesInfo.find((l) => l.id === ext || l.aliases?.includes(ext))
  return (info?.id as BundledLanguage | undefined) ?? 'text'
}

/**
 * Tokens keyed like rows (`h{hunk}l{line}`). Each hunk's new side and old side are highlighted as
 * separate snippets, so constructs that start above a hunk may be colored imperfectly.
 */
export async function highlightHunks(path: string, hunks: Hunk[]): Promise<Map<string, ThemedToken[]>> {
  const shiki = await highlighter
  const lang = languageOf(path)
  if (lang !== 'text') await shiki.loadLanguage(lang)

  const tokens = new Map<string, ThemedToken[]>()
  hunks.forEach((hunk, h) => {
    for (const side of ['add', 'del'] as const) {
      const indexes = hunk.lines.flatMap((line, i) => (line.kind === side || line.kind === 'ctx' ? [i] : []))
      const code = indexes.map((i) => hunk.lines[i].text).join('\n')
      const lines = shiki.codeToTokens(code, { lang, themes: THEMES }).tokens
      indexes.forEach((i, n) => {
        if (side === 'add' || hunk.lines[i].kind === 'del') tokens.set(`h${h}l${i}`, lines[n] ?? [])
      })
    }
  })
  return tokens
}
