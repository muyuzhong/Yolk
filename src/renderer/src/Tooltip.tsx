import type { FileResult } from '../../core/analyze'
import type { Judgment, Role } from '../../core/judgment'
import type { Hover } from './DiffFile'
import { LABEL } from './labels'
import type { BlockState } from './rows'

const ROLES: Role[] = ['core', 'defense', 'support']
const WIDTH = 380

export type Explanation = { state: 'loading' } | { state: 'done' | 'error'; text: string }

interface Props {
  hover: Hover
  file: FileResult
  state?: BlockState
  judgment?: Judgment
  error?: string
  llmReady: boolean
  explanation?: Explanation
}

export function Tooltip({ hover, file, state, judgment, error, llmReady, explanation }: Props) {
  const block = file.chunks?.blocks.find((b) => b.id === hover.block)
  const left = Math.min(hover.x + 16, window.innerWidth - WIDTH - 16)
  // Open upwards in the lower half so a long explanation stays on screen.
  const vertical = hover.y < window.innerHeight * 0.55 ? { top: hover.y + 16 } : { bottom: window.innerHeight - hover.y + 16 }
  return (
    <div className="tooltip" style={{ left, width: WIDTH, ...vertical }}>
      {state?.category === 'test' && <div>测试代码 · 不做判断，也不折叠</div>}
      {state?.category === 'pending' && <div className="muted">Jev 判断中…</div>}
      {state?.category === 'failed' && <div className="error">判断失败：{error}</div>}
      {judgment && (
        <>
          <div className="tooltip-title">
            <span className={`chip cat-${judgment.role}`}>{LABEL[judgment.role]}</span>
            置信度 {judgment.confidence.toFixed(2)}
            {state?.unsure && <span className="muted">（拿不准，值得亲自看看）</span>}
          </div>
          {ROLES.map((role) => (
            <div key={role} className="prob">
              <span>{LABEL[role]}</span>
              <span className="prob-bar">
                <span className={`cat-${role}`} style={{ width: `${judgment.probabilities[role] * 100}%` }} />
              </span>
              <span className="muted">{judgment.probabilities[role].toFixed(2)}</span>
            </div>
          ))}
          {judgment.excluded !== null && (
            <div className={state?.cut ? 'cut' : 'muted'}>
              约定排除 {judgment.excluded.toFixed(2)}
              {state?.cut && ' · ✂ 建议删除'}
            </div>
          )}
        </>
      )}
      <div className="explanation">
        {!llmReady && <span className="muted">在设置页配置通用模型后，这里会显示中文解释。</span>}
        {explanation?.state === 'loading' && <span className="muted">正在生成解释…</span>}
        {explanation?.state === 'done' && explanation.text}
        {explanation?.state === 'error' && <span className="error">解释失败：{explanation.text}</span>}
      </div>
      {block && (
        <div className="muted small">
          {block.id} · {block.nodeType} · {block.unit}
        </div>
      )}
    </div>
  )
}
