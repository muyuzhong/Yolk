// What a judgment means for display; shared by the scripts and the renderer, so no SDK imports here.
export type Role = 'core' | 'defense' | 'support'

export interface Judgment {
  role: Role
  confidence: number
  probabilities: Record<Role, number>
  /** Probability that the project convention rules the block out; null without a convention. */
  excluded: number | null
}

/** When a judgment is shown as unsure (?) or suggested for removal (✂). */
export interface Thresholds {
  /** Below this role confidence a block is drawn faded with a "?". */
  lowConfidence: number
  /** At or above this probability that the convention rules a block out, it gets ✂. */
  excluded: number
}

/** Initial thresholds (DESIGN.md §7.1), tuned on a handful of real PRs; users can override them in settings. */
export const DEFAULT_THRESHOLDS: Thresholds = { lowConfidence: 0.5, excluded: 0.7 }

/** What each role means, sent to Jev as the answer options; users can reword them in settings. */
export const DEFAULT_ROLE_CRITERIA: Record<Role, string> = {
  core: "Implements what the PR is for; removing it breaks the normal path",
  defense: 'Only matters when something goes wrong: validation, error handling, retries, timeouts, fallbacks, null guards',
  support: 'Does not change behavior: logging, types, imports, wiring, boilerplate, config',
}

/** Everything about how blocks are judged that the user may change; any field left out uses its default. */
export interface JudgingSettings {
  thresholds: Thresholds
  roles: Record<Role, string>
}

export const DEFAULT_JUDGING: JudgingSettings = { thresholds: DEFAULT_THRESHOLDS, roles: DEFAULT_ROLE_CRITERIA }

export const isUnsure = (j: Judgment, t: Thresholds = DEFAULT_THRESHOLDS) => j.confidence < t.lowConfidence
/** ✂ ignores the role: a PR whose purpose is adding retries gets its retry code judged core. */
export const suggestsRemoval = (j: Judgment, t: Thresholds = DEFAULT_THRESHOLDS) => (j.excluded ?? 0) >= t.excluded
