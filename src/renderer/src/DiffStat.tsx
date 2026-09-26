import { Text } from '@astryxdesign/core/Text'

/** Lines added and removed, in the diff colors; the digits themselves say how big a PR is. */
export function DiffStat({ additions, deletions }: { additions: number; deletions: number }) {
  return (
    <Text type="supporting" className="diffstat" aria-label={`新增 ${additions} 行，删除 ${deletions} 行`}>
      <Text color="inherit" className="additions">
        +{additions}
      </Text>{' '}
      <Text color="inherit" className="deletions">
        −{deletions}
      </Text>
    </Text>
  )
}
