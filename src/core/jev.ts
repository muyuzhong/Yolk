import { choice, noul, type ChoiceResponse, type NoulResponse, type Questions, type TypeSafeClient } from '@typesafe-ai/sdk'
import type { Block, Unit } from './chunk'
import type { Judgment } from './judgment'

const ROLE_CRITERIA = {
  core: "Implements what the PR is for; removing it breaks the normal path",
  defense: 'Only matters when something goes wrong: validation, error handling, retries, timeouts, fallbacks, null guards',
  support: 'Does not change behavior: logging, types, imports, wiring, boilerplate, config',
}

export interface UnitInput {
  pr: { title: string; body: string }
  policy: string | null
  path: string
  /** Lines of the new version of the file. */
  source: string[]
  unit: Unit
  /** The unit's blocks. */
  blocks: Block[]
}

/** One Jev request per unit: the unit's code with block markers as state, two questions per block. */
export function buildRequest({ pr, policy, path, source, unit, blocks }: UnitInput) {
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
      ROLE_CRITERIA,
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

export async function judgeUnit(client: TypeSafeClient, input: UnitInput) {
  const result = await client.systemOne(buildRequest(input))
  const judgments: Record<string, Judgment> = {}
  for (const block of input.blocks) {
    const role = result.answers[`${block.id}_role`] as ChoiceResponse<typeof ROLE_CRITERIA>
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
