import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { Card } from '@astryxdesign/core/Card'
import { Heading } from '@astryxdesign/core/Heading'
import { HStack } from '@astryxdesign/core/HStack'
import { Layout, LayoutContent } from '@astryxdesign/core/Layout'
import { Text } from '@astryxdesign/core/Text'
import { TextArea } from '@astryxdesign/core/TextArea'
import { TextInput } from '@astryxdesign/core/TextInput'
import { Token } from '@astryxdesign/core/Token'
import { useToast } from '@astryxdesign/core/Toast'
import { VStack } from '@astryxdesign/core/VStack'
import { KeyRound, Link2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { SettingsView } from '../../shared/api'
import { ListSkeleton } from './RepositoryList'
import { errorMessage } from './labels'
import { parseTarget } from './target'

const EXAMPLE = '例如：\n项目处于 MVP 阶段。\n- 不需要重试、降级和熔断\n- 只在 API 边界校验输入'

/** One convention with its own draft and save button, so editing it never touches the rest of the settings. */
function ConventionEditor({
  label,
  description,
  saved,
  onSave,
  onRemove,
  hasAutoFocus,
}: {
  label: string
  description?: string
  saved: string
  onSave: (text: string) => Promise<void>
  onRemove?: () => Promise<void>
  hasAutoFocus?: boolean
}) {
  const [draft, setDraft] = useState(saved)
  const [isSaving, setIsSaving] = useState(false)
  useEffect(() => setDraft(saved), [saved])
  const run = async (action: () => Promise<void>) => {
    setIsSaving(true)
    try {
      await action()
    } finally {
      setIsSaving(false)
    }
  }
  return (
    <VStack gap={2}>
      <TextArea label={label} description={description} value={draft} onChange={setDraft} rows={4} placeholder={EXAMPLE} hasAutoFocus={hasAutoFocus} />
      <HStack gap={2}>
        <Button size="sm" label="保存" isDisabled={draft.trim() === saved} isLoading={isSaving} onClick={() => run(() => onSave(draft))} />
        {draft !== saved && <Button size="sm" variant="ghost" label="撤销修改" onClick={() => setDraft(saved)} />}
        {onRemove && <Button size="sm" variant="ghost" label="删除" onClick={() => run(onRemove)} />}
      </HStack>
    </VStack>
  )
}

export function Settings({ repo: focusRepo }: { repo?: string }) {
  const showToast = useToast()
  const [view, setView] = useState<SettingsView>()
  const [loadError, setLoadError] = useState<string>()
  const [jevModel, setJevModel] = useState('')
  const [jevKey, setJevKey] = useState('')
  const [baseURL, setBaseURL] = useState('')
  const [llmModel, setLlmModel] = useState('')
  const [llmKey, setLlmKey] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [newRepo, setNewRepo] = useState('')
  // A repository being added (or opened from a review) that has no saved convention yet.
  const [draftRepo, setDraftRepo] = useState(focusRepo)
  useEffect(() => setDraftRepo(focusRepo), [focusRepo])

  const load = (settings: SettingsView) => {
    setView(settings)
    setJevModel(settings.jev.model)
    setBaseURL(settings.llm.baseURL)
    setLlmModel(settings.llm.model)
    setJevKey('')
    setLlmKey('')
  }

  useEffect(() => {
    window.yolk.getSettings().then(load, (error) => setLoadError(errorMessage(error)))
  }, [])

  const save = async (clear?: 'jev' | 'llm') => {
    setIsSaving(true)
    try {
      load(
        await window.yolk.saveSettings({
          jev: { model: jevModel.trim(), apiKey: clear === 'jev' ? '' : jevKey || undefined },
          llm: { baseURL: baseURL.trim(), model: llmModel.trim(), apiKey: clear === 'llm' ? '' : llmKey || undefined },
        }),
      )
      showToast({ body: clear ? '已清除保存的 API Key' : '设置已保存' })
    } catch (error) {
      showToast({ type: 'error', body: `保存失败：${errorMessage(error)}` })
    } finally {
      setIsSaving(false)
    }
  }

  const saveConvention = async (repo: string | null, text: string, done: string) => {
    try {
      const next = await window.yolk.saveConvention(repo, text)
      setView(next)
      if (repo === draftRepo && next.conventions.repos[repo ?? '']) setDraftRepo(undefined)
      showToast({ body: done })
    } catch (error) {
      showToast({ type: 'error', body: `保存失败：${errorMessage(error)}` })
    }
  }
  const addRepo = () => {
    const target = parseTarget(newRepo)
    if (!target) return
    setDraftRepo(target.repo)
    setNewRepo('')
  }
  const repoConventions = view ? Object.keys(view.conventions.repos).sort() : []
  const editedRepos = draftRepo && !repoConventions.includes(draftRepo) ? [draftRepo, ...repoConventions] : repoConventions

  return (
    <Layout padding={6} contentWidth={720}>
      <LayoutContent>
        <VStack gap={6} className="settings">
          <VStack gap={1}>
            <Heading level={1}>设置</Heading>
            <Text type="supporting">API Key 用系统钥匙串加密后保存在本机，只在主进程里使用，不会传给界面。</Text>
          </VStack>
          {loadError && <Banner status="error" title="读取设置失败" description={loadError} />}
          {!view && !loadError && <ListSkeleton rows={4} />}
          {view && (
            <>
              <Card>
                <VStack gap={4}>
                  <HStack gap={2}>
                    <Heading level={2}>Jev</Heading>
                    <Text type="supporting">判断每个代码块是核心、防御还是支撑</Text>
                    <span className="spacer" />
                    <Token size="sm" color={view.jev.hasKey ? 'green' : 'gray'} label={view.jev.hasKey ? '已保存 Key' : '使用环境变量'} />
                  </HStack>
                  <TextInput
                    type="password"
                    label="API Key"
                    startIcon={KeyRound}
                    value={jevKey}
                    onChange={setJevKey}
                    placeholder={view.jev.hasKey ? '已保存，留空表示不修改' : '未保存，将使用环境变量 TYPESAFE_API_KEY'}
                    autoComplete="off"
                  />
                  <TextInput
                    label="模型"
                    value={jevModel}
                    onChange={setJevModel}
                    placeholder="jev-latest"
                    description="阈值调好后，建议固定成具体版本号（如 jev-1.13.0），避免别名升级后阈值失效。"
                  />
                  {view.jev.hasKey && (
                    <HStack gap={2}>
                      <Button size="sm" variant="ghost" label="清除已保存的 Key" onClick={() => save('jev')} />
                    </HStack>
                  )}
                </VStack>
              </Card>
              <Card>
                <VStack gap={4}>
                  <HStack gap={2}>
                    <Heading level={2}>通用模型</Heading>
                    <Text type="supporting">生成悬停时的中文解释</Text>
                    <span className="spacer" />
                    <Token size="sm" color={view.llm.ready ? 'green' : 'yellow'} label={view.llm.ready ? '已可用' : '未配置'} />
                  </HStack>
                  <TextInput
                    label="Base URL"
                    startIcon={Link2}
                    value={baseURL}
                    onChange={setBaseURL}
                    placeholder="https://api.openai.com/v1"
                    description="任何 OpenAI 兼容接口都可以，包括内网或本机部署的模型。"
                  />
                  <TextInput
                    type="password"
                    label="API Key"
                    startIcon={KeyRound}
                    value={llmKey}
                    onChange={setLlmKey}
                    placeholder={view.llm.hasKey ? '已保存，留空表示不修改' : '未保存；不需要 key 的服务随便填一个即可'}
                    autoComplete="off"
                  />
                  <TextInput label="模型" value={llmModel} onChange={setLlmModel} placeholder="模型名，例如 gpt-4.1-mini" />
                  <Text type="supporting">留空的项会使用环境变量 OPENAI_BASE_URL、OPENAI_API_KEY、OPENAI_MODEL。</Text>
                  {view.llm.hasKey && (
                    <HStack gap={2}>
                      <Button size="sm" variant="ghost" label="清除已保存的 Key" onClick={() => save('llm')} />
                    </HStack>
                  )}
                </VStack>
              </Card>
              <HStack gap={2}>
                <Button variant="primary" label="保存设置" isLoading={isSaving} onClick={() => save()} />
              </HStack>
              <Card>
                <VStack gap={5}>
                  <VStack gap={1}>
                    <Heading level={2}>审阅约定</Heading>
                    <Text type="supporting">
                      写下项目现阶段不需要哪些代码，Jev 会据此标出建议删除（✂）的块。约定只保存在本机；改动在下次打开 PR 时生效。
                    </Text>
                  </VStack>
                  <ConventionEditor
                    label="默认约定"
                    description="没有单独约定的仓库都用这一份。"
                    saved={view.conventions.default}
                    onSave={(text) => saveConvention(null, text, '默认约定已保存')}
                  />
                  <VStack gap={3}>
                    <VStack gap={1}>
                      <Text weight="medium">仓库约定</Text>
                      <Text type="supporting">单独给某个仓库写的约定，会替代默认约定。</Text>
                    </VStack>
                    {editedRepos.map((repo) => (
                      <ConventionEditor
                        key={repo}
                        label={repo}
                        saved={view.conventions.repos[repo] ?? ''}
                        hasAutoFocus={repo === focusRepo}
                        onSave={(text) => saveConvention(repo, text, `${repo} 的约定已保存`)}
                        onRemove={
                          view.conventions.repos[repo]
                            ? () => saveConvention(repo, '', `已删除 ${repo} 的约定`)
                            : async () => setDraftRepo(undefined)
                        }
                      />
                    ))}
                    <HStack gap={2} align="end">
                      <TextInput
                        label="添加仓库"
                        isLabelHidden
                        width={320}
                        value={newRepo}
                        onChange={setNewRepo}
                        onEnter={addRepo}
                        placeholder="owner/repo 或仓库链接"
                      />
                      <Button label="添加仓库约定" isDisabled={!parseTarget(newRepo)} onClick={addRepo} />
                    </HStack>
                  </VStack>
                </VStack>
              </Card>
            </>
          )}
        </VStack>
      </LayoutContent>
    </Layout>
  )
}
