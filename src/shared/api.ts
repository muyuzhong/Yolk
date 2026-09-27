// The IPC surface between the main process and the renderer, exposed as `window.yolk`.
import type { FileResult, UnitResult } from '../core/analyze'
import type { JudgingSettings, JudgingUpdate } from '../core/judgment'
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

/** Omitted fields keep their stored value; an empty apiKey clears it. */
export interface SettingsUpdate {
  jev?: { model?: string; apiKey?: string }
  llm?: { baseURL?: string; model?: string; apiKey?: string }
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
  | { type: 'done'; reviewId: string; model: string; inputTokens: number; cachedUnits?: number }
  | { type: 'error'; reviewId: string; message: string }

/** A line the reviewer selected in a file's diff, by position; the main process looks up its text itself. */
export interface SelectionLine {
  kind: 'add' | 'del' | 'ctx'
  oldNo: number | null
  newNo: number | null
}

/** The most lines one selection may send to the general model. */
export const MAX_SELECTION = 200

export interface UpdateState {
  status: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'installing' | 'error' | 'unsupported'
  currentVersion: string
  version?: string
  percent?: number
  message?: string
}
export type UpdateAction = 'check' | 'download' | 'install' | 'open-downloads'

export interface YolkApi {
  getUpdateState(): Promise<UpdateState>
  update(action: UpdateAction): Promise<void>
  onUpdateState(listener: (state: UpdateState) => void): () => void
  getSettings(): Promise<SettingsView>
  saveSettings(update: SettingsUpdate): Promise<SettingsView>
  /** Sets the default convention (`repo` null) or one repository's; empty text removes a repository's entry. */
  saveConvention(repo: string | null, text: string): Promise<SettingsView>
  /** Updates only supplied judging fields; null restores all defaults. */
  saveJudging(judging: JudgingUpdate | null): Promise<SettingsView>
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
  /** Explains lines the reviewer selected with the mouse, with the code around them as context; cached like explainUnit. */
  explainSelection(reviewId: string, fileIndex: number, lines: SelectionLine[]): Promise<string>
  onReviewProgress(listener: (progress: ReviewProgress) => void): () => void
}
