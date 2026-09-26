import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import type { Parser as ParserT, Query as QueryT } from '@vscode/tree-sitter-wasm'

const require = createRequire(import.meta.url)
const { Parser, Language, Query } = require('@vscode/tree-sitter-wasm') as typeof import('@vscode/tree-sitter-wasm')

/** Per-language exceptions to the generic chunking rules in chunk.ts (DESIGN.md §6.3). */
export interface LangSpec {
  id: string
  grammar: string
  /** tags.scm files concatenated in order; they supply function boundaries. */
  tags: string[]
  /** Statement-level node types that the generic suffix rule misses. */
  extraUnits: string[]
  /** Node types the suffix rule matches but that should not split a block. */
  notUnits: string[]
  /** Every named child of these node types is a unit. */
  unitParents: string[]
  /** Always one block regardless of size. */
  collapse: string[]
  /** Besides comments: nodes that belong to the unit right after them (attributes, decorators). */
  attachToNext: string[]
  /** Anonymous function node types; long ones become judgment units (DESIGN.md §6.2). */
  anonymousFunctions: string[]
  /** A function wrapped in one of these (e.g. decorators) extends to the wrapper. */
  wrappers: string[]
}

const base = { extraUnits: [], notUnits: [], unitParents: [], collapse: [], wrappers: [], attachToNext: [], anonymousFunctions: [] }

const ecmascript = {
  ...base,
  extraUnits: ['switch_case', 'switch_default'],
  collapse: ['catch_clause', 'finally_clause'],
  attachToNext: ['decorator'],
  anonymousFunctions: ['arrow_function', 'function_expression'],
}

const LANGS: Record<string, LangSpec> = {
  typescript: { ...ecmascript, id: 'typescript', grammar: 'typescript', tags: ['javascript', 'typescript'] },
  tsx: { ...ecmascript, id: 'tsx', grammar: 'tsx', tags: ['javascript', 'typescript'] },
  javascript: { ...ecmascript, id: 'javascript', grammar: 'javascript', tags: ['javascript'] },
  python: {
    ...base,
    id: 'python',
    grammar: 'python',
    tags: ['python'],
    notUnits: ['with_clause', 'with_item'],
    collapse: ['except_clause', 'except_group_clause', 'finally_clause'],
    wrappers: ['decorated_definition'],
  },
  rust: {
    ...base,
    id: 'rust',
    grammar: 'rust',
    tags: ['rust'],
    // Control flow is expression-based in Rust; `block` children include the unterminated tail expression.
    extraUnits: ['if_expression', 'match_expression', 'for_expression', 'while_expression', 'loop_expression', 'match_arm', 'macro_invocation'],
    unitParents: ['block'],
    attachToNext: ['attribute_item'],
    anonymousFunctions: ['closure_expression'],
  },
}

const EXTENSIONS: Record<string, string> = {
  '.ts': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.pyi': 'python',
  '.rs': 'rust',
}

export function languageFor(path: string): LangSpec | undefined {
  return LANGS[EXTENSIONS[extname(path)]]
}

export function languageById(id: string): LangSpec {
  return LANGS[id]
}

export interface Grammar {
  parser: ParserT
  tags: QueryT
}

let init: Promise<void> | undefined
const grammars = new Map<string, Promise<Grammar>>()

export function loadGrammar(spec: LangSpec): Promise<Grammar> {
  let grammar = grammars.get(spec.id)
  if (!grammar) {
    grammar = load(spec)
    grammars.set(spec.id, grammar)
  }
  return grammar
}

async function load(spec: LangSpec): Promise<Grammar> {
  init ??= Parser.init()
  await init
  const language = await Language.load(require.resolve(`@vscode/tree-sitter-wasm/wasm/tree-sitter-${spec.grammar}.wasm`))
  const parser = new Parser()
  parser.setLanguage(language)
  const sources = await Promise.all(
    spec.tags.map((name) => readFile(new URL(`./queries/${name}-tags.scm`, import.meta.url), 'utf8')),
  )
  return { parser, tags: new Query(language, sources.join('\n')) }
}
