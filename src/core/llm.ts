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

/** The whole unit with each line's number and category, plus the convention when some block has ✂. */
export function explainMessages({ pr, path, source, unit, blocks, policy }: ExplainInput): ChatCompletionMessageParam[] {
  const tags = new Map<number, string>()
  for (const { block, role, cut } of blocks) {
    const tag = (role ? TAG[role] : '') + (cut ? ' ✂' : '')
    for (const line of block.lines) tags.set(line, tag)
  }
  const width = String(unit.end).length
  const code = source
    .slice(unit.start - 1, unit.end)
    .map((text, i) => {
      const line = unit.start + i
      return `${String(line).padStart(width)} ${(tags.get(line) ?? '').padEnd(4, '　')}| ${text}`
    })
    .join('\n')
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

export async function explain(config: LlmConfig, input: ExplainInput, signal?: AbortSignal): Promise<string> {
  const client = new OpenAI({ baseURL: config.baseURL, apiKey: config.apiKey })
  const completion = await client.chat.completions.create({ model: config.model, messages: explainMessages(input) }, { signal })
  const text = completion.choices[0]?.message.content?.trim()
  if (!text) throw new Error('模型没有返回内容')
  return text
}
