import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { Divider } from '@astryxdesign/core/Divider'
import { Heading } from '@astryxdesign/core/Heading'
import { HStack } from '@astryxdesign/core/HStack'
import { Icon } from '@astryxdesign/core/Icon'
import { Dialog } from '@astryxdesign/core/Dialog'
import { IconButton } from '@astryxdesign/core/IconButton'
import { StackItem } from '@astryxdesign/core/Layout'
import { Slider } from '@astryxdesign/core/Slider'
import { List, ListItem } from '@astryxdesign/core/List'
import { StatusDot } from '@astryxdesign/core/StatusDot'
import { Text } from '@astryxdesign/core/Text'
import { TextArea } from '@astryxdesign/core/TextArea'
import { TextInput } from '@astryxdesign/core/TextInput'
import { VStack } from '@astryxdesign/core/VStack'
import { Check, Cpu, KeyRound, Link2, Plus, ScrollText, SlidersHorizontal, X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { DEFAULT_JUDGING, type JudgingSettings, type Role } from '../../core/judgment'
import type { SettingsUpdate, SettingsView } from '../../shared/api'
import { ListSkeleton } from './RepositoryList'
import { errorMessage } from './labels'
import { closeSettings, useSettingsDialog } from './settingsDialog'
import { parseTarget } from './target'

type Section = 'models' | 'conventions' | 'judging'
const SECTIONS: { id: Section; label: string; description: string; icon: typeof Cpu }[] = [
  { id: 'models', label: '模型', description: 'Jev 和生成解释的通用模型', icon: Cpu },
  { id: 'conventions', label: '审阅约定', description: '告诉 Jev 哪些代码现阶段用不着', icon: ScrollText },
  { id: 'judging', label: '判断标准', description: '三种角色怎么区分，什么时候标 ✂ 和 ?。都有默认值，需要时再改。', icon: SlidersHorizontal },
]

const ROLES: { id: Role; label: string }[] = [
  { id: 'core', label: '核心' },
  { id: 'defense', label: '防御' },
  { id: 'support', label: '支撑' },
]

/** "0.70 · 默认" or "0.60 · 已修改（默认 0.70）". */
const thresholdValue = (text: string, value: number, fallback: number) =>
  `${text.replace('{}', value.toFixed(2))} · ${value === fallback ? '默认' : `已修改（默认 ${fallback.toFixed(2)}）`}`

/** How long the "saved" note stays next to the section title. */
const NOTICE_MS = 3000

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
  aside,
  children,
}: {
  label: string
  value: ReactNode
  isEditing: boolean
  onEdit: () => void
  onCancel: () => void
  onSave: () => Promise<void>
  canSave?: boolean
  /** A second action kept inside the editing state, apart from save: destructive (clear a key) or a reset. */
  aside?: { label: string; onClick: () => Promise<void>; isDestructive?: boolean }
  children: ReactNode
}) {
  const [busy, setBusy] = useState<'save' | 'aside'>()
  const run = async (which: 'save' | 'aside', action: () => Promise<void>) => {
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
            {aside && (
              <>
                <StackItem size="fill" />
                <Button
                  size="sm"
                  variant={aside.isDestructive ? 'destructive' : 'ghost'}
                  label={aside.label}
                  isLoading={busy === 'aside'}
                  onClick={() => run('aside', aside.onClick)}
                />
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

function Settings({ repo }: { repo?: string }) {
  const focusRepo = repo?.toLowerCase()
  // Feedback stays inside the card: a toast would render beneath the dialog's backdrop, blurred.
  const [notice, setNotice] = useState<string>()
  const [saveError, setSaveError] = useState<string>()
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(undefined), NOTICE_MS)
    return () => clearTimeout(timer)
  }, [notice])
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
      setSaveError(undefined)
      setNotice(done)
    } catch (error) {
      setNotice(undefined)
      setSaveError(errorMessage(error))
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
  const saveJudging = (change: (judging: JudgingSettings) => JudgingSettings, done: string) =>
    guard(() => window.yolk.saveJudging(change(view!.judging)), done)
  const judgingChanged =
    view !== undefined && JSON.stringify(view.judging) !== JSON.stringify(DEFAULT_JUDGING)

  const addRepo = () => {
    const target = parseTarget(newRepo)
    if (!target) return
    const repo = target.repo.toLowerCase()
    setPendingRepo(repo)
    edit(`repo:${repo}`, view?.conventions.repos[repo] ?? '')
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
            <HStack gap={3} align="center">
              <Heading level={3}>{current.label}</Heading>
              {notice && (
                <HStack gap={1} align="center" className="settings-notice" role="status">
                  <Icon icon={Check} size="sm" color="success" />
                  <Text type="supporting">{notice}</Text>
                </HStack>
              )}
            </HStack>
            <Text type="supporting">{current.description}</Text>
          </VStack>
          <IconButton variant="ghost" size="sm" label="关闭" tooltip="关闭（Esc）" icon={<Icon icon={X} size="sm" />} onClick={closeSettings} />
        </HStack>
        <VStack gap={8} className="settings-content">
          {loadError && <Banner status="error" title="读取设置失败" description={loadError} />}
          {saveError && <Banner status="error" title="保存失败" description={saveError} />}
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
                  aside={
                    view.jev.hasKey
                      ? { isDestructive: true, label: '清除已保存的 Key', onClick: () => saveModels((u) => ({ ...u, jev: { ...u.jev, apiKey: '' } }), '已清除 Jev API Key') }
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
                  aside={
                    view.llm.hasKey
                      ? { isDestructive: true, label: '清除已保存的 Key', onClick: () => saveModels((u) => ({ ...u, llm: { ...u.llm, apiKey: '' } }), '已清除 API Key') }
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
                      aside={saved ? { isDestructive: true, label: '删除这份约定', onClick: () => saveConvention(repo, '', `已删除 ${repo} 的约定`) } : undefined}
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

          {view && section === 'judging' && (
            <>
              <VStack gap={0}>
                <SectionHeader title="标记阈值" description="只影响显示：关闭设置后，打开着的审阅立刻按新阈值显示，不用重新判断。" />
                <Divider />
                <SettingRow
                  label="建议删除（✂）"
                  value={thresholdValue('约定排除概率 ≥ {} 时标出', view.judging.thresholds.excluded, DEFAULT_JUDGING.thresholds.excluded)}
                  isEditing={editing === 'excluded'}
                  onEdit={() => edit('excluded', String(view.judging.thresholds.excluded))}
                  onCancel={cancel}
                  canSave={Number(draft) !== view.judging.thresholds.excluded}
                  onSave={() => saveJudging((j) => ({ ...j, thresholds: { ...j.thresholds, excluded: Number(draft) } }), '✂ 阈值已保存')}
                  aside={
                    view.judging.thresholds.excluded !== DEFAULT_JUDGING.thresholds.excluded
                      ? {
                          label: '恢复默认',
                          onClick: () => saveJudging((j) => ({ ...j, thresholds: { ...j.thresholds, excluded: DEFAULT_JUDGING.thresholds.excluded } }), '✂ 阈值已恢复默认'),
                        }
                      : undefined
                  }
                >
                  <Slider
                    label="约定排除概率阈值"
                    value={Number(draft)}
                    onChange={(value: number) => setDraft(String(value))}
                    min={0.5}
                    max={0.95}
                    step={0.05}
                    formatValue={(value) => value.toFixed(2)}
                    valueDisplay="text"
                    marks={[{ value: DEFAULT_JUDGING.thresholds.excluded, label: '默认' }]}
                  />
                  <Text type="supporting">调低会标出更多代码，也更容易误标；调高只标约定写得很明确的代码。</Text>
                </SettingRow>
                <SettingRow
                  label="拿不准（?）"
                  value={thresholdValue('角色置信度 < {} 时画淡并加 ?', view.judging.thresholds.lowConfidence, DEFAULT_JUDGING.thresholds.lowConfidence)}
                  isEditing={editing === 'lowConfidence'}
                  onEdit={() => edit('lowConfidence', String(view.judging.thresholds.lowConfidence))}
                  onCancel={cancel}
                  canSave={Number(draft) !== view.judging.thresholds.lowConfidence}
                  onSave={() => saveJudging((j) => ({ ...j, thresholds: { ...j.thresholds, lowConfidence: Number(draft) } }), '? 阈值已保存')}
                  aside={
                    view.judging.thresholds.lowConfidence !== DEFAULT_JUDGING.thresholds.lowConfidence
                      ? {
                          label: '恢复默认',
                          onClick: () =>
                            saveJudging((j) => ({ ...j, thresholds: { ...j.thresholds, lowConfidence: DEFAULT_JUDGING.thresholds.lowConfidence } }), '? 阈值已恢复默认'),
                        }
                      : undefined
                  }
                >
                  <Slider
                    label="角色置信度阈值"
                    value={Number(draft)}
                    onChange={(value: number) => setDraft(String(value))}
                    min={0.3}
                    max={0.8}
                    step={0.05}
                    formatValue={(value) => value.toFixed(2)}
                    valueDisplay="text"
                    marks={[{ value: DEFAULT_JUDGING.thresholds.lowConfidence, label: '默认' }]}
                  />
                  <Text type="supporting">调高会有更多块被标成拿不准，适合想仔细复核的时候。</Text>
                </SettingRow>
              </VStack>

              <VStack gap={0}>
                <SectionHeader title="角色标准" description="作为选项的说明发给 Jev，直接决定三种颜色。改动在下次打开 PR 时生效；中文英文都可以。" />
                <Divider />
                {ROLES.map(({ id, label }) => {
                  const current = view.judging.roles[id]
                  const isDefault = current === DEFAULT_JUDGING.roles[id]
                  return (
                    <SettingRow
                      key={id}
                      label={isDefault ? label : `${label} · 已修改`}
                      value={current}
                      isEditing={editing === `role:${id}`}
                      onEdit={() => edit(`role:${id}`, current)}
                      onCancel={cancel}
                      canSave={draft.trim() !== '' && draft.trim() !== current}
                      onSave={() => saveJudging((j) => ({ ...j, roles: { ...j.roles, [id]: draft.trim() } }), `${label}的标准已保存`)}
                      aside={
                        isDefault
                          ? undefined
                          : { label: '恢复默认', onClick: () => saveJudging((j) => ({ ...j, roles: { ...j.roles, [id]: DEFAULT_JUDGING.roles[id] } }), `${label}的标准已恢复默认`) }
                      }
                    >
                      <TextArea label={`${label}的标准`} isLabelHidden value={draft} onChange={setDraft} rows={3} hasAutoFocus />
                    </SettingRow>
                  )
                })}
              </VStack>

              {judgingChanged && (
                <HStack gap={2} align="center">
                  <Button label="全部恢复默认" onClick={() => saveJudging(() => DEFAULT_JUDGING, '判断标准已全部恢复默认')} />
                  <Text type="supporting">阈值和三种角色的标准都回到内置的默认值。</Text>
                </HStack>
              )}
            </>
          )}
        </VStack>
      </VStack>
    </HStack>
  )
}
