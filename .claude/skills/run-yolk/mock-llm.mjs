// Minimal OpenAI-compatible /v1/chat/completions server for exercising hover explanations
// without a real model. The reply names the unit the app asked about and counts its lines by
// category, so it shows what was sent, and says whether the project convention was included.
// Usage: node .claude/skills/run-yolk/mock-llm.mjs [port]   (default 8787)
import { createServer } from 'node:http'

const port = Number(process.argv[2] || 8787)

createServer((req, res) => {
  let body = ''
  req.on('data', (chunk) => (body += chunk))
  req.on('end', () => {
    if (req.method !== 'POST' || !req.url.endsWith('/chat/completions')) {
      res.writeHead(404).end()
      return
    }
    const { model, messages } = JSON.parse(body)
    const prompt = messages.at(-1).content
    const unit = prompt.match(/^代码：(.*)$/m)?.[1] ?? '?'
    // Code lines look like "12 核心　　| code": count them by category.
    const counts = {}
    for (const [, tag] of prompt.matchAll(/^\s*\d+ (\S*)[\s　]*\|/gm)) if (tag) counts[tag] = (counts[tag] ?? 0) + 1
    const summary = Object.entries(counts).map(([tag, n]) => `${tag} ${n} 行`).join('、') || '没有判断结果'
    const policy = prompt.includes('项目约定：')
    const text = `模拟解释（${model}）：${unit}，${summary}。${policy ? '请求里带了项目约定。' : ''}`
    console.log(`[mock-llm] model=${model} unit=${JSON.stringify(unit)} ${summary} policy=${policy}`)
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(
      JSON.stringify({
        id: 'mock',
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: text } }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      }),
    )
  })
}).listen(port, '127.0.0.1', () => console.log(`mock-llm listening on http://127.0.0.1:${port}/v1`))
