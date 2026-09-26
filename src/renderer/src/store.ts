/** Cached snapshots and subscriptions for the three small renderer stores. */
export function createStore<T>(read: () => T) {
  let snapshot: T | undefined
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => (snapshot ??= read()),
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    notify() {
      snapshot = undefined
      listeners.forEach((listener) => listener())
    },
  }
}
