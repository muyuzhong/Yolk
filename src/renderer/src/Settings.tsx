import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { Divider } from '@astryxdesign/core/Divider'
import { Heading } from '@astryxdesign/core/Heading'
import { HStack } from '@astryxdesign/core/HStack'
import { Icon } from '@astryxdesign/core/Icon'
import { Dialog } from '@astryxdesign/core/Dialog'
import { IconButton } from '@astryxdesign/core/IconButton'
import { StackItem } from '@astryxdesign/core/Layout'
import { List, ListItem } from '@astryxdesign/core/List'
import { StatusDot } from '@astryxdesign/core/StatusDot'
import { Text } from '@astryxdesign/core/Text'
import { TextArea } from '@astryxdesign/core/TextArea'
import { TextInput } from '@astryxdesign/core/TextInput'
import { useToast } from '@astryxdesign/core/Toast'
import { VStack } from '@astryxdesign/core/VStack'
import { Cpu, KeyRound, Link2, Plus, ScrollText, X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import type { SettingsUpdate, SettingsView } from '../../shared/api'
import { ListSkeleton } from './RepositoryList'
import { errorMessage } from './labels'
import { closeSettings, useSettingsDialog } from './settingsDialog'
import { parseTarget } from './target'

type Section = 'models' | 'conventions'
const SECTIONS: { id: Section; label: string; description: string; icon: typeof Cpu }[] = [
  { id: 'models', label: '模型', description: 'Jev 和生成解释的通用模型', icon: Cpu },
  { id: 'conventions', label: '审阅约定', description: '告诉 Jev 哪些代码现阶段用不着', icon: ScrollText },
]

const EXAMPLE = '例如：\n项目处于 MVP 阶段。\n- 不需要重试、降级和熔断\n- 只在 API 边界校验输入'

/**
 * One setting as a row: its name and a summary of the current value, with "编辑" on the right. Editing opens the row
 * in place with its own save and cancel, so nothing else on the page is touched.
 */
function SettingRow({
  label,
  value,
  isEditing,
  onEdit,
  onCancel,
  onSave,
  canSave = true,
  danger,
  children,
}: {
  label: string
  value: ReactNode
  isEditing: boolean
  onEdit: () => void
  onCancel: () => void
  onSave: () => Promise<void>
  canSave?: boolean
  /** A destructive action (clear a key, delete a convention), kept inside the editing state and apart from save. */
  danger?: { label: string; onClick: () => Promise<void> }
  children: ReactNode
}) {
  const [busy, setBusy] = useState<'save' | 'danger'>()
  const run = async (which: 'save' | 'danger', action: () => Promise<void>) => {
    setBusy(which)
    try {
      await action()
    } finally {
      setBusy(undefined)
    }
  }
  return (
    <>
      {isEditing ? (
        <VStack gap={3} className="setting-row is-editing">
          <Text weight="semibold">{label}</Text>
          {children}
          <HStack gap={2}>
            <Button size="sm" variant="primary" label="保存" isDisabled={!canSave} isLoading={busy === 'save'} onClick={() => run('save', onSave)} />
            <Button size="sm" variant="ghost" label="取消" onClick={onCancel} />
            {danger && (
              <>
                <StackItem size="fill" />
                <Button size="sm" variant="destructive" label={danger.label} isLoading={busy === 'danger'} onClick={() => run('danger', danger.onClick)} />
              </>
            )}
          </HStack>
        </VStack>
      ) : (
        <HStack gap={4} align="start" className="setting-row">
          <VStack gap={0.5} className="page-heading">
            <Text weight="semibold">{label}</Text>
            <Text type="supporting" maxLines={2}>
              {value}
            </Text>
          </VStack>
          <Button size="sm" variant="ghost" label="编辑" onClick={onEdit} />
        </HStack>
      )}
      <Divider />
    </>
  )
}

function SectionHeader({ title, description, status }: { title: string; description: string; status?: ReactNode }) {
  return (
    <VStack gap={1} className="setting-section-header">
      <HStack gap={2} align="center">
        <Heading level={3}>{title}</Heading>
        {status}
      </HStack>
      <Text type="supporting">{description}</Text>
    </VStack>
  )
}

/** The first line of a convention, for its row's summary. */
const firstLine = (text: string) => text.split('\n').find((line) => line.trim()) ?? ''

/** The settings card: opened from anywhere with openSettings(), floating over the current page. */
export function SettingsDialog() {
  const { isOpen, repo } = useSettingsDialog()
  return (
    <Dialog isOpen={isOpen} onOpenChange={(open) => !open && closeSettings()} width={880} maxHeight="82dvh" padding={0} className="settings-dialog">
      {isOpen && <Settings key={repo ?? ''} repo={repo} />}
    </Dialog>
  )
}

function Settings({ repo: focusRepo }: { repo?: string }) {
  const showToast = useToast()
  const [view, setView] = useState<SettingsView>()
  const [loadError, setLoadError] = useState<string>()
  const [section, setSection] = useState<Section>(focusRepo ? 'conventions' : 'models')
  // Key of the row being edited: one at a time, like a list you edit in place.
  const [editing, setEditing] = useState<string | undefined>(focusRepo ? `repo:${focusRepo}` : undefined)
  const [draft, setDraft] = useState('')
  const [newRepo, setNewRepo] = useState('')
  // A repository opened for its convention (from a review, or just added) that has none saved yet.
  const [pendingRepo, setPendingRepo] = useState(focusRepo)

  useEffect(() => {
    window.yolk.getSettings().then(
      (settings) => {
        setView(settings)
        if (focusRepo) setDraft(settings.conventions.repos[focusRepo] ?? '')
      },
      (error) => setLoadError(errorMessage(error)),
    )
  }, [focusRepo])
  useEffect(() => {
    setPendingRepo(focusRepo)
    if (focusRepo) {
      setSection('conventions')
      setEditing(`repo:${focusRepo}`)
    }
  }, [focusRepo])

  const edit = (key: string, initial: string) => {
    setEditing(key)
    setDraft(initial)
  }
  const cancel = () => {
    setEditing(undefined)
    setDraft('')
  }
  const guard = async (action: () => Promise<SettingsView>, done: string) => {
    try {
      setView(await action())
      cancel()
      showToast({ body: done })
    } catch (error) {
      showToast({ type: 'error', body: `保存失败：${errorMessage(error)}` })
    }
  }
  /** Saves one model field; everything else keeps its stored value (an undefined key means "unchanged"). */
  const saveModels = (change: (update: SettingsUpdate) => SettingsUpdate, done: string) =>
    guard(() => window.yolk.saveSettings(change({ jev: { model: view!.jev.model }, llm: { baseURL: view!.llm.baseURL, model: view!.llm.model } })), done)
  const saveConvention = (repo: string | null, text: string, done: string) =>
    guard(async () => {
      const next = await window.yolk.saveConvention(repo, text)
      if (repo === pendingRepo) setPendingRepo(undefined)
      return next
    }, done)
  const addRepo = () => {
    const target = parseTarget(newRepo)
    if (!target) return
    setPendingRepo(target.repo)
    edit(`repo:${target.repo}`, view?.conventions.repos[target.repo] ?? '')
    setNewRepo('')
  }

  const current = SECTIONS.find((s) => s.id === section)!
  const repos = view ? Object.keys(view.conventions.repos).sort() : []
  const shownRepos = pendingRepo && !repos.includes(pendingRepo) ? [pendingRepo, ...repos] : repos

  return (
    <HStack gap={0} align="stretch" className="settings-card">
      <VStack gap={3} className="settings-nav">
        <Heading level={2} className="settings-title">
          设置
        </Heading>
        <List density="spacious">
          {SECTIONS.map((s) => (
            <ListItem
              key={s.id}
              label={s.label}
              startContent={<Icon icon={s.icon} size="sm" />}
              isSelected={section === s.id}
              onClick={() => {
                setSection(s.id)
                cancel()
              }}
            />
          ))}
        </List>
      </VStack>
      <VStack gap={0} className="settings-pane">
        <HStack gap={2} align="start" className="settings-pane-header">
          <VStack gap={1} className="page-heading">
            <Heading level={3}>{current.label}</Heading>
            <Text type="supporting">{current.description}</Text>
          </VStack>
          <IconButton variant="ghost" size="sm" label="关闭" tooltip="关闭（Esc）" icon={<Icon icon={X} size="sm" />} onClick={closeSettings} />
        </HStack>
        <VStack gap={8} className="settings-content">
          {loadError && <Banner status="error" title="读取设置失败" description={loadError} />}
          {!view && !loadError && <ListSkeleton rows={4} />}

          {view && section === 'models' && (
            <>
              <VStack gap={0}>
                <SectionHeader title="Jev" description="判断每个代码块是核心、防御还是支撑。" />
                <Divider />
                <SettingRow
                  label="API Key"
                  value={view.jev.hasKey ? '已保存，用系统钥匙串加密' : '未保存，使用环境变量 TYPESAFE_API_KEY'}
                  isEditing={editing === 'jev.key'}
                  onEdit={() => edit('jev.key', '')}
                  onCancel={cancel}
                  canSave={draft.trim() !== ''}
                  onSave={() => saveModels((u) => ({ ...u, jev: { ...u.jev, apiKey: draft.trim() } }), 'Jev API Key 已保存')}
                  danger={
                    view.jev.hasKey
                      ? { label: '清除已保存的 Key', onClick: () => saveModels((u) => ({ ...u, jev: { ...u.jev, apiKey: '' } }), '已清除 Jev API Key') }
                      : undefined
                  }
                >
                  <TextInput type="password" label="API Key" isLabelHidden startIcon={KeyRound} value={draft} onChange={setDraft} placeholder="粘贴新的 Key" autoComplete="off" hasAutoFocus />
                </SettingRow>
                <SettingRow
                  label="模型"
                  value={view.jev.model}
                  isEditing={editing === 'jev.model'}
                  onEdit={() => edit('jev.model', view.jev.model)}
                  onCancel={cancel}
                  canSave={draft.trim() !== '' && draft.trim() !== view.jev.model}
                  onSave={() => saveModels((u) => ({ ...u, jev: { ...u.jev, model: draft.trim() } }), 'Jev 模型已保存')}
                >
                  <TextInput
                    label="模型"
                    isLabelHidden
                    value={draft}
                    onChange={setDraft}
                    placeholder="jev-latest"
                    description="阈值调好后，建议固定成具体版本号（如 jev-1.13.0），避免别名升级后阈值失效。"
                    hasAutoFocus
                  />
                </SettingRow>
              </VStack>

              <VStack gap={0}>
                <SectionHeader
                  title="通用模型"
                  description="生成悬停时的中文解释。任何 OpenAI 兼容接口都可以，留空的项使用环境变量 OPENAI_*。"
                  status={<StatusDot variant={view.llm.ready ? 'success' : 'warning'} label={view.llm.ready ? '已可用' : '未配置'} tooltip={view.llm.ready ? '已可用' : '未配置'} />}
                />
                <Divider />
                <SettingRow
                  label="Base URL"
                  value={view.llm.baseURL || '未设置，使用环境变量 OPENAI_BASE_URL'}
                  isEditing={editing === 'llm.baseURL'}
                  onEdit={() => edit('llm.baseURL', view.llm.baseURL)}
                  onCancel={cancel}
                  canSave={draft.trim() !== view.llm.baseURL}
                  onSave={() => saveModels((u) => ({ ...u, llm: { ...u.llm, baseURL: draft.trim() } }), 'Base URL 已保存')}
                >
                  <TextInput label="Base URL" isLabelHidden startIcon={Link2} value={draft} onChange={setDraft} placeholder="https://api.openai.com/v1" hasAutoFocus />
                </SettingRow>
                <SettingRow
                  label="API Key"
                  value={view.llm.hasKey ? '已保存，用系统钥匙串加密' : '未保存，使用环境变量 OPENAI_API_KEY'}
                  isEditing={editing === 'llm.key'}
                  onEdit={() => edit('llm.key', '')}
                  onCancel={cancel}
                  canSave={draft.trim() !== ''}
                  onSave={() => saveModels((u) => ({ ...u, llm: { ...u.llm, apiKey: draft.trim() } }), 'API Key 已保存')}
                  danger={
                    view.llm.hasKey
                      ? { label: '清除已保存的 Key', onClick: () => saveModels((u) => ({ ...u, llm: { ...u.llm, apiKey: '' } }), '已清除 API Key') }
                      : undefined
                  }
                >
                  <TextInput
                    type="password"
                    label="API Key"
                    isLabelHidden
                    startIcon={KeyRound}
                    value={draft}
                    onChange={setDraft}
                    placeholder="粘贴新的 Key；不需要 key 的服务随便填一个"
                    autoComplete="off"
                    hasAutoFocus
                  />
                </SettingRow>
                <SettingRow
                  label="模型"
                  value={view.llm.model || '未设置，使用环境变量 OPENAI_MODEL'}
                  isEditing={editing === 'llm.model'}
                  onEdit={() => edit('llm.model', view.llm.model)}
                  onCancel={cancel}
                  canSave={draft.trim() !== view.llm.model}
                  onSave={() => saveModels((u) => ({ ...u, llm: { ...u.llm, model: draft.trim() } }), '模型已保存')}
                >
                  <TextInput label="模型" isLabelHidden value={draft} onChange={setDraft} placeholder="模型名，例如 gpt-4.1-mini" hasAutoFocus />
                </SettingRow>
              </VStack>
            </>
          )}

          {view && section === 'conventions' && (
            <>
              <VStack gap={0}>
                <SectionHeader title="默认约定" description="没有单独约定的仓库都用这一份。改动在下次打开 PR 时生效。" />
                <Divider />
                <SettingRow
                  label="所有仓库"
                  value={view.conventions.default ? firstLine(view.conventions.default) : '未设置：不标建议删除（✂）'}
                  isEditing={editing === 'default'}
                  onEdit={() => edit('default', view.conventions.default)}
                  onCancel={cancel}
                  canSave={draft.trim() !== view.conventions.default}
                  onSave={() => saveConvention(null, draft, '默认约定已保存')}
                >
                  <TextArea label="默认约定" isLabelHidden value={draft} onChange={setDraft} rows={6} placeholder={EXAMPLE} hasAutoFocus />
                </SettingRow>
              </VStack>

              <VStack gap={0}>
                <SectionHeader title="仓库约定" description="单独给某个仓库写的约定，会替代默认约定。" />
                <Divider />
                {shownRepos.map((repo) => {
                  const saved = view.conventions.repos[repo] ?? ''
                  return (
                    <SettingRow
                      key={repo}
                      label={repo}
                      value={saved ? firstLine(saved) : '还没有写'}
                      isEditing={editing === `repo:${repo}`}
                      onEdit={() => edit(`repo:${repo}`, saved)}
                      onCancel={() => {
                        cancel()
                        if (!saved) setPendingRepo(undefined)
                      }}
                      canSave={draft.trim() !== '' && draft.trim() !== saved}
                      onSave={() => saveConvention(repo, draft, `${repo} 的约定已保存`)}
                      danger={saved ? { label: '删除这份约定', onClick: () => saveConvention(repo, '', `已删除 ${repo} 的约定`) } : undefined}
                    >
                      <TextArea label={`${repo} 的约定`} isLabelHidden value={draft} onChange={setDraft} rows={6} placeholder={EXAMPLE} hasAutoFocus />
                    </SettingRow>
                  )
                })}
                <HStack gap={2} align="center" className="setting-row">
                  <TextInput
                    label="添加仓库"
                    isLabelHidden
                    width={320}
                    startIcon={Plus}
                    value={newRepo}
                    onChange={setNewRepo}
                    onEnter={addRepo}
                    placeholder="owner/repo 或仓库链接"
                  />
                  <Button size="sm" label="添加仓库约定" isDisabled={!parseTarget(newRepo)} onClick={addRepo} />
                </HStack>
              </VStack>
            </>
          )}
        </VStack>
      </VStack>
    </HStack>
  )
}
