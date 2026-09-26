// The IPC surface between the main process and the renderer, exposed as `window.yolk`.
import type { FileResult, UnitResult } from '../core/analyze'
import type { JudgingSettings } from '../core/judgment'
import type { PullRequest, PullRequestState, PullRequestSummary, RepositorySummary } from '../core/sources/gh'

/**
 * Review conventions: plain text telling Jev what this project does not need at its stage (e.g. "MVP: no retries").
 * They live in the client's settings, per user; a repository's own entry replaces the default.
 */
export interface Conventions {
  default: string
  /** By lowercase repository key (OWNER/REPO, or HOST/OWNER/REPO off github.com). */
  repos: Record<string, string>
}

/** Where the convention a review uses came from. */
export type ConventionSource = 'repo' | 'default'

/** API keys never leave the main process; the renderer only learns whether one is set. */
export interface SettingsView {
  jev: { model: string; hasKey: boolean }
  /** `ready`: base URL, key and model are all available from settings or the environment. */
  llm: { baseURL: string; model: string; hasKey: boolean; ready: boolean }
  conventions: Conventions
  /** Effective thresholds and role criteria: the user's overrides over the defaults. */
  judging: JudgingSettings
}

/** `apiKey` undefined keeps the stored key, '' clears it. */
export interface SettingsUpdate {
  jev: { model: string; apiKey?: string }
  llm: { baseURL: string; model: string; apiKey?: string }
}

export interface PullRequestList {
  /** The signed-in GitHub user, to mark PRs that ask them for a review. */
  login: string
  pullRequests: PullRequestSummary[]
}

export interface ReviewStart {
  pr: PullRequest
  files: FileResult[]
  /** The convention this review is judged by, or null when neither the repository nor the default has one. */
  policy: string | null
  policySource: ConventionSource | null
}

export type ReviewProgress =
  | ({ type: 'unit'; reviewId: string } & UnitResult)
  | { type: 'done'; reviewId: string; model: string; inputTokens: number }
  | { type: 'error'; reviewId: string; message: string }

export interface YolkApi {
  getSettings(): Promise<SettingsView>
  saveSettings(update: SettingsUpdate): Promise<SettingsView>
  /** Sets the default convention (`repo` null) or one repository's; empty text removes a repository's entry. */
  saveConvention(repo: string | null, text: string): Promise<SettingsView>
  /** Replaces the user's judging overrides; pass the defaults (or null) to go back to them. */
  saveJudging(judging: JudgingSettings | null): Promise<SettingsView>
  listRepositories(): Promise<RepositorySummary[]>
  listPullRequests(repo: string, state: PullRequestState): Promise<PullRequestList>
  /** Chunks the PR and returns it; judgments then arrive through `onReviewProgress` tagged with `reviewId`. */
  startReview(url: string, reviewId: string): Promise<ReviewStart>
  cancelReview(reviewId: string): void
  /**
   * A short Chinese explanation of one judgment unit (a function, or top-level changes) from the general model:
   * what it does as a whole, then its key lines by category. Asked for on demand; cached in the main process.
   */
  explainUnit(reviewId: string, fileIndex: number, unitId: string): Promise<string>
  onReviewProgress(listener: (progress: ReviewProgress) => void): () => void
}
