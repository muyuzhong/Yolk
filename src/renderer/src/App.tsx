import { AppShell } from '@astryxdesign/core/AppShell'
import { InternationalizationProvider } from '@astryxdesign/core/i18n'
import zhCN from '@astryxdesign/core/locales/zh-CN.json'
import { BreadcrumbItem, Breadcrumbs } from '@astryxdesign/core/Breadcrumbs'
import { Icon } from '@astryxdesign/core/Icon'
import { IconButton } from '@astryxdesign/core/IconButton'
import { NavIcon } from '@astryxdesign/core/NavIcon'
import { SideNav, SideNavItem, SideNavSection } from '@astryxdesign/core/SideNav'
import { Theme } from '@astryxdesign/core/theme'
import { TopNav, TopNavHeading } from '@astryxdesign/core/TopNav'
import { neutralTheme } from '@astryxdesign/theme-neutral/built'
import { EggFried, ExternalLink, FolderGit2, LayoutGrid, Pin, PinOff, Search, Settings as SettingsIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Landing } from './Landing'
import { rememberRepository, setPinned, useRepositoryShortcuts } from './recent'
import { Repository } from './Repository'
import { RepositoryList } from './RepositoryList'
import { Review } from './Review'
import { href, pullRequestUrl, repositoryUrl, useRoute, type Route } from './route'
import { Settings } from './Settings'

const TITLE: Record<Route['page'], (route: Route) => string> = {
  home: () => '首页',
  repos: () => '全部仓库',
  settings: () => '设置',
  repo: (route) => (route.page === 'repo' ? route.repo : ''),
  review: (route) => (route.page === 'review' ? `#${route.number} · ${route.repo}` : ''),
}

export function App() {
  const route = useRoute()
  // The review page wants the width; the side nav folds away there unless the user opens it.
  const [reviewNavCollapsed, setReviewNavCollapsed] = useState(true)
  const [listNavCollapsed, setListNavCollapsed] = useState(false)
  const isReview = route.page === 'review'
  const { pinned, recent } = useRepositoryShortcuts()

  // Pages are hash routes, so mouse back/forward buttons and Alt+←/→ walk the history like a browser.
  useEffect(() => {
    const onMouse = (e: MouseEvent) => {
      if (e.button === 3) history.back()
      if (e.button === 4) history.forward()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.key === 'ArrowLeft') history.back()
      if (e.altKey && e.key === 'ArrowRight') history.forward()
    }
    window.addEventListener('mouseup', onMouse)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mouseup', onMouse)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  useEffect(() => {
    if (route.page === 'repo' || route.page === 'review') rememberRepository(route.repo)
    document.title = `${TITLE[route.page](route)} · Yolk`
  }, [route])

  return (
    <InternationalizationProvider locale="zh-CN" messages={{ 'zh-CN': zhCN }}>
      <Theme theme={neutralTheme}>
        <AppShell
          height="fill"
          topNav={<TopBar route={route} />}
          sideNav={
            <SideNav
              collapsible={{
                isCollapsed: isReview ? reviewNavCollapsed : listNavCollapsed,
                onCollapsedChange: isReview ? setReviewNavCollapsed : setListNavCollapsed,
              }}
              footer={<SideNavItem label="设置" icon={SettingsIcon} href={href({ page: 'settings' })} isSelected={route.page === 'settings'} />}
            >
              <SideNavSection title="导航" isHeaderHidden>
                <SideNavItem label="首页" icon={Search} href={href({ page: 'home' })} isSelected={route.page === 'home'} />
                <SideNavItem label="全部仓库" icon={LayoutGrid} href={href({ page: 'repos' })} isSelected={route.page === 'repos'} />
              </SideNavSection>
              {pinned.length > 0 && (
                <SideNavSection title="已固定">
                  {pinned.map((repo) => (
                    <RepositoryNavItem key={repo} repo={repo} route={route} isPinned />
                  ))}
                </SideNavSection>
              )}
              {recent.length > 0 && (
                <SideNavSection title="最近打开">
                  {recent.map((repo) => (
                    <RepositoryNavItem key={repo} repo={repo} route={route} isPinned={false} />
                  ))}
                </SideNavSection>
              )}
            </SideNav>
          }
        >
          {route.page === 'home' && <Landing />}
          {route.page === 'repos' && <RepositoryList />}
          {route.page === 'repo' && <Repository key={route.repo} repo={route.repo} />}
          {route.page === 'review' && <Review key={`${route.repo}#${route.number}`} repo={route.repo} number={route.number} />}
          {route.page === 'settings' && <Settings repo={route.repo} />}
        </AppShell>
      </Theme>
    </InternationalizationProvider>
  )
}

function RepositoryNavItem({ repo, route, isPinned }: { repo: string; route: Route; isPinned: boolean }) {
  return (
    <SideNavItem
      label={repo}
      icon={FolderGit2}
      href={href({ page: 'repo', repo })}
      isSelected={(route.page === 'repo' || route.page === 'review') && route.repo === repo}
      actions={
        <IconButton
          variant="ghost"
          label={isPinned ? '取消固定' : '固定'}
          tooltip={isPinned ? '取消固定' : '固定'}
          icon={<Icon icon={isPinned ? PinOff : Pin} size="sm" />}
          onClick={() => setPinned(repo, !isPinned)}
        />
      }
    />
  )
}

function TopBar({ route }: { route: Route }) {
  const external =
    route.page === 'review' ? pullRequestUrl(route.repo, route.number) : route.page === 'repo' ? repositoryUrl(route.repo) : undefined
  return (
    <TopNav
      label="Yolk"
      heading={<TopNavHeading heading="Yolk" headingHref={href({ page: 'home' })} logo={<NavIcon icon={<Icon icon={EggFried} size="sm" />} />} />}
      startContent={
        route.page !== 'home' && (
          <Breadcrumbs>
            {route.page !== 'settings' && <BreadcrumbItem href={href({ page: 'repos' })}>全部仓库</BreadcrumbItem>}
            {(route.page === 'repo' || route.page === 'review') && <BreadcrumbItem href={href({ page: 'repo', repo: route.repo })}>{route.repo}</BreadcrumbItem>}
            {route.page === 'review' && <BreadcrumbItem>#{route.number}</BreadcrumbItem>}
            {route.page === 'settings' && <BreadcrumbItem>设置</BreadcrumbItem>}
          </Breadcrumbs>
        )
      }
      endContent={
        external && (
          <IconButton
            variant="ghost"
            label="在 GitHub 上打开"
            tooltip="在 GitHub 上打开"
            icon={<Icon icon={ExternalLink} size="sm" />}
            onClick={() => window.open(external)}
          />
        )
      }
    />
  )
}
