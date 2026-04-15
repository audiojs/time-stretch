// Browser test runner — starts server, launches headless Chromium via Playwright, captures tst output.
import { createServer } from 'http'
import { readFile } from 'fs/promises'
import { extname, normalize, resolve, sep } from 'path'
import { fileURLToPath } from 'url'
import { chromium } from 'playwright'

let root = fileURLToPath(new URL('..', import.meta.url)).replace(/\/+$/, '')
let types = { '.html': 'text/html', '.js': 'text/javascript' }

let server = createServer(async (req, res) => {
  let rel = normalize(req.url === '/' ? 'test/test.html' : req.url.split('?')[0]).replace(/^\//, '')
  let path = resolve(root, rel)
  if (!path.startsWith(root + sep)) { res.writeHead(403); res.end(); return }
  try {
    res.writeHead(200, { 'content-type': types[extname(path)] || 'application/octet-stream' })
    res.end(await readFile(path))
  } catch {
    res.writeHead(404); res.end()
  }
})

await new Promise(r => server.listen(0, r))
let port = server.address().port

let browser = await chromium.launch()
let page = await browser.newPage()
let failed = false

page.on('console', msg => {
  let text = msg.text()
  let clean = text.replace(/%c/g, '').replace(/ color: #[0-9a-f]+/gi, '').replace(/ color: \w+/gi, '').trim()
  if (clean && clean !== 'console.groupEnd') process.stdout.write(clean + '\n')
})
page.on('pageerror', err => { console.error('PAGE ERROR:', err.message); failed = true; done?.() })

let done
let wait = new Promise(r => {
  done = r
  page.on('console', msg => {
    if (msg.text().includes('# fail')) failed = true
    if (msg.text().includes('# total')) setTimeout(r, 500)
  })
})

try {
  await page.goto(`http://localhost:${port}`)
  await Promise.race([wait, new Promise((_, r) => setTimeout(() => r(new Error('Browser tests timed out (60s)')), 60000))])
} catch (e) {
  console.error(e.message); failed = true
} finally {
  await browser.close()
  server.close()
}
process.exit(failed ? 1 : 0)
