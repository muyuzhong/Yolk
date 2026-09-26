# Yolk

PR 审阅透镜：把 PR 的新增代码按语法切块，用 Jev 判断每块是**核心**、**防御**还是**支撑**，在桌面客户端里用三色差异视图展示。审阅时可以先只看核心路径，其余部分再按需展开。设计见 [docs/DESIGN.md](docs/DESIGN.md)。

## 准备

- Node.js 22+
- [gh](https://cli.github.com/) 已登录（`gh auth status`）：PR 列表、diff 和文件内容都通过它读取，私有仓库也能用
- TypeSafe 的 API key：在客户端的设置页填写，或者设置环境变量 `TYPESAFE_API_KEY`
- 悬停解释用的通用模型（任何 OpenAI 兼容接口）：在设置页填写 Base URL、API Key 和模型名，或者设置环境变量 `OPENAI_BASE_URL`、`OPENAI_API_KEY`、`OPENAI_MODEL`

```bash
npm install
```

如果 `node_modules/electron/dist` 不存在（Electron 二进制文件没有随安装脚本下载下来），运行 `node node_modules/electron/install.js`。

## 客户端

```bash
npm run dev      # 开发模式，支持热更新
npm run build    # 构建到 out/
npm start        # 预览构建结果
```

在首页选一个仓库（也可以输入 `owner/repo`、仓库链接，或者直接粘贴 PR 链接），再从仓库的 PR 列表里选一个 PR。审阅页里按 C 切换"只看核心"，鼠标侧键或 Alt+←/→ 前进后退。

界面基于 [Astryx](https://github.com/facebook/astryx) 设计系统。改界面前可以用它的 CLI 查组件：`npx astryx build "<想做的页面>"`、`npx astryx --dense component <组件名>`。

在设置页写下审阅约定（默认一份，也可以按仓库单独写），约定排除的代码会标上 ✂。

## 终端脚本（调试切块和判断用）

```bash
npm run chunk -- <PR 链接>                             # 打印代码块和判断单元
npm run judge -- <PR 链接> [--convention <约定文件>]   # 打印 Jev 的判断，需要 TYPESAFE_API_KEY
npm test
npm run typecheck
```
