import OpenAI from 'openai'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import type { Block, Unit } from './chunk'

/** Any OpenAI-compatible chat completions endpoint (DESIGN.md §7.2). */
export interface LlmConfig {
  baseURL: string
  apiKey: string
  model: string
}

export interface ExplainInput {
  pr: { title: string }
  path: string
  /** Lines of the new version of the file. */
  source: string[]
  unit: Unit
  block: Block
  /** The project convention; passed only when Jev suggests removing the block (✂). */
  policy: string | null
}

const SYSTEM =
  '你在帮助审阅者读懂一个 PR 里的代码块。用中文写 2 到 4 句话，说明这段代码做什么、为什么出现在这里。' +
  '只解释，不评价写得好不好，不给修改建议，不复述代码，不用 Markdown。'
const SYSTEM_CUT = '项目约定可能认为这段代码现在不需要：最后用一句话说明约定为什么可能不需要它。'

/** The block's surrounding unit with the block's lines marked `>>`, plus the convention when it matters. */
export function explainMessages({ pr, path, source, unit, block, policy }: ExplainInput): ChatCompletionMessageParam[] {
  const marked = new Set(block.lines)
  const start = Math.min(unit.start, block.lines[0])
  const end = Math.max(unit.end, block.lines[block.lines.length - 1])
  const code = source
    .slice(start - 1, end)
    .map((text, i) => (marked.has(start + i) ? '>> ' : '   ') + text)
    .join('\n')
  const user = [
    `PR：${pr.title}`,
    `文件：${path}`,
    '所在代码（行首是 >> 的是要解释的代码块）：',
    code,
    ...(policy ? ['项目约定：', policy] : []),
  ].join('\n\n')
  return [
    { role: 'system', content: policy ? SYSTEM + SYSTEM_CUT : SYSTEM },
    { role: 'user', content: user },
  ]
}

export async function explain(config: LlmConfig, input: ExplainInput): Promise<string> {
  const client = new OpenAI({ baseURL: config.baseURL, apiKey: config.apiKey })
  const completion = await client.chat.completions.create({ model: config.model, messages: explainMessages(input) })
  const text = completion.choices[0]?.message.content?.trim()
  if (!text) throw new Error('模型没有返回内容')
  return text
}
