// one-off: full-viewport screenshots of reference storybook stories
import { chromium } from 'playwright'
import http from 'node:http'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'
const [root, outDir, ...ids] = process.argv.slice(2)
const types = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.woff2':'font/woff2', '.otf':'font/otf', '.png':'image/png', '.svg':'image/svg+xml' }
const srv = http.createServer((req, res) => {
  let p = join(root, decodeURIComponent(req.url.split('?')[0]))
  if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html')
  if (!existsSync(p)) { res.writeHead(404); return res.end() }
  res.writeHead(200, { 'content-type': types[extname(p)] ?? 'application/octet-stream' }); res.end(readFileSync(p))
}).listen(0)
const port = srv.address().port
const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 900, height: 700 }, reducedMotion: 'reduce' })
for (const id of ids) {
  await pg.goto(`http://localhost:${port}/iframe.html?id=${id}&viewMode=story`, { waitUntil: 'networkidle' })
  await pg.waitForTimeout(800)
  await pg.screenshot({ path: join(outDir, id + '.png') })
}
await b.close(); srv.close()
