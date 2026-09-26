# Yolk

PR 审阅透镜：把 PR 的新增代码按语法切块，用 Jev 判断每块是**核心**、**防御**还是**支撑**，在桌面客户端里用三色差异视图展示。审阅时可以先只看核心路径，其余部分再按需展开。设计见 [docs/DESIGN.md](docs/DESIGN.md)。

## 下载安装

到 [GitHub Releases](https://github.com/muyuzhong/Yolk/releases) 下载对应系统和处理器的安装包，无需安装 Node.js。

| 系统 | 处理器 | 文件 |
| --- | --- | --- |
| macOS | Apple Silicon：arm64；Intel：x64 | `.dmg`（拖入 Applications）或 `.zip` |
| Windows | Intel/AMD：x64；Windows on ARM：arm64 | `.exe` 安装程序 |
| Linux（含 Arch） | Intel/AMD：x64；ARM64：arm64 | `.AppImage` 或 `.tar.gz` |
| Ubuntu / Debian | x64 / arm64 | `.deb` |
| Fedora / RPM 系发行版 | x64 / arm64 | `.rpm` |

初期版本未配置代码签名及 Apple 公证，macOS / Windows 可能提示未知开发者；受组织安全策略管理的电脑可能无法运行。请从本仓库下载并核对 Release 中的 `SHA256SUMS`。当前是预发布版本。

客户端需要安装并登录 [GitHub CLI](https://cli.github.com/)：

```bash
# Arch Linux
sudo pacman -S github-cli
# macOS（Homebrew）
brew install gh
# Windows（PowerShell；自动选择系统架构）
winget install --id GitHub.cli --exact

gh auth login
```

Linux 的 AppImage 下载后先 `chmod +x Yolk-*.AppImage`，再双击或从终端运行。若提示缺少 `libfuse.so.2`，Arch 安装 `fuse2`，或使用 `./Yolk-*.AppImage --appimage-extract-and-run`。`.tar.gz` 解压后运行其中的 `yolk`。应用使用 Electron 的默认 Wayland/X11 选择，必要时可加 `--ozone-platform=x11` 排查显示问题。

API key 在客户端设置中填写。Linux 保存 key 需要可用的系统密钥环（例如已解锁的 GNOME Keyring / KDE Wallet）；从桌面图标启动不一定能读取终端中设置的环境变量。

## 源码开发准备

- Node.js 22+
- [gh](https://cli.github.com/) 已登录（`gh auth status`）：PR 列表、diff 和文件内容都通过它读取，私有仓库也能用
- TypeSafe 的 API key：在客户端的设置里填写，或者设置环境变量 `TYPESAFE_API_KEY`
- 悬停解释用的通用模型（任何 OpenAI 兼容接口）：在设置里填写 Base URL、API Key 和模型名，或者设置环境变量 `OPENAI_BASE_URL`、`OPENAI_API_KEY`、`OPENAI_MODEL`

```bash
npm install
```

如果 `node_modules/electron/dist` 不存在（Electron 二进制文件没有随安装脚本下载下来），运行 `node node_modules/electron/install.js`。

## 客户端

```bash
npm run dev      # 开发模式，支持热更新
npm run build    # 构建到 out/
npm start        # 预览构建结果
npm run dist -- --x64   # 打包当前系统的 x64 安装包到 dist/
npm run dist -- --arm64 # 打包当前系统的 ARM64 安装包
```

在首页选一个仓库（也可以输入 `owner/repo`、仓库链接，或者直接粘贴 PR 链接），再从仓库的 PR 列表里选一个 PR。审阅页里按 C 切换"只看核心"，鼠标侧键或 Alt+←/→ 前进后退。

界面基于 [Astryx](https://github.com/facebook/astryx) 设计系统。改界面前可以用它的 CLI 查组件：`npx astryx build "<想做的页面>"`、`npx astryx --dense component <组件名>`。

在设置里写下审阅约定（默认一份，也可以按仓库单独写），约定排除的代码会标上 ✂。

### 发布

`.github/workflows/release.yml` 在 macOS、Windows、Ubuntu 上分别构建 x64 / ARM64，先运行类型检查和测试，六组构建全部成功后才发布安装包和 SHA-256 校验文件。推送与 `package.json` 版本相同的 `v*` 标签即可发布；手动运行工作流仅生成 Actions artifacts。打包使用 [electron-builder](https://www.electron.build/docs/)，macOS 安装包需在 macOS 上构建。构建成功不等于每种系统均已完成实机验收。

## 终端脚本（调试切块和判断用）

```bash
npm run chunk -- <PR 链接>                             # 打印代码块和判断单元
npm run judge -- <PR 链接> [--convention <约定文件>]   # 打印 Jev 的判断，需要 TYPESAFE_API_KEY
npm test
npm run typecheck
```
