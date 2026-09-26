// Settings open as a card over whatever page is showing, not as a page of their own; any page can open them.
import { useSyncExternalStore } from 'react'

export interface SettingsDialogState {
  isOpen: boolean
  /** Open the conventions section with this repository's convention already editing. */
  repo?: string
}

let state: SettingsDialogState = { isOpen: false }
const listeners = new Set<() => void>()

function set(next: SettingsDialogState) {
  state = next
  listeners.forEach((listener) => listener())
}

export const openSettings = (repo?: string) => set({ isOpen: true, repo })
export const closeSettings = () => set({ isOpen: false })

export function useSettingsDialog(): SettingsDialogState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => state,
  )
}
