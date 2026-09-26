// Settings open as a card over whatever page is showing, not as a page of their own; any page can open them.
import { useSyncExternalStore } from 'react'
import { createStore } from './store'

export interface SettingsDialogState {
  isOpen: boolean
  /** Open the conventions section with this repository's convention already editing. */
  repo?: string
}

let state: SettingsDialogState = { isOpen: false }
const store = createStore(() => state)

function set(next: SettingsDialogState) {
  state = next
  store.notify()
}

export const openSettings = (repo?: string) => set({ isOpen: true, repo })
export const closeSettings = () => set({ isOpen: false })

export function useSettingsDialog(): SettingsDialogState {
  return useSyncExternalStore(store.subscribe, store.getSnapshot)
}
