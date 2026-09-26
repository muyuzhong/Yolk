// WebGL shaders take plain rgb strings, not CSS variables; resolve Astryx color tokens for them.
import { useEffect, useState, type RefObject } from 'react'

const dark = matchMedia('(prefers-color-scheme: dark)')

/** Resolves `--color-*` tokens as seen from inside `scope` (the theme root), again whenever the color scheme flips. */
export function useTokenColors<const T extends readonly string[]>(scope: RefObject<Element | null>, tokens: T): Record<T[number], string> | null {
  const [colors, setColors] = useState<Record<T[number], string> | null>(null)
  const key = tokens.join()
  useEffect(() => {
    const resolve = () => {
      const root = scope.current
      if (!root) return
      const probe = document.createElement('i')
      probe.hidden = true
      root.append(probe)
      const resolved = {} as Record<T[number], string>
      for (const token of tokens as readonly T[number][]) {
        probe.style.color = `var(${token})`
        resolved[token] = getComputedStyle(probe).color
      }
      probe.remove()
      setColors(resolved)
    }
    resolve()
    dark.addEventListener('change', resolve)
    return () => dark.removeEventListener('change', resolve)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, key])
  return colors
}

const reduce = matchMedia('(prefers-reduced-motion: reduce)')

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(reduce.matches)
  useEffect(() => {
    const onChange = () => setReduced(reduce.matches)
    reduce.addEventListener('change', onChange)
    return () => reduce.removeEventListener('change', onChange)
  }, [])
  return reduced
}
