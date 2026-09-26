import { choice, noul, type ChoiceResponse, type NoulResponse, type Questions, type TypeSafeClient } from '@typesafe-ai/sdk'
import type { Block, Unit } from './chunk'
import { DEFAULT_ROLE_CRITERIA, type Judgment, type Role } from './judgment'

export interface UnitInput {
  pr: { title: string; body: string }
  policy: string | null
  path: string
  /** Lines of the new version of the file. */
  source: string[]
  unit: Unit
  /** The unit's blocks. */
  blocks: Block[]
  /** What each role means; the defaults unless the user reworded them. */
  roles?: Record<Role, string>
}

/** One Jev request per unit: the unit's code with block markers as state, two questions per block. */
export function buildRequest({ pr, policy, path, source, unit, blocks, roles = DEFAULT_ROLE_CRITERIA }: UnitInput) {
  const marker = new Map<number, string>()
  for (const block of blocks) for (const line of block.lines) marker.set(line, `[${block.id}]`)
  const code = source
    .slice(unit.start - 1, unit.end)
    .map((text, i) => (marker.get(unit.start + i) ?? '').padEnd(6) + text)
    .join('\n')

  const blockText = (block: Block) =>
    block.lines.map((line, i) => (i > 0 && line > block.lines[i - 1] + 1 ? '...\n' : '') + source[line - 1]).join('\n')

  const questions: Questions = {}
  for (const block of blocks) {
    questions[`${block.id}_role`] = choice(
      `What role does the code in \`blocks.${block.id}\` (marked [${block.id}] in \`code\`) play in this PR's change?`,
      roles,
    )
    if (policy) {
      questions[`${block.id}_excluded`] = noul(
        `Does \`policy\` say this project does not need code like \`blocks.${block.id}\` at its current stage?`,
      )
    }
  }

  const state = {
    pr: { title: pr.title, description: pr.body },
    ...(policy ? { policy } : {}),
    file: path,
    code,
    blocks: Object.fromEntries(blocks.map((b) => [b.id, blockText(b)])),
  }
  return { state, questions }
}

export async function judgeUnit(client: TypeSafeClient, input: UnitInput, signal?: AbortSignal) {
  const result = await client.systemOne(buildRequest(input), { signal })
  const judgments: Record<string, Judgment> = {}
  for (const block of input.blocks) {
    const role = result.answers[`${block.id}_role`] as ChoiceResponse<Record<Role, string>>
    const excluded = result.answers[`${block.id}_excluded`] as NoulResponse | undefined
    judgments[block.id] = {
      role: role.choice,
      confidence: role.confidence,
      probabilities: { ...role.probabilities },
      excluded: excluded?.noul ?? null,
    }
  }
  return { judgments, model: result.model, inputTokens: result.usage.input_tokens }
}
