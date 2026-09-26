// The IPC surface between the main process and the renderer, exposed as `window.yolk`.
import type { FileResult, UnitResult } from '../core/analyze'
import type { PullRequest, PullRequestState, PullRequestSummary, RepositorySummary } from '../core/sources/gh'

/** API keys never leave the main process; the renderer only learns whether one is set. */
export interface SettingsView {
  jev: { model: string; hasKey: boolean }
  /** `ready`: base URL, key and model are all available from settings or the environment. */
  llm: { baseURL: string; model: string; hasKey: boolean; ready: boolean }
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
  policy: string | null
}

export type ReviewProgress =
  | ({ type: 'unit'; reviewId: string } & UnitResult)
  | { type: 'done'; reviewId: string; model: string; inputTokens: number }
  | { type: 'error'; reviewId: string; message: string }

export interface YolkApi {
  getSettings(): Promise<SettingsView>
  saveSettings(update: SettingsUpdate): Promise<SettingsView>
  listRepositories(): Promise<RepositorySummary[]>
  listPullRequests(repo: string, state: PullRequestState): Promise<PullRequestList>
  /** Chunks the PR and returns it; judgments then arrive through `onReviewProgress` tagged with `reviewId`. */
  startReview(url: string, reviewId: string): Promise<ReviewStart>
  cancelReview(reviewId: string): void
  /** A short Chinese explanation of one block from the general model; cached in the main process. */
  explainBlock(reviewId: string, fileIndex: number, blockId: string): Promise<string>
  onReviewProgress(listener: (progress: ReviewProgress) => void): () => void
}
