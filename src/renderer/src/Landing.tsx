import { Avatar } from '@astryxdesign/core/Avatar'
import { Center } from '@astryxdesign/core/Center'
import { Heading } from '@astryxdesign/core/Heading'
import { HStack } from '@astryxdesign/core/HStack'
import { Icon } from '@astryxdesign/core/Icon'
import { Kbd } from '@astryxdesign/core/Kbd'
import { Layout, LayoutContent } from '@astryxdesign/core/Layout'
import { Text } from '@astryxdesign/core/Text'
import { Typeahead, TypeaheadItem, type SearchableItem, type SearchSource } from '@astryxdesign/core/Typeahead'
import { VStack } from '@astryxdesign/core/VStack'
import { PulsingBorder } from '@paper-design/shaders-react'
import { ArrowRight, GitPullRequest, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { avatarUrl } from './labels'
import { DitherBackdrop } from './DitherBackdrop'
import { loadRepositories } from './RepositoryList'
import { useRepositoryShortcuts, type RepositoryShortcuts } from './recent'
import { navigate, type Route } from './route'
import { parseTarget } from './target'
import { usePrefersReducedMotion, useTokenColors } from './tokenColors'

type Suggestion = SearchableItem<{ route: Route; description?: string; owner?: string }>

const SUGGESTIONS = 8

const repoSuggestion = (repo: string, description?: string): Suggestion => ({
  id: `repo:${repo}`,
  label: repo,
  auxiliaryData: { route: { page: 'repo', repo }, description, owner: repo.split('/').at(-2) },
})

/** A PR or repository link opens directly; anything else matches the user's repositories. */
function searchSource(shortcuts: RepositoryShortcuts): SearchSource<Suggestion> {
  return {
    async search(query) {
      const target = parseTarget(query)
      if (target?.kind === 'pr') {
        return [
          {
            id: `pr:${target.repo}#${target.number}`,
            label: `审阅 PR #${target.number}`,
            auxiliaryData: { route: { page: 'review', repo: target.repo, number: target.number }, description: target.repo },
          },
        ]
      }
      const words = query.trim().toLowerCase()
      const repositories = await loadRepositories().catch(() => [])
      const matches = repositories
        .filter((r) => r.fullName !== target?.repo && `${r.fullName} ${r.description}`.toLowerCase().includes(words))
        .map((r) => repoSuggestion(r.fullName, r.description || undefined))
      return [...(target ? [repoSuggestion(target.repo, '打开这个仓库')] : []), ...matches].slice(0, SUGGESTIONS)
    },
    async bootstrap() {
      const pinned = shortcuts.pinned.map((repo) => repoSuggestion(repo, '已固定'))
      const recent = shortcuts.recent.map((repo) => repoSuggestion(repo, '最近打开'))
      const known = [...pinned, ...recent]
      if (known.length) return known.slice(0, SUGGESTIONS)
      const repositories = await loadRepositories().catch(() => [])
      return repositories.slice(0, SUGGESTIONS).map((r) => repoSuggestion(r.fullName, r.description || undefined))
    },
  }
}

function renderSuggestion(item: Suggestion) {
  const { route, description, owner } = item.auxiliaryData!
  const icon =
    route.page === 'review' ? (
      <Icon icon={GitPullRequest} color="accent" />
    ) : owner ? (
      <Avatar size="xsm" shape="rounded" name={owner} src={avatarUrl(owner)} tooltip={false} />
    ) : (
      <Icon icon={ArrowRight} />
    )
  return <TypeaheadItem item={item} icon={icon} description={description} />
}

/** Cycled through the empty search box to show what it accepts. */
const PLACEHOLDERS = ['粘贴一个 PR 链接，直接开始审阅', '搜索你的仓库', '输入 owner/repo 打开任意仓库', '粘贴仓库链接']
const PLACEHOLDER_MS = 3200
const TRANSPARENT = 'rgba(0, 0, 0, 0)'

/** Shader colors come from the theme; resolved at runtime because WebGL cannot read CSS variables. */
const SHADER_TOKENS = ['--color-data-categorical-orange', '--color-data-categorical-blue', '--color-data-categorical-indigo'] as const

const GLYPHS = '#%&*+=<>/\\|01'
const DECODE_STEP_MS = 55
const DECODE_STEPS_PER_CHAR = 4

/** The title types itself in: each character cycles through code-ish glyphs before settling, left to right. */
function useDecodedText(text: string, isStill: boolean): string {
  const [step, setStep] = useState(isStill ? Infinity : 0)
  const total = text.length * DECODE_STEPS_PER_CHAR
  useEffect(() => {
    if (step >= total) return
    const timer = setTimeout(() => setStep((n) => n + 1), DECODE_STEP_MS)
    return () => clearTimeout(timer)
  }, [step, total])
  return [...text]
    .map((char, i) => {
      const settled = step >= (i + 1) * DECODE_STEPS_PER_CHAR
      if (settled) return char
      return step >= i * DECODE_STEPS_PER_CHAR - DECODE_STEPS_PER_CHAR ? GLYPHS[(step * 7 + i * 3) % GLYPHS.length] : '\u00a0'
    })
    .join('')
}

interface BorderFit {
  marginLeft: number
  marginRight: number
  marginTop: number
  marginBottom: number
  roundness: number
}

/**
 * PulsingBorder draws its rounded box in canvas fractions; measure the search field and its (larger) canvas so the
 * border lands exactly on the field's edge with the field's own corner radius.
 */
function useBorderFit(wrapper: RefObject<HTMLDivElement | null>, isMounted: boolean): BorderFit | null {
  const [fit, setFit] = useState<BorderFit | null>(null)
  useEffect(() => {
    const element = wrapper.current
    if (!element) return
    const measure = () => {
      const field = element.querySelector('.astryx-typeahead')
      const canvas = element.querySelector('.landing-search-border')
      if (!field || !canvas) return
      const f = field.getBoundingClientRect()
      const c = canvas.getBoundingClientRect()
      if (!c.width || !c.height) return
      const radius = parseFloat(getComputedStyle(field).borderTopLeftRadius) || 0
      setFit({
        marginLeft: (f.left - c.left) / c.width,
        marginRight: (c.right - f.right) / c.width,
        marginTop: (f.top - c.top) / c.height,
        marginBottom: (c.bottom - f.bottom) / c.height,
        roundness: Math.min(1, radius / (Math.min(f.width, f.height) / 2)),
      })
    }
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    measure()
    return () => observer.disconnect()
  }, [wrapper, isMounted])
  return fit
}

export function Landing() {
  const shortcuts = useRepositoryShortcuts()
  // Stable across renders: the placeholder cycle re-renders every few seconds, and a new source restarts the search.
  const source = useMemo(() => searchSource(shortcuts), [shortcuts])
  const scope = useRef<HTMLDivElement>(null)
  const colors = useTokenColors(scope, SHADER_TOKENS)
  const reducedMotion = usePrefersReducedMotion()
  const [placeholder, setPlaceholder] = useState(0)
  useEffect(() => {
    if (reducedMotion) return
    const timer = setInterval(() => setPlaceholder((i) => (i + 1) % PLACEHOLDERS.length), PLACEHOLDER_MS)
    return () => clearInterval(timer)
  }, [reducedMotion])
  const speed = reducedMotion ? 0 : 1
  const title = useDecodedText('Yolk', reducedMotion)
  const search = useRef<HTMLDivElement>(null)
  const fit = useBorderFit(search, colors !== null)

  return (
    <Layout
      ref={scope}
      className="landing"
      content={
        <LayoutContent>
          <DitherBackdrop className="landing-backdrop" />
          <Center height="100%" paddingInline={6}>
            <VStack gap={6} align="center" className="landing-hero">
              <VStack gap={4} align="center">
                <Heading level={1} justify="center" className="landing-title">
                  {title}
                </Heading>
                <Text type="supporting" justify="center" className="landing-tagline">
                  {'// 先读核心，再看防御与支撑'}
                </Text>
              </VStack>
              <VStack ref={search} className="landing-search">
                {colors && (
                  <PulsingBorder
                    className="landing-search-border"
                    colorBack={TRANSPARENT}
                    colors={[colors['--color-data-categorical-orange'], colors['--color-data-categorical-blue'], colors['--color-data-categorical-indigo']]}
                    {...fit}
                    scale={1}
                    thickness={0.06}
                    softness={0.6}
                    intensity={0.35}
                    bloom={0.45}
                    spots={3}
                    spotSize={0.6}
                    pulse={0.15}
                    smoke={0.25}
                    smokeSize={0.5}
                    speed={0.6 * speed}
                  />
                )}
                <Typeahead<Suggestion>
                  label="打开仓库或 PR"
                  isLabelHidden
                  size="lg"
                  width="100%"
                  startIcon={Search}
                  placeholder={PLACEHOLDERS[placeholder]}
                  searchSource={source}
                  renderItem={renderSuggestion}
                  value={null}
                  onChange={(item) => item && navigate(item.auxiliaryData!.route)}
                  hasEntriesOnFocus
                  hasAutoFocus
                  hasClear={false}
                  debounceMs={0}
                  emptySearchResultsText="没有匹配的仓库。其他仓库可以输入 owner/repo 打开"
                />
              </VStack>
              <HStack gap={2} align="center">
                <Kbd keys="enter" />
                <Text type="supporting">打开第一条</Text>
                <Kbd keys="up" />
                <Kbd keys="down" />
                <Text type="supporting">切换</Text>
              </HStack>
            </VStack>
          </Center>
        </LayoutContent>
      }
    />
  )
}
