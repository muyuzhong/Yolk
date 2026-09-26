// Records real gh + Jev results into fixtures/yolk.json, which `npm run dev:web` replays in a plain browser.
// Adds to what is already recorded; delete the file to start over.
// Usage: TYPESAFE_API_KEY=... npm run capture -- <PR URL>...
import { TypeSafeClient } from '@typesafe-ai/sdk'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { chunkPullRequest, judgeFiles, type UnitResult } from '../src/core/analyze'
import { currentUser, listPullRequests, listRepositories, parsePrUrl } from '../src/core/sources/gh'
import type { Fixture } from '../src/renderer/src/dev/fixture'

const urls = process.argv.slice(2)
if (!urls.length) {
  console.error('用法：npm run capture -- <PR 链接>...')
  process.exit(1)
}

const FILE = 'fixtures/yolk.json'
const [login, repositories] = await Promise.all([currentUser(), listRepositories()])
// Adds to an existing recording, so capturing another repository does not re-judge (and re-pay for) the old PRs.
const previous: Fixture | null = await readFile(FILE, 'utf8').then(JSON.parse, () => null)
const fixture: Fixture = { login, repositories, pullRequests: previous?.pullRequests ?? {}, reviews: previous?.reviews ?? {} }

for (const url of urls) {
  const { owner, repo } = parsePrUrl(url)
  const fullName = `${owner}/${repo}`
  fixture.pullRequests[fullName] = await listPullRequests(fullName, 'all')

  console.log(`分块 ${url}`)
  const { pr, files } = await chunkPullRequest(url)
  // Recorded without a convention; the mock applies whatever convention its settings hold when replaying.
  const policy = null
  // judgeFiles merges judgments into the files it is given; keep the unjudged state the renderer first receives.
  const start = { pr, files: structuredClone(files), policy, policySource: null }
  const units: UnitResult[] = []
  console.log(`判断 ${files.length} 个文件`)
  const { model, inputTokens } = await judgeFiles(pr, files, { policy, client: new TypeSafeClient(), onUnit: (u) => units.push(u) })
  fixture.reviews[url] = { start, units, model, inputTokens }
}

await mkdir('fixtures', { recursive: true })
await writeFile(FILE, JSON.stringify(fixture))
console.log(`已写入 ${FILE}（新增 ${urls.length} 个 PR，共 ${Object.keys(fixture.reviews).length} 个）`)
