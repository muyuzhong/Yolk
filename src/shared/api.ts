// The IPC surface between the main process and the renderer, exposed as `window.yolk`.
import type { FileResult, UnitResult } from '../core/analyze'
import type { PullRequest, PullRequestSummary } from '../core/sources/gh'

/** API keys never leave the main process; the renderer only learns whether one is set. */
export interface SettingsView {
  jev: { model: string; hasKey: boolean }
  llm: { baseURL: string; model: string; hasKey: boolean }
}

/** `apiKey` undefined keeps the stored key, '' clears it. */
export interface SettingsUpdate {
  jev: { model: string; apiKey?: string }
  llm: { baseURL: string; model: string; apiKey?: string }
}

export interface PullRequestLists {
  reviewRequested: PullRequestSummary[]
  authored: PullRequestSummary[]
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
  listPullRequests(): Promise<PullRequestLists>
  /** Chunks the PR and returns it; judgments then arrive through `onReviewProgress` tagged with `reviewId`. */
  startReview(url: string, reviewId: string): Promise<ReviewStart>
  cancelReview(reviewId: string): void
  onReviewProgress(listener: (progress: ReviewProgress) => void): () => void
}
