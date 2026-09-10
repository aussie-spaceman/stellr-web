/**
 * dev.mjs — start `next dev` on a port this worktree owns.
 *
 *   npm run dev
 *
 * Several sessions run in sibling git worktrees at once. Every one of them used
 * to call `next dev` with no port, so all four raced for 3000: the second to
 * start either failed or, worse, silently attached to the first one's server
 * and served the wrong branch's code.
 *
 * A port is claimed by writing PORT into this worktree's .env.local (gitignored,
 * per-worktree). Claims are read back from EVERY sibling worktree before
 * choosing, because a live-listener probe cannot see a dev server that has not
 * been started yet — two idle worktrees would otherwise both be handed 3000.
 *
 * The main worktree keeps 3000 when it is free, so .claude/launch.json and any
 * bookmarked localhost:3000 still point where people expect.
 */
import { spawn } from 'node:child_process'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:net'
import { existsSync, readFileSync, appendFileSync } from 'node:fs'
import { join, basename } from 'node:path'

const BASE_PORT = 3000
const MAX_PORT = 3100

/** Absolute paths of every worktree of this repository, including this one. */
function worktrees() {
  const out = execFileSync('git', ['worktree', 'list', '--porcelain'], { encoding: 'utf8' })
  return out
    .split('\n')
    .filter((l) => l.startsWith('worktree '))
    .map((l) => l.slice('worktree '.length).trim())
}

/** PORT= values already claimed by any worktree's .env.local. */
function claimedPorts(here) {
  const claimed = new Map()
  for (const wt of worktrees()) {
    const envFile = join(wt, '.env.local')
    if (!existsSync(envFile) || wt === here) continue
    const match = readFileSync(envFile, 'utf8').match(/^PORT=(\d+)\s*$/m)
    if (match) claimed.set(Number(match[1]), basename(wt))
  }
  return claimed
}

function portInUse(port) {
  return new Promise((resolve) => {
    const server = createServer()
    server.once('error', () => resolve(true))
    server.once('listening', () => server.close(() => resolve(false)))
    server.listen(port, '127.0.0.1')
  })
}

function ownPort(here) {
  const envFile = join(here, '.env.local')
  if (!existsSync(envFile)) return null
  const match = readFileSync(envFile, 'utf8').match(/^PORT=(\d+)\s*$/m)
  return match ? Number(match[1]) : null
}

async function main() {
  const here = process.cwd()

  // An explicit PORT in the environment always wins — this script allocates a
  // default, it does not overrule a deliberate choice.
  let port = process.env.PORT ? Number(process.env.PORT) : ownPort(here)

  if (!port) {
    const claimed = claimedPorts(here)
    for (let candidate = BASE_PORT; candidate <= MAX_PORT; candidate++) {
      if (claimed.has(candidate)) continue
      if (await portInUse(candidate)) continue
      port = candidate
      break
    }

    if (!port) {
      console.error(`dev: no free port between ${BASE_PORT} and ${MAX_PORT}.`)
      process.exit(1)
    }

    const envFile = join(here, '.env.local')
    if (!existsSync(envFile)) {
      console.error(
        'dev: .env.local not found. Copy .env.local.example and fill it in —\n' +
          '     the port is recorded there so sibling worktrees can see the claim.',
      )
      process.exit(1)
    }
    appendFileSync(envFile, `\n# Claimed by scripts/dev.mjs so sibling worktrees pick another port.\nPORT=${port}\n`)
    console.log(`dev: claimed port ${port} for ${basename(here)} (written to .env.local)`)
  }

  pinLocalOrigins(here, port)

  const others = claimedPorts(here)
  if (others.size) {
    const list = [...others].map(([p, name]) => `${name}:${p}`).join(', ')
    console.log(`dev: sibling worktrees — ${list}`)
  }

  console.log(`dev: http://localhost:${port}\n`)

  spawn('npx', ['next', 'dev', '-p', String(port)], {
    stdio: 'inherit',
    env: { ...process.env, PORT: String(port) },
  }).on('exit', (code) => process.exit(code ?? 0))
}

main()

/**
 * Point NEXT_PUBLIC_SITE_URL and NEXT_PUBLIC_AUTH_APP_URL at this worktree.
 *
 * WHY (10 Sept 2026): lib/env.ts defaults both to the PRODUCTION origins, which
 * is right for a deployment and wrong for a laptop. With them unset, proxy.ts
 * did exactly what it is supposed to do and redirected every public route off
 * localhost to www.stellreducation.org — so `npm run dev` and, worse, the whole
 * Playwright smoke suite were exercising PRODUCTION. Smoke only asserts a
 * non-error status and one <h1>; production satisfies both, so it reported a
 * confident green while never once loading local code.
 *
 * Both are set to the same origin on purpose: that is the single-host branch in
 * proxy.ts (IS_SINGLE_HOST), which serves www and app routes together instead
 * of redirecting between two hosts that do not exist locally.
 *
 * Only ever ADDS them. A worktree that has deliberately set either — pointing
 * at a preview deployment, say — is left alone.
 */
function pinLocalOrigins(here, port) {
  const envFile = join(here, '.env.local')
  const current = readFileSync(envFile, 'utf8')
  const origin = `http://localhost:${port}`

  const missing = ['NEXT_PUBLIC_SITE_URL', 'NEXT_PUBLIC_AUTH_APP_URL'].filter(
    (name) => !new RegExp(`^${name}=`, 'm').test(current),
  )
  if (!missing.length) return

  appendFileSync(
    envFile,
    `\n# Added by scripts/dev.mjs. Without these, lib/env.ts falls back to the\n` +
      `# production origins and proxy.ts redirects local routes to the live site.\n` +
      missing.map((name) => `${name}=${origin}\n`).join(''),
  )
  console.log(`dev: pinned ${missing.join(' and ')} to ${origin}`)
}
