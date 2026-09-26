import { HStack } from '@astryxdesign/core/HStack'
import { Text } from '@astryxdesign/core/Text'

const BLOCKS = 5

/**
 * PR size at a glance: how many of five blocks light up grows with the log of changed lines (a handful of lines is
 * one block, thousands are four or five), and the lit blocks split green/red by additions vs deletions.
 */
export function DiffStat({ additions, deletions }: { additions: number; deletions: number }) {
  const total = additions + deletions
  const lit = total === 0 ? 0 : Math.min(BLOCKS, Math.max(1, Math.ceil(Math.log10(total))))
  const green = total === 0 ? 0 : Math.round((lit * additions) / total)
  const blocks = Array.from({ length: BLOCKS }, (_, i) => (i < green ? 'add' : i < lit ? 'del' : 'none'))
  return (
    <HStack gap={2} align="center" className="diffstat">
      <Text type="supporting" className="diffstat-numbers">
        <Text color="inherit" className="additions">
          +{additions}
        </Text>{' '}
        <Text color="inherit" className="deletions">
          −{deletions}
        </Text>
      </Text>
      <svg className="diffstat-blocks" viewBox={`0 0 ${BLOCKS * 3 - 1} 2`} role="img" aria-label={`${total} 行改动`}>
        {blocks.map((kind, i) => (
          <rect key={i} x={i * 3} y={0} width={2} height={2} className={`diffstat-block ${kind}`} />
        ))}
      </svg>
    </HStack>
  )
}
