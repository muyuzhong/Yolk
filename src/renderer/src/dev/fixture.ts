// What scripts/capture.ts records and the browser mock replays.
import type { UnitResult } from '../../../core/analyze'
import type { PullRequestSummary, RepositorySummary } from '../../../core/sources/gh'
import type { ReviewStart } from '../../../shared/api'

export interface Fixture {
  login: string
  repositories: RepositorySummary[]
  /** All-state PR lists by OWNER/REPO; the mock filters them by state. */
  pullRequests: Record<string, PullRequestSummary[]>
  /** By PR URL: the chunked PR before judging, then each unit's judgments in the order Jev returned them. */
  reviews: Record<string, { start: ReviewStart; units: UnitResult[]; model: string; inputTokens: number }>
}
