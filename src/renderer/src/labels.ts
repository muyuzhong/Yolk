import type { Category } from './rows'

export const LABEL: Record<Category, string> = {
  core: '核心',
  defense: '防御',
  support: '支撑',
  test: '测试',
  pending: '判断中',
  failed: '判断失败',
  none: '',
}

/** Categories shown in legends and counts, in display order. */
export const SHOWN: Category[] = ['core', 'defense', 'support', 'test']

/** IPC errors arrive as "Error invoking remote method 'x': Error: message". */
export const errorMessage = (error: unknown) =>
  String(error instanceof Error ? error.message : error).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** GitHub serves account avatars at /<login>.png; GitHub Enterprise logins fall back to initials. */
export const avatarUrl = (login: string) => `https://github.com/${login}.png?size=64`
