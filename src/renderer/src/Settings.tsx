import { useEffect, useState, type FormEvent } from 'react'
import type { SettingsView } from '../../shared/api'
import { errorMessage } from './labels'

export function Settings({ onBack }: { onBack: () => void }) {
  const [view, setView] = useState<SettingsView>()
  const [jevModel, setJevModel] = useState('')
  const [jevKey, setJevKey] = useState('')
  const [baseURL, setBaseURL] = useState('')
  const [llmModel, setLlmModel] = useState('')
  const [llmKey, setLlmKey] = useState('')
  const [status, setStatus] = useState<string>()

  const load = (settings: SettingsView) => {
    setView(settings)
    setJevModel(settings.jev.model)
    setBaseURL(settings.llm.baseURL)
    setLlmModel(settings.llm.model)
    setJevKey('')
    setLlmKey('')
  }

  useEffect(() => {
    window.yolk.getSettings().then(load)
  }, [])

  const save = async (event: FormEvent, clear?: 'jev' | 'llm') => {
    event.preventDefault()
    try {
      const saved = await window.yolk.saveSettings({
        jev: { model: jevModel.trim(), apiKey: clear === 'jev' ? '' : jevKey || undefined },
        llm: { baseURL: baseURL.trim(), model: llmModel.trim(), apiKey: clear === 'llm' ? '' : llmKey || undefined },
      })
      load(saved)
      setStatus('已保存')
    } catch (error) {
      setStatus(`保存失败：${errorMessage(error)}`)
    }
  }

  if (!view) return null
  return (
    <div className="settings">
      <header className="page-header">
        <button className="link" onClick={onBack}>
          ◀ 返回
        </button>
        <h1>设置</h1>
      </header>
      <form onSubmit={save}>
        <fieldset>
          <legend>Jev（判断代码块）</legend>
          <label>
            API Key
            <input
              type="password"
              value={jevKey}
              onChange={(e) => setJevKey(e.target.value)}
              placeholder={view.jev.hasKey ? '已设置，留空表示不修改' : '未设置，将使用环境变量 TYPESAFE_API_KEY'}
            />
            {view.jev.hasKey && (
              <button type="button" className="link" onClick={(e) => save(e, 'jev')}>
                清除
              </button>
            )}
          </label>
          <label>
            模型
            <input value={jevModel} onChange={(e) => setJevModel(e.target.value)} placeholder="jev-latest" />
          </label>
          <p className="hint">阈值调好后，建议固定成具体版本号（如 jev-1.13.0），避免别名升级后阈值失效。</p>
        </fieldset>
        <fieldset>
          <legend>通用模型（悬停解释，M4 启用）</legend>
          <label>
            Base URL
            <input value={baseURL} onChange={(e) => setBaseURL(e.target.value)} placeholder="https://api.openai.com/v1" />
          </label>
          <label>
            API Key
            <input
              type="password"
              value={llmKey}
              onChange={(e) => setLlmKey(e.target.value)}
              placeholder={view.llm.hasKey ? '已设置，留空表示不修改' : '未设置'}
            />
            {view.llm.hasKey && (
              <button type="button" className="link" onClick={(e) => save(e, 'llm')}>
                清除
              </button>
            )}
          </label>
          <label>
            模型
            <input value={llmModel} onChange={(e) => setLlmModel(e.target.value)} placeholder="模型名" />
          </label>
        </fieldset>
        <p className="hint">API Key 用系统钥匙串加密后保存在本机，不会发送给界面进程。</p>
        <div className="actions">
          <button type="submit">保存</button>
          {status && <span className="muted">{status}</span>}
        </div>
      </form>
    </div>
  )
}
