# Yolk 设计文档

> 状态：设计中（v0.1）· 2026-09-26

## 0. 背景

团队的代码主要由 AI 编写，但每个人仍要对自己提交的代码负责，所以 PR 需要人工审阅。AI 写的代码很少有 bug，问题大多出在"合不合适"。比如模型经常写大量防御性代码，而项目初期根本用不上这些代码。逐行读代码费时费力，有时还得读自己不熟悉的编程语言。

Yolk 帮审阅者把代码分成三类：必要的**核心**代码、围绕核心的**防御**代码、起辅助作用的**支撑**代码。审阅者可以先读懂核心路径，再按需展开其余部分。

## 1. 产品形态：桌面客户端

v0.1 做成本地运行的桌面客户端。

**为什么在本地运行：**

- 通过 `gh` 的登录状态读取 PR，私有仓库和 GitHub Enterprise 都能直接用，不需要另外配置 token。
- 以后可以直接读取本地 git 仓库，GitLab、公司内网仓库、还没推送的分支都能审阅。
- 通用模型可以指向内网部署的模型，代码不会离开公司网络。
- 不依赖 GitHub 的页面结构，GitHub 改版不受影响。

**为什么做客户端，而不是"终端命令 + 网页"：** 打开 PR、看审阅结果都在同一个窗口里完成，不用切到终端。API key 可以交给系统钥匙串保管。以后要做的审阅反馈、团队协作，也需要一个常驻的界面。

**技术选型：Electron。** 核心逻辑都是 TypeScript/Node：调用 gh 和 git 子进程、tree-sitter（wasm 版）、TypeSafe 的 JS SDK（要求 Node 20 以上）、OpenAI 兼容的 SDK。这些都能直接在 Electron 的主进程里跑。如果用 Tauri，就得用 Rust 重写这些逻辑，或者额外带一个 Node 进程。Electron 的代价是安装包在 100MB 以上，作为团队内部工具可以接受。

## 2. v0.1 范围：三色差异视图

**跑通的标准：**

- 打开客户端，在首页"待我审阅"列表里点一个 PR，或者直接粘贴 PR 链接。
- 进入差异视图后：
  - 新增的代码按块标成三种颜色：核心、防御、支撑。颜色随判断结果陆续出现，逐步铺满。
  - 模型拿不准的块，颜色画淡一些，并加一个"?"。
  - 打开"只看核心"开关，会折叠防御和支撑代码。
  - 鼠标悬停在代码块上，会显示中文解释。
  - 根据仓库里 `.yolk.md` 写的项目约定，标出建议删除的代码。

**v0.1 不做：** 读取本地 git 仓库、把审阅反馈交给开发者或 agent、团队协作、统计、GitHub Action。

## 3. 架构

```
Electron
 ├─ 主进程（Node）
 │   ├─ 数据来源：gh（子进程）
 │   ├─ core：diff 解析 → tree-sitter 切块 → Jev 判断
 │   ├─ 通用模型：悬停解释
 │   └─ 设置：API key 用 safeStorage 加密（系统钥匙串）
 ├─ preload：通过 IPC 只暴露有限的几个接口
 └─ 渲染进程（React）：首页（PR 列表）、差异视图、设置页
```

API key 只在主进程里使用，不会传到渲染进程。

## 4. 模块划分

```
src/
  core/            与界面无关，以后做 GitHub Action 时可以复用
    sources/gh.ts  gh pr view / gh pr diff / gh api / gh search prs
    diff.ts        把 unified diff 解析成行列表（新增 / 删除 / 上下文，附新旧行号）
    chunk.ts       tree-sitter 切块 + 划分判断单元
    languages.ts   文件扩展名 → 语言 → 语法文件、tags.scm、例外表（见 6.3）
  queries/         从各语言官方语法仓库复制过来的 tags.scm
    jev.ts         组装 state 和问题，调用 Jev，解析回答
    llm.ts         调用 OpenAI 兼容接口：explain()
    analyze.ts     把上面串起来：PR → 代码块 → 判断结果（每判断完一个单元就推送一次）
  main/            Electron 主进程：窗口、IPC、设置存储
  preload/
  renderer/        React：首页、差异视图、设置页
scripts/           开发用脚本：在终端打印切块和判断结果，用来调规则
```

## 5. 数据来源（gh）

| 用途 | 命令 |
|---|---|
| 待我审阅的 PR | `gh search prs --review-requested=@me --state=open --json number,title,repository,url,author,updatedAt` |
| PR 元信息 | `gh pr view <URL> --json number,title,body,url,baseRefOid,headRefOid,headRepository,headRepositoryOwner` |
| diff | `gh pr diff <URL>` |
| 文件完整内容 | `gh api repos/{head_owner}/{head_repo}/contents/{path}?ref={headRefOid} -H "Accept: application/vnd.github.raw"` |
| 项目约定 | 同上，从 **base** 版本读取 `.yolk.md` |

- 用的是 gh 的登录状态，所以私有仓库和 GitHub Enterprise 都能访问。
- 登录后每小时可以调用 5000 次 API，足够用。

### 项目约定：`.yolk.md`

`.yolk.md` 放在仓库根目录，用自然语言写明：项目当前处在什么阶段，哪些防御代码现在用不着。它和代码一起提交，整个团队共用一份。

示例：

```markdown
# 审阅约定
- MVP 阶段，不需要重试和降级逻辑
- 输入校验只在 API 边界（HTTP handler）做，内部函数不检查参数
- 内部调用不写 try/catch 兜底，错误直接向上抛
- 日志只在请求入口和出错的地方打
```

- **怎么用：** 打开 PR 时读取这份约定，作为 `policy` 交给 Jev（见 7.1）。Jev 会对每个非核心的块判断"约定是否排除了它"，排除的可能性高，就标上 ✂（建议删除）。
- **从 base 分支读取：** 因为 PR 不能修改用来评判它自己的规则。PR 里对约定的修改，要等合并后才生效。
- **没有这个文件时：** 三色标注照常显示，只是不标 ✂。
- **和 AGENTS.md 的区别：** AGENTS.md 是给写代码的 AI 看的，告诉它代码怎么写；`.yolk.md` 是给审阅用的，说明审阅时哪些代码算多余。两者内容会有重叠。
- **以后的演进：**
  - v0.2：审阅者标记"这段防御其实需要"，标记会写回这份约定；
  - v0.3：反复出现的条目同步到 AGENTS.md，让写代码的 AI 一开始就不写这类代码。

## 6. 切块

### 6.1 切成代码块

1. **解析 head 版本的完整文件，不解析 diff 片段。** diff 片段语法不完整，tree-sitter 会解析出大量错误节点。
2. **只把语句级节点当作切分单位。** 类型名匹配 `*_statement / *_declaration / *_definition / *_clause / *_item` 的节点都算语句级节点。每种语言再维护一张小的例外表，比如 Rust 的 `if_expression`。
3. **每一行归哪个节点：** 优先归给从这一行开始的最内层语句节点；没有的话，归给包含这一行第一个非空字符的最内层语句节点。
4. **复合语句（函数、if、try、循环）要拆开：** 外壳（开头行和结尾行）算一块，里面的每条语句各算一块。以下两种情况不拆，整体算一块：
   - 总长度不超过 3 行（初始值，后续需要调整），比如 `if (!x) throw ...` 这类守卫语句；
   - catch / except / finally / rescue 子句。
5. **一个块只包含该节点所拥有的行里新增的那些行。** 块可以不连续，比如函数签名和末尾的 `}` 属于同一块。
6. **注释、Rust 的 `#[...]` 属性、TS 装饰器，归到紧随其后的那条语句。** 注释通常是在解释下一行代码，应该跟代码一起判断、一起折叠；连续多行注释会整体跟过去。后面没有语句的注释（比如块末尾的注释）归到外层的外壳。
7. **先切细、再判断，渲染时才合并。** 判断完成后，相邻的同类块在界面上合并成一条色带。不能在判断之前合并，否则夹在两段核心代码中间的 `logger.info` 会被并进核心块。

示例：

```js
async function getUser(id) {                     // B1 函数外壳
  if (!id) throw new Error('id required');       // B2 守卫（不超过 3 行，整体算一块）
  try {                                          // B3 try 外壳
    const res = await fetch(`/api/users/${id}`); // B4
    return await res.json();                     // B5
  } catch (err) {                                // B6 catch 子句（整体算一块）
    console.error(err);                          // B6
    return null;                                 // B6
  }                                              // B6
}                                                // B1
```

预期结果：B1、B4、B5 是核心，B2、B3、B6 是防御。打开"只看核心"后只剩 B1、B4、B5，正好是这个函数的核心路径。

- 删除的行照常显示，但不做判断。
- 暂不支持的编程语言（yaml / json / md 等）只显示普通 diff，不做判断。

### 6.2 划分判断单元

**一个判断单元 = 一个有改动的函数，或者文件顶层的一段连续改动。** 每个单元调用一次 Jev。

函数的边界不用逐个语言手写规则，而是直接复用各语言语法自带的 `tags.scm`：取其中 `@definition.function`、`@definition.method` 标出的节点。GitHub 的代码跳转用的就是这些文件。

`tags.scm` 只认有名字的函数，而 `describe`/`it` 的回调、路由处理函数、闭包都是匿名的。所以**不少于 5 行的匿名函数也算判断单元**，用它的第一行文字当名字（比如 `it('returns the user', async () => {`）。更短的匿名函数留在外层单元里，这样判断时能看到上下文。如果不这样处理，一个测试文件会整体变成一个单元：在 hono 的一个真实 PR 上，就出现过一个单元里有 55 个块的情况。

不把整个文件放进一次调用，是因为 Jev 的 state 里无关内容越多，判断越不准（见官方文档 Jev 1.13 jaggedness 中的 "Large state full of irrelevant detail"）。单元的粒度是可调的参数，需要在真实 PR 上验证。

### 6.3 编程语言支持

用户不需要做任何配置：客户端按文件扩展名自动识别语言。开发时，每种语言需要准备以下几样东西：

| 需要什么 | 来源 | 需要自己写吗 |
|---|---|---|
| 语法文件（wasm） | `@vscode/tree-sitter-wasm`，微软维护，VS Code 自己也在用。解析器运行时和各语言语法文件放在同一个包里，版本已经对好 | 不用 |
| 函数边界 | 各语言官方语法仓库里的 `queries/tags.scm`。上面这个包没有附带，需要按它 `cgmanifest.json` 里记录的语法版本，从官方仓库复制过来 | 不用，只是复制文件 |
| 语法高亮 | Shiki，自带 200 多种语言 | 不用 |
| 语句级切块 | 6.1 的通用规则（按节点类型名的后缀匹配）；个别语言对不上时，补一张小的例外表 | 只写例外表 |
| 扩展名映射 | 在代码里写一张小表，十几行 | 要写，但很少 |

`@vscode/tree-sitter-wasm`（0.3.1）目前包含 16 种语言：TypeScript、TSX、JavaScript、Python、Go、Java、Rust、C#、C++、PHP、Ruby、Bash、PowerShell、CSS、ini、regex。v0.1 全部打包进去，通用规则对每种语言都能跑起来。

- **缺少的语言**（Kotlin、Swift、Dart、Scala 等），以后再加：
  - 各语言官方的 npm 包（如 `tree-sitter-kotlin`）一般自带 wasm 和 `tags.scm`；
  - 社区包 `tree-sitter-wasms` 覆盖 36 种语言，但它是用较老的 tree-sitter-cli 0.20 构建的，能否和新版运行时搭配使用，要先实测。
- **"支持"和"验证过"不是一回事：** 打包进来的语言都能用，但切块阈值和例外表，只能在团队常用的语言上，用真实 PR 逐一调整和验证。

**首批验证语言：Python、Rust、TypeScript（含 TSX）。** JavaScript 和 TS 共用同一套规则，所以一并注册。其余 11 种语言要等补上各自的 `tags.scm` 之后再注册；在那之前，它们按"暂不支持"处理，只显示普通 diff。下面这些例外已经在真实 PR 上验证过：

- **Python：** `with_clause` 和 `with_item` 会被后缀规则误判为语句级节点，需要排除，否则 `with` 这一行会被单独切成一块。装饰器靠 `decorated_definition` 归入它所修饰的函数。
- **TypeScript：** 通用后缀规则同样能覆盖，包括 `lexical_declaration`、`interface_declaration`、`type_alias_declaration`、`catch_clause`、`method_definition`。
- **Rust：** 例外最多，例外表主要是为它写的：
  - 控制流在 Rust 里是表达式，不是语句，所以 `if_expression`、`match_expression`、`for_expression`、`while_expression`、`loop_expression` 要按复合语句处理。
  - `match_arm` 当作单元。像 `Err(e) => ...` 这样的分支，通常就是防御代码。
  - 函数末尾不带分号的返回值（例如 `Ok(v)`）不是语句节点，所以要把 `block` 的直接子节点都算作单元。
  - `?` 和 `.unwrap()` 写在语句内部，没法单独切出来，随所在的语句一起判断。
  - `#[...]` 属性归到它下面的条目；独立成行的 `macro_invocation` 也算作单元。

## 7. 模型：Jev 负责判断，通用模型负责生成

两者分开配置，各司其职：

| | Jev（TypeSafe） | 通用模型（OpenAI 兼容） |
|---|---|---|
| 用来做什么 | 判断每个块的类型、是否被约定排除 | 悬停解释，以后还有问答和审阅意见 |
| 返回什么 | 选项 + 各选项的概率 + 置信度 | 文字 |
| 速度和费用 | 每次几百毫秒；只按输入计费，$0.042 / 百万 token | 按所选模型的价格 |

### 7.1 Jev：给代码块下判断

**请求方式：**

- 同一个单元的所有块放在一次请求里问完。每个块问两个问题；Jev 会并行地给出答案，问题之间互相看不到对方的答案。
- 各个单元的请求并发发出（上限 8 个）。每返回一个单元的结果，就给这个单元上色，所以颜色会逐步铺满。
- 使用 SDK `@typesafe-ai/sdk`，在主进程里调用。遇到 429 限流时，SDK 默认会自动重试。
- 单次请求的上限是 64k token；其中 state 加上最长的那个问题不能超过 32k。超出的单元在界面上直接显示错误，v0.1 不做拆分。

**state（每个单元一份）：**

```json
{
  "pr": { "title": "Fix user lookup", "description": "..." },
  "policy": "MVP stage: no retries or fallbacks; validate input only at API boundaries.",
  "file": "src/api/user.ts",
  "code": "[B1] async function getUser(id) {\n[B2]   if (!id) throw new Error('id required');\n[B3]   try {\n...",
  "blocks": {
    "B2": "if (!id) throw new Error('id required');",
    "B3": "try {"
  }
}
```

- `code` 是这个单元的新版本代码，新增的行前面加上块 ID，用来给出上下文。
- `blocks` 让问题可以用路径直接引用某个块。官方建议用反引号写路径，并且尽量少绕弯子。
- 项目约定写在 state 里，只发送一次，不在每个问题里重复。

**每个块的两个问题：**

```json
"B2.role": {
  "type": "choice",
  "instructions": "What role does the code in `blocks.B2` play in this PR's change?",
  "criteria": {
    "core": "Implements what the PR is for; removing it breaks the normal path",
    "defense": "Only matters when something goes wrong: validation, error handling, retries, timeouts, fallbacks, null guards",
    "support": "Does not change behavior: logging, types, imports, wiring, boilerplate, config"
  }
},
"B2.excluded": {
  "type": "noul",
  "instructions": "Does `policy` say this project does not need code like `blocks.B2` at its current stage?"
}
```

- 第二个问题问的是"约定是否排除了这段代码"，而不是"这段代码是否必要"。原因有两个：Jev 按字面理解问题；约定里没提到的代码，本来就不该被标出来。
- 有约定时，每个块都问 `excluded`；没有约定时，这个问题不问。
- 问题和选项说明由我们用英文写，因为 Jev 在英文上最准。
- `.yolk.md` 用什么语言写都可以，原文直接交给 Jev，不做翻译。受语言影响的只有 `policy` 这一个字段：问题是我们用英文写的，代码本身也不受影响。M2 实测：同一个 PR 分别用中文和英文约定跑，各个块的约定排除概率相差不超过 0.04。

**初始阈值（需要在真实 PR 上调整）：**

- `role` 的置信度低于 0.5：颜色画淡，并加"?"，提示审阅者"这块值得亲自看看"。
- "只看核心"只折叠置信度不低于 0.5 的非核心块。拿不准的块始终显示。
- `excluded` 不低于 0.7：标上 ✂（建议删除）。**只看 `excluded`，不看 `role`。** 原因：一个 PR 如果目的就是加重试（例如 vellum-assistant#43329），它的重试代码会被 Jev 判为核心；可是约定排除概率高达 0.86。如果规定"核心块不标 ✂"，最该标出来的这块反而不标。而在 M2 跑过的几个 PR 里，真正的核心代码约定排除概率只有 0.09～0.23，去掉角色这个条件不会误标核心代码。
- 约定排除概率落在 0.5～0.7 的块，比如 hono 里的 try/catch（0.58～0.68），目前不标 ✂。等积累更多 PR 数据后再决定：要么降低阈值，要么在 M3 界面上用一个较弱的标记显示。

### 7.2 通用模型：生成文字

- 通过 OpenAI 兼容接口调用：`POST {baseURL}/chat/completions`。
- **悬停解释：** 鼠标停留 400ms 后才发请求。发给模型的内容包括：块的代码、所在的整个函数、文件路径。如果这个块被标了 ✂，还会带上项目约定和 Jev 的判断结果。
- 模型用 2~4 句中文回答：这段代码做什么；如果被标了 ✂，再说明约定为什么可能不需要它。不评价写得好坏。
- 解释结果按"head sha + 文件路径 + 块的行范围"缓存在内存里。
- 以后的问答、审阅意见生成，也都用通用模型。

### 7.3 设置

| 分组 | 字段 |
|---|---|
| Jev | API Key；模型，默认 `jev-latest`。阈值调好后，建议固定成具体版本号（例如 `jev-1.13.0`），避免别名自动升级到新版本后，原来的阈值不再适用 |
| 通用模型 | Base URL（例如 `https://api.openai.com/v1`、`https://api.deepseek.com/v1`、内网地址）；API Key；模型名 |

两个 API key 都用 Electron 的 safeStorage 加密后保存。

### 7.4 测试代码：直接标记，不问 Jev

M2 实测时，测试代码几乎全被判为支撑，hono 的测试文件 53 块全是。如果按支撑处理，打开"只看核心"后整个测试文件都会被折叠。所以改为：在代码里直接把测试代码标为"测试"，不交给 Jev 判断，也不参与折叠。识别方式有两种：

- **按文件路径**：`*.test.ts`、`*.spec.tsx`、`__tests__/`、`tests/`、`test/`、`spec/`、`test_*.py`、`*_test.py`、`conftest.py`。
- **写在源码里的测试**：目前只处理 Rust。被 `#[cfg(test)]`、`#[test]`、`#[tokio::test]`、`#[test_case]` 标注的条目都算测试，比如 `mod tests`。规则写在 `LangSpec.testAttribute`，实现在 `testcode.ts`。

还有一个附带的好处：请求 Jev 用的输入 token 明显减少。axum 那个 PR 从 5.8k 降到 1.1k，hono 从 18.8k 降到 2.1k。

## 8. 界面

```
┌──────────────────────────────────────────────────────────────────────┐
│ ◀ 待我审阅(3)   owner/repo #123 Fix user lookup   [只看核心 ○]  约定▸ ⚙ │
├──────────────────┬───────────────────────────────────────────────────┤
│ src/api/user.ts  │ ▌+ async function getUser(id) {                   │ 琥珀色 = 核心
│  核12 防9 撑3     │ ▌+   if (!id) throw new Error(...)          ✂     │ 蓝色 = 防御
│ src/db/index.ts  │ ┆+   const retries = 3                      ?      │ 淡色 + ? = 拿不准
│  核3 防0 撑5      │   ⋯ 防御 4 行（点击展开）                           │ 折叠
│ config.yaml      │ ▌+     const res = await fetch(...)               │
└──────────────────┴───────────────────────────────────────────────────┘
悬停浮层：核心 72% · 防御 25% · 支撑 3%（Jev 概率条）
          + 通用模型给出的中文解释
```

- **配色：** 核心为琥珀色（像蛋黄，也对应项目名 Yolk）；防御为蓝色；支撑为灰色；测试为绿色，打开"只看核心"时也不折叠；删除的行为淡红色。
- **颜色显示方式：** 显示在左侧色条和浅色背景上，不和 diff 原本的红绿色冲突。语法高亮用 Shiki。
- **差异视图自己绘制，不用现成的 diff 组件。** 按块着色、折叠和悬停需要精确控制每一行。
- **文件列表：** 显示每个文件三类代码各有多少行，以后也可以直接拿来做统计。

## 9. 实现顺序

每一步都可以单独验证：

1. **M1 切块（已完成）：** `npm run chunk -- <PR 链接>` 在终端打印块边界和判断单元，`npm test` 跑切块测试。已在 Python（flask）、Rust（axum）、TypeScript（hono）的真实 PR 上调过规则。
2. **M2 Jev 判断（已完成）：** `npm run judge -- <PR 链接> [--convention <约定文件>]` 在终端按颜色和置信度输出结果。在 hono、flask、axum、vellum-assistant 四个 PR 上验证过：每个 PR 约 6k～33k 个输入 token、端到端 4～10 秒；中英文约定的效果一致，不需要翻译。
3. **M3 客户端（已完成）：** 包括 Electron 外壳、设置页、首页和三色差异视图。
   - **首页：** 有"待我审阅"和"我创建的"两个 PR 列表，也可以直接粘贴 PR 链接。"我创建的"是计划之外加的：作者提 PR 前可以自己先审一遍。
   - **差异视图：** 支持"只看核心"折叠，拿不准的块画淡并加"?"，被约定排除的块标 ✂（原计划在 M4 做，因为判断结果里已有这个数据，就提前做了），测试代码显示为绿色。每个单元判断完就先上色，不用等全部结果。
   - **显示细节：** 夹在两行同类代码之间的空行也用同一种颜色，色带不会被截断；折叠提示里的行数不计空行。
   - **悬停浮层：** 目前显示 Jev 给出的三类概率，以及约定排除的概率。
   - **运行方式：** 构建后用 Playwright 驱动 Electron，在桌面上实际跑过。这台机器上 Chromium 的无界面模式会崩溃（最小的 Electron 程序也一样），也没有装 Xvfb。
4. **M4 悬停解释：** 用通用模型（OpenAI 兼容接口）生成中文解释，显示在悬停浮层里。

## 10. v0.1 刻意不做的事

我们自己也遵守这份项目约定：

- Jev SDK 自带的限流重试照常使用，除此之外不重试、不降级。
- 不缓存判断结果，重新打开 PR 就重新判断。Jev 按输入计费，价格很低。
- 超出长度上限的判断单元不做拆分。
- 暂不支持的编程语言不另写一套切块逻辑，只显示普通 diff。
- 出错时直接在界面上显示错误信息。

## 11. 路线图

1. **v0.1 桌面客户端：** 针对 GitHub PR 的三色差异视图。
2. **v0.2 扩展来源和反馈：**
   - 支持读取本地 git 仓库（GitLab、内网、未推送的分支）。
   - 审阅反馈：审阅者可以标记"这段防御其实需要"，标记写回 `.yolk.md`。
   - 引入 [Effect](https://effect.website)，只用在主进程和 core 层中调用外部服务的部分：
     - gh、git、Jev、通用模型各自包成一个 Service，测试时换成假的实现；
     - 错误改用类型来区分（gh 未登录、网络故障、缺少 key、被限流），界面按类型给出提示；
     - 切换 PR 或鼠标移开时，取消正在进行的请求；
     - 用 Schema 校验 IPC 消息、`settings.json` 和 gh 输出的 JSON。

     渲染进程，以及 `chunk.ts`、`diff.ts`、`rows.ts` 这类纯函数，都不改。到时候如果 Effect 4.0 已经正式发布（2026-09 时还在 RC 阶段），就直接用 4.0。在 Effect 里加重试只要一行代码，但仍然遵守项目约定：MVP 阶段不加重试。

     为什么不在 v0.1 引入：v0.1 要先验证"三色标注能不能让审阅更快"，这时引入只是把已经能跑的代码重写一遍。v0.2 要接入第二个数据来源、支持取消请求、写回文件，正好用得上 Effect，而且那时需要改的只有调用外部服务的约 500 行代码。
3. **v0.3 把审阅意见交给 agent：** 把审阅结论整理成修改指令，交给写代码的 agent；反复出现的问题写进 AGENTS.md。
4. **v0.4 团队协作审阅：** 分工和审阅状态；评论同步到 GitHub；统计防御代码占比的变化趋势，给 leader 看。

## 12. 待定问题

暂无。
