import { Button } from '@astryxdesign/core/Button'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'
import { useEffect, useState } from 'react'
import type { UpdateAction, UpdateState } from '../../shared/api'
import { errorMessage } from './labels'

export function Updates() {
  const [state, setState] = useState<UpdateState>()
  const [error, setError] = useState<string>()
  useEffect(() => {
    let changed = false
    const unsubscribe = window.yolk.onUpdateState((next) => { changed = true; setState(next) })
    window.yolk.getUpdateState().then((next) => { if (!changed) setState(next) }, (e) => { if (!changed) setError(errorMessage(e)) })
    return () => { changed = true; unsubscribe() }
  }, [])
  const run = (action: UpdateAction) => {
    setError(undefined)
    void window.yolk.update(action).catch((e) => setError(errorMessage(e)))
  }
  return (
    <VStack gap={3}>
      <Text>当前版本：{state?.currentVersion ?? '读取中…'}</Text>
      <div role="status" aria-live="polite">
        {state?.message && <Text>{state.message}</Text>}
        {state?.status === 'checking' && <Text>正在检查更新…</Text>}
        {state?.status === 'available' && <Text>发现新版本 {state.version}</Text>}
        {state?.status === 'downloading' && <Text>正在下载 {state.version}：{Math.floor(state.percent ?? 0)}%</Text>}
        {state?.status === 'downloaded' && <Text>{state.version} 已下载并校验，安装会关闭并重新打开 Yolk。</Text>}
        {state?.status === 'installing' && <Text>正在重启安装…</Text>}
      </div>
      {error && <Text role="alert">{error}</Text>}
      {state && ['idle', 'error'].includes(state.status) && <Button label="检查更新" onClick={() => run('check')} />}
      {state?.status === 'available' && <Button label="下载更新" onClick={() => run('download')} />}
      {state?.status === 'downloaded' && <Button label="重启并安装" onClick={() => run('install')} />}
      <Button variant="ghost" label="打开下载页" onClick={() => run('open-downloads')} />
    </VStack>
  )
}
