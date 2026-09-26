import OpenAI from 'openai'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import type { Block, Unit } from './chunk'
import type { Role } from './judgment'

/** Any OpenAI-compatible chat completions endpoint (DESIGN.md §7.2). */
export interface LlmConfig {
  baseURL: string
  apiKey: string
  model: string
}

/** One block of the unit as the review shows it: its judged role (null until judged) and whether it has ✂. */
export interface ExplainedBlock {
  block: Block
  role: Role | 'test' | null
  cut: boolean
}

export interface ExplainInput {
  pr: { title: string }
  path: string
  /** Lines of the new version of the file. */
  source: string[]
  unit: Unit
  blocks: ExplainedBlock[]
  /** The project convention; passed only when some block in the unit has ✂. */
  policy: string | null
}

const TAG: Record<Role | 'test', string> = { core: '核心', defense: '防御', support: '支撑', test: '测试' }

const SYSTEM =
  '你在帮助审阅者读懂 PR 里的一段代码：一个函数，或一段顶层改动。' +
  '代码每行前面是行号和这一行的分类：核心是 PR 要做的事；防御只在出错时起作用；支撑不改变行为，比如类型、导入、日志；' +
  '测试是测试代码；分类为空表示这行没有改动或还没判断。' +
  '用中文回答，分两部分：先用一到两句话说明这段代码整体在做什么；再挑关键的几处说明，比如核心在做什么、防御在防什么，提到代码时写行号（如「第 12–15 行」）。' +
  '总共不超过 6 句。只解释，不评价写得好不好，不给修改建议，不复述代码，不用 Markdown，可以分行。'
const SYSTEM_CUT = '分类后面带 ✂ 的行，项目约定可能认为现在不需要：最后用一句话说明约定为什么可能不需要它们。'

const tagOf = (role: Role | 'test' | null, cut: boolean) => (role ? TAG[role] : '') + (cut ? ' ✂' : '')

/** New-version lines `start..end`, each prefixed with its number and the category of the block it belongs to. */
function taggedCode(source: string[], start: number, end: number, blocks: ExplainedBlock[]): string {
  const tags = new Map<number, string>()
  for (const { block, role, cut } of blocks) for (const line of block.lines) tags.set(line, tagOf(role, cut))
  const width = String(end).length
  return source
    .slice(start - 1, end)
    .map((text, i) => `${String(start + i).padStart(width)} ${(tags.get(start + i) ?? '').padEnd(4, '　')}| ${text}`)
    .join('\n')
}

/** The whole unit with each line's number and category, plus the convention when some block has ✂. */
export function explainMessages({ pr, path, source, unit, blocks, policy }: ExplainInput): ChatCompletionMessageParam[] {
  const code = taggedCode(source, unit.start, unit.end, blocks)
  const user = [
    `PR：${pr.title}`,
    `文件：${path}`,
    unit.kind === 'function' ? `代码：函数 ${unit.name}` : '代码：顶层改动',
    code,
    ...(policy ? ['项目约定：', policy] : []),
  ].join('\n\n')
  return [
    { role: 'system', content: policy ? SYSTEM + SYSTEM_CUT : SYSTEM },
    { role: 'user', content: user },
  ]
}

/** One line the reviewer selected in the diff, with the category of the block it belongs to (null if none). */
export interface SelectedLine {
  kind: 'add' | 'del' | 'ctx'
  oldNo: number | null
  newNo: number | null
  text: string
  role: Role | 'test' | null
  cut: boolean
}

export interface ExplainSelectionInput {
  pr: { title: string }
  path: string
  source: string[]
  lines: SelectedLine[]
  /** The code around the selection (the units it touches), or null when it has no new-version lines. */
  context: { start: number; end: number; blocks: ExplainedBlock[] } | null
  /** The project convention; passed only when a selected line has ✂. */
  policy: string | null
}

const SYSTEM_SELECTION =
  '审阅者在一个 PR 的 diff 里选中了几行代码，想知道它们的意思。' +
  '选中部分是 diff：行首 + 是新增的代码，- 是删掉的旧代码，空格是没改动的代码；新增和没改动的行带新版本的行号和分类' +
  '（核心是 PR 要做的事；防御只在出错时起作用；支撑不改变行为；测试是测试代码）。' +
  '用中文回答，不超过 5 句：说明选中的这几行在做什么；有删掉的旧代码时，说明改了什么、为什么这样改；需要时结合所在代码的上下文，提到代码时写行号。' +
  '只解释选中的部分，不评价写得好不好，不给修改建议，不复述代码，不用 Markdown，可以分行。'
const SYSTEM_SELECTION_CUT = '分类后面带 ✂ 的行，项目约定可能认为现在不需要：最后用一句话说明约定为什么可能不需要它们。'

/** The selected diff lines, plus the code around them for context, plus the convention when a selected line has ✂. */
export function explainSelectionMessages({ pr, path, source, lines, context, policy }: ExplainSelectionInput): ChatCompletionMessageParam[] {
  const width = Math.max(...lines.map((l) => String(l.newNo ?? l.oldNo ?? '').length), 1)
  const selected = lines
    .map((line) => {
      const sign = line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' '
      const number = line.newNo === null ? `旧${line.oldNo}` : String(line.newNo)
      const tag = line.kind === 'del' ? '' : tagOf(line.role, line.cut)
      return `${sign} ${number.padStart(width + 1)} ${tag.padEnd(4, '　')}| ${line.text}`
    })
    .join('\n')
  const user = [
    `PR：${pr.title}`,
    `文件：${path}`,
    ...(context ? [`所在代码（新版本第 ${context.start}–${context.end} 行）：`, taggedCode(source, context.start, context.end, context.blocks)] : []),
    '审阅者选中的部分：',
    selected,
    ...(policy ? ['项目约定：', policy] : []),
  ].join('\n\n')
  return [
    { role: 'system', content: policy ? SYSTEM_SELECTION + SYSTEM_SELECTION_CUT : SYSTEM_SELECTION },
    { role: 'user', content: user },
  ]
}

/** Asks the general model; `messages` come from explainMessages or explainSelectionMessages. */
export async function complete(config: LlmConfig, messages: ChatCompletionMessageParam[], signal?: AbortSignal): Promise<string> {
  const client = new OpenAI({ baseURL: config.baseURL, apiKey: config.apiKey })
  const completion = await client.chat.completions.create({ model: config.model, messages }, { signal })
  const text = completion.choices[0]?.message.content?.trim()
  if (!text) throw new Error('模型没有返回内容')
  return text
}
