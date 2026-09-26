// What a judgment means for display; shared by the scripts and the renderer, so no SDK imports here.
export type Role = 'core' | 'defense' | 'support'

export interface Judgment {
  role: Role
  confidence: number
  probabilities: Record<Role, number>
  /** Probability that the project convention rules the block out; null without a convention. */
  excluded: number | null
}

/** Initial thresholds (DESIGN.md §7.1); tune on real PRs. */
export const LOW_CONFIDENCE = 0.5
export const EXCLUDED_THRESHOLD = 0.7

export const isUnsure = (j: Judgment) => j.confidence < LOW_CONFIDENCE
/** ✂ ignores the role: a PR whose purpose is adding retries gets its retry code judged core. */
export const suggestsRemoval = (j: Judgment) => (j.excluded ?? 0) >= EXCLUDED_THRESHOLD
