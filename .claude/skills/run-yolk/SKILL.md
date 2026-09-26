---
name: run-yolk
description: Build, run, and drive the Yolk Electron desktop client (three-color PR review). Use when asked to start or launch Yolk, open a PR in it, take a screenshot of its UI, check the review view / core-only folding / tooltip, or run its chunking/Jev scripts and tests.
---

Yolk is an Electron + React desktop client. Agents drive the built app through the REPL driver
`.claude/skills/run-yolk/driver.mjs` (Playwright `_electron`): pipe it a heredoc of commands for a
batch run, or wrap it in tmux. Most PRs touch `src/core/` - for those, the terminal scripts under
"Direct invocation" exercise the same pipeline without a window. All paths are relative to the repo root.

## Prerequisites

`gh` logged in (PR lists, diffs and file contents all go through it) and Node 22+:

```bash
gh auth status
node --version
```

Jev judgments need a TypeSafe key in the environment. On this machine it lives in a bash-syntax file:

```bash
. ~/.config/typesafe/env
```

## Setup

```bash
npm install
ls node_modules/electron/dist/electron || node node_modules/electron/install.js
```

## Build

The driver launches `out/main/index.js`, not the dev server - rebuild after every source change:

```bash
npm run build
```

## Run (agent path)

Batch run - one command per line, the driver exits after `quit`:

```bash
. ~/.config/typesafe/env && node .claude/skills/run-yolk/driver.mjs <<'EOF'
launch
open https://github.com/honojs/hono/pull/5377
wait-judged
files
file last
hover-block defense
ss review
core-only
ss core-only
quit
EOF
```

Interactive, in tmux (poll for the marker each command prints):

```bash
tmux new-session -d -s yolk -x 200 -y 50 -c "$PWD" 'bash --norc'
tmux send-keys -t yolk '. ~/.config/typesafe/env && node .claude/skills/run-yolk/driver.mjs' Enter
timeout 20 bash -c 'until tmux capture-pane -t yolk -p | grep -q "driver>"; do sleep 0.2; done'
tmux send-keys -t yolk 'launch' Enter
timeout 60 bash -c 'until tmux capture-pane -t yolk -p | grep -q "launched:"; do sleep 0.2; done'
tmux send-keys -t yolk 'open https://github.com/tokio-rs/axum/pull/3886' Enter
timeout 120 bash -c 'until tmux capture-pane -t yolk -p | grep -q "opened:"; do sleep 0.3; done'
tmux send-keys -t yolk 'wait-judged' Enter
timeout 150 bash -c 'until tmux capture-pane -t yolk -p | grep -q "status:"; do sleep 0.3; done'
tmux send-keys -t yolk 'quit' Enter
tmux capture-pane -t yolk -p | grep -v '^$'
tmux kill-session -t yolk
```

Screenshots land in `/tmp/yolk-shots/` (override with `SCREENSHOT_DIR`). The app runs with a throwaway
profile in `/tmp/yolk-shots/userdata`, so `~/.config/yolk` is never touched.

| command | what it does |
|---|---|
| `launch` | start the built app, wait for the home page and its `gh` PR lists |
| `open <PR URL>` | paste the URL on the home page, wait for the chunked diff (`opened: …`) |
| `wait-judged [seconds]` | wait until the header says 判断完成 / 判断失败, print it (default 120 s) |
| `status` | print the header status now |
| `files` | file list with per-category line counts (核心 / 防御 / 支撑 / 测试) |
| `file <n\|last>` | scroll file n (0-based) into view |
| `hover-block <core\|defense\|support\|test\|pending>` | hover the first line of that category, print the tooltip |
| `core-only` | toggle 只看核心, print how many fold rows exist |
| `settings` / `home` | navigate |
| `ss [name]` | screenshot to `$SCREENSHOT_DIR/<name>.png` |
| `click <css>` / `text [css]` / `eval <js>` | generic DOM helpers |
| `quit` | close the app and exit |

## Direct invocation (no window)

Same chunking and Jev code as the app, printed to the terminal:

```bash
npm run chunk -- https://github.com/tokio-rs/axum/pull/3886
. ~/.config/typesafe/env && npm run judge -- https://github.com/tokio-rs/axum/pull/3886
```

`npm run judge -- <url> --convention <file>` judges against a convention file instead of the repo's `.yolk.md`.

## Test

```bash
npm test
npm run typecheck
```

21 tests pass (chunking, diff parsing, Jev request building, test-code detection, display rows); none call an API.

## Gotchas

- **The window opens on the real desktop.** `--ozone-platform=headless` makes Electron 44 SIGSEGV here - even a
  ten-line app, with or without `--disable-gpu` - and there is no Xvfb, weston or cage; Xwayland has no headless
  mode. So the driver runs on the live KDE Wayland session and a Yolk window appears while it works.
- **Jev is not deterministic for borderline blocks.** In honojs/hono#5377 the `?` block (lines 55-56) came back
  core in one run and support in the next. Assert on confident blocks (the try/catch there is defense in every
  run), not on unsure ones.
- **The Jev key comes from the driver's environment.** The throwaway profile has empty settings, so the SDK
  reads `TYPESAFE_API_KEY`; without it the diff still renders but the header shows 判断失败 (see Troubleshooting).
- **tmux here starts fish** (with a fastfetch greeting), and `~/.config/typesafe/env` is bash syntax - start the
  session with `bash --norc` as above.
- **Test code never goes to Jev.** Test files and Rust `#[cfg(test)]` items render green at once and are not
  counted in "Jev 判断中 x/y".
- The driver never saves settings: saving encrypts keys through Electron's safeStorage (the OS keyring), which
  automation has not exercised.
- Harmless stderr: `'--ozone-platform=wayland' is not compatible with Vulkan`, Fontconfig cache warnings.

## Troubleshooting

- **`<process did exit: exitCode=null, signal=SIGSEGV>` right after launch**: `--ozone-platform=headless` was
  passed. Launch without it (the driver does).
- **`status: 判断失败：No API key was provided. Pass \`apiKey\` to the TypeSafeClient constructor or set the TYPESAFE_API_KEY environment variable.`**:
  the driver was started without the key - `. ~/.config/typesafe/env` in the same shell first.
- **`open failed: 打开 PR 失败：Command failed: gh pr view … Post "https://api.github.com/graphql": net/http: TLS handshake timeout`**:
  a transient network failure inside `gh`; the app shows it on the error page. Run `open` again. Review commands
  after a failed `open` stop at once with `ERROR: no review open`.
- **`node_modules/electron/dist` missing after `npm install`**: the Electron postinstall did not run; the Setup
  line runs `node node_modules/electron/install.js`.
