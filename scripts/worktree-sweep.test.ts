import { describe, expect, it } from 'vitest'
import { classify, isInside, parseLsof, parsePorcelain } from './worktree-sweep.mjs'

const TIP = 'fb2396feb85513ca5f76acb19d513af0444ff1d7'
const OTHER = '894f9c0b8d2f2c44b33d555fd440053cebb56822'

const wt = { path: '/repo/../stellr-web-x', head: TIP, branch: 'chore/x' }
const clean = { appManaged: false, busy: [], dirty: [], prs: [], ahead: 3 }
const merged = (headRefOid = TIP) => ({ number: 420, state: 'MERGED', headRefOid })

describe('parsePorcelain', () => {
  const listing = [
    'worktree /gh/stellr-web',
    'HEAD 3b6960f5690d425861fa71c7491e63bfe7cab545',
    'branch refs/heads/dev',
    '',
    'worktree /gh/stellr-web-content-refresh',
    `HEAD ${TIP}`,
    'branch refs/heads/chore/content-refresh-2026-10',
    '',
    'worktree /gh/stellr-web/.claude/worktrees/mobile-phase0',
    `HEAD ${OTHER}`,
    'detached',
    'locked claude session mobile-phase0 (pid 10200)',
    '',
    'worktree /gh/stellr-web-gone',
    `HEAD ${OTHER}`,
    'branch refs/heads/docs/gone',
    'locked',
    'prunable gitdir file points to non-existent location',
    '',
  ].join('\n')

  it('keeps the main worktree first and strips refs/heads/', () => {
    const [main, refresh] = parsePorcelain(listing)
    expect(main).toEqual({ path: '/gh/stellr-web', head: '3b6960f5690d425861fa71c7491e63bfe7cab545', branch: 'dev' })
    expect(refresh.branch).toBe('chore/content-refresh-2026-10')
  })

  it('reads detached, locked with and without a reason, and prunable', () => {
    const [, , app, gone] = parsePorcelain(listing)
    expect(app).toMatchObject({ detached: true, locked: 'claude session mobile-phase0 (pid 10200)' })
    expect(app.branch).toBeUndefined()
    expect(gone.locked).toBe('')
    expect(gone.prunable).toBe('gitdir file points to non-existent location')
  })
})

describe('isInside', () => {
  it('matches the folder itself and anything below it', () => {
    expect(isInside('/gh/stellr-web-x', '/gh/stellr-web-x')).toBe(true)
    expect(isInside('/gh/stellr-web-x/app', '/gh/stellr-web-x')).toBe(true)
  })

  it('does not treat a sibling with the same prefix as inside', () => {
    expect(isInside('/gh/stellr-web-content-refresh-2', '/gh/stellr-web-content-refresh')).toBe(false)
    expect(isInside('/gh/stellr-web', '/gh/stellr-web-x')).toBe(false)
  })
})

describe('parseLsof', () => {
  it('pairs each cwd with the pid above it', () => {
    expect(parseLsof('p101\nfcwd\nn/gh/stellr-web\np202\nfcwd\nn/gh/stellr-web-x\n')).toEqual([
      { pid: 101, cwd: '/gh/stellr-web' },
      { pid: 202, cwd: '/gh/stellr-web-x' },
    ])
  })
})

describe('classify: removes only what has provably landed', () => {
  it('removes a clean worktree whose exact tip is a merged PR head', () => {
    expect(classify(wt, { ...clean, prs: [merged()] }).action).toBe('remove')
  })

  it('removes when an older PR on the same branch name also exists', () => {
    const prs = [{ number: 300, state: 'MERGED', headRefOid: OTHER }, merged()]
    expect(classify(wt, { ...clean, prs })).toMatchObject({ action: 'remove', reason: expect.stringContaining('#420') })
  })

  it('keeps an untracked file, such as the AGENTS.md next dev writes', () => {
    const r = classify(wt, { ...clean, dirty: ['AGENTS.md'], prs: [merged()] })
    expect(r).toMatchObject({ action: 'keep', reason: expect.stringContaining('AGENTS.md') })
  })

  it('keeps commits made after the merge (a post-merge handover)', () => {
    const r = classify({ ...wt, head: OTHER }, { ...clean, prs: [merged(TIP)] })
    expect(r).toMatchObject({ action: 'keep', reason: expect.stringContaining('after PR #420 merged') })
  })

  it('keeps an open PR, and one closed without merging', () => {
    expect(classify(wt, { ...clean, prs: [{ number: 425, state: 'OPEN', headRefOid: TIP }] }).reason).toContain('#425 is still open')
    expect(classify(wt, { ...clean, prs: [{ number: 9, state: 'CLOSED', headRefOid: TIP }] }).reason).toContain('closed without merging')
  })

  it('keeps a worktree a running process is using', () => {
    expect(classify(wt, { ...clean, busy: [4242], prs: [merged()] }).reason).toContain('pid 4242')
  })

  it('never removes on a fact it could not read', () => {
    for (const unread of [{ busy: null }, { dirty: null }, { prs: null }]) {
      expect(classify(wt, { ...clean, prs: [merged()], ...unread }).action).toBe('keep')
    }
  })

  it('leaves app-managed, locked and detached worktrees alone', () => {
    expect(classify(wt, { ...clean, appManaged: true, prs: [merged()] }).reason).toContain('app-managed')
    expect(classify({ ...wt, locked: '' }, { ...clean, prs: [merged()] }).reason).toBe('locked')
    expect(classify({ ...wt, branch: undefined, detached: true }, { ...clean, prs: [merged()] }).reason).toContain('detached')
  })

  it('prunes an entry whose folder is gone', () => {
    expect(classify({ ...wt, prunable: 'gitdir file points to non-existent location' }, clean).action).toBe('prune')
  })

  it('says whether a branch with no PR holds anything origin/dev lacks', () => {
    expect(classify(wt, { ...clean, ahead: 0 }).reason).toContain('nothing here that origin/dev lacks')
    expect(classify(wt, { ...clean, ahead: 2 }).reason).toBe('no PR; 2 commit(s) not on origin/dev')
  })
})
