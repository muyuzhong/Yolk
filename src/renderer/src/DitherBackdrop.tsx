import { VStack } from '@astryxdesign/core/VStack'
import { Dithering } from '@paper-design/shaders-react'
import { useRef } from 'react'
import { usePrefersReducedMotion, useTokenColors } from './tokenColors'

const TOKENS = ['--color-data-categorical-indigo'] as const
const TRANSPARENT = 'rgba(0, 0, 0, 0)'

/**
 * The slow indigo dither behind the landing page and list headers. The caller's class positions it and masks where
 * it fades out; this component only fills its box.
 */
export function DitherBackdrop({ className, rotation = 0 }: { className: string; rotation?: number }) {
  const scope = useRef<HTMLDivElement>(null)
  const colors = useTokenColors(scope, TOKENS)
  const reducedMotion = usePrefersReducedMotion()
  return (
    <VStack ref={scope} className={`dither-backdrop ${className}`}>
      {colors && (
        <Dithering
          className="dither-backdrop-canvas"
          colorBack={TRANSPARENT}
          colorFront={colors['--color-data-categorical-indigo']}
          shape="warp"
          type="4x4"
          size={2}
          scale={1.4}
          rotation={rotation}
          speed={reducedMotion ? 0 : 0.25}
        />
      )}
    </VStack>
  )
}
