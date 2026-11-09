// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { RawResponse } from './body-hash'
import {
  addToCapture,
  compareStored,
  documentShape,
  emptyCapture,
  serialiseCapture,
  tagDifferences,
  type Capture,
} from './document-shape'

const page = (head: string, body = '<main>Hello</main>', headers: RawResponse['headers'] = {}): RawResponse => ({
  status: 200,
  headers: { 'content-type': 'text/html', ...headers },
  body: `<!DOCTYPE html><html lang="en"><head>${head}</head><body>${body}</body></html>`,
})

const shape = (res: RawResponse) => documentShape(res, 4101)

describe('documentShape', () => {
  it('reads two builds of one page as the same', () => {
    const build = (chunk: string, id: string) =>
      page(
        `<link rel="preload" as="script" fetchPriority="low" href="/_next/static/chunks/${chunk}.js"/><link rel="stylesheet" href="/_next/static/chunks/${chunk}.css"/><script src="/_next/static/chunks/${chunk}.js" async=""></script><title>About</title>`,
        `<!--$--><main id="${id}">Hello</main><!--/$--><script>self.__next_f.push([1,"${chunk}"])</script>`,
        { 'x-nextjs-matched-path': `/${chunk}` },
      )
    expect(shape(build('aaa', '_R_1_'))).toEqual(shape(build('bbb', '_R_2_')))
  })

  it('keeps head tags in order, with the opening html first', () => {
    const { tags } = shape(page('<meta charSet="utf-8"/><title>About</title><script>a()</script><script type="application/ld+json">{}</script>'))
    expect(tags).toEqual([
      '<html lang="en">',
      '<meta charSet="utf-8"/>',
      '<title>About</title>',
      '<script>a()</script>',
      '<script type="application/ld+json">{}</script>',
    ])
  })

  it('names a tag streamed into the body', () => {
    const { tags } = shape(page('', '<title>Late</title><meta name="description" content="x"/>'))
    expect(tags).toContain('in body: <title>Late</title>')
    expect(tags).toContain('in body: <meta name="description" content="x"/>')
  })

  it('keeps a stylesheet, so one that goes missing shows', () => {
    const one = shape(page('<link rel="stylesheet" href="/_next/static/chunks/a.css"/>'))
    const none = shape(page(''))
    expect(tagDifferences(one.tags, none.tags)).toEqual(['lost tag: <link rel="stylesheet" href="/_next/static/ASSET.css"/>'])
  })

  it('reads markup and JSON-LD in the body, and sees a change to either', () => {
    const base = shape(page('', '<main>Hello</main>'))
    expect(shape(page('', '<main>Hullo</main>')).bodySha).not.toBe(base.bodySha)
    expect(shape(page('', '<main>Hello</main><script type="application/ld+json">{}</script>')).bodySha).not.toBe(base.bodySha)
  })

  it('keeps two React ids apart, so a swapped reference still shows', () => {
    const a = shape(page('', '<input id="_R_1_"/><label for="_R_1_"></label><input id="_R_2_"/>'))
    const b = shape(page('', '<input id="_R_1_"/><label for="_R_2_"></label><input id="_R_2_"/>'))
    expect(a.bodySha).not.toBe(b.bodySha)
  })

  it('masks an error digest, and keeps the boundary it sits on', () => {
    const boundary = (digest: string) => `<template data-dgst="${digest}"></template>`
    expect(shape(page('', boundary('1'))).bodySha).toBe(shape(page('', boundary('22'))).bodySha)
    expect(shape(page('', boundary('1'))).bodySha).not.toBe(shape(page('', '')).bodySha)
  })

  it('keeps a header that says how a page is cached', () => {
    const a = shape(page('', '', { 'cache-control': 's-maxage=31536000' }))
    const b = shape(page('', '', { 'cache-control': 'private, no-store' }))
    expect(a.headers['cache-control']).not.toBe(b.headers['cache-control'])
  })

  it('shortens a long value, and still tells two apart', () => {
    const a = shape(page(`<meta name="x" content="${'a'.repeat(300)}"/>`)).tags[1]
    const b = shape(page(`<meta name="x" content="${'a'.repeat(299)}b"/>`)).tags[1]
    expect(a.length).toBeLessThan(120)
    expect(a).not.toBe(b)
  })
})

describe('tagDifferences', () => {
  it('names a tag lost and a tag gained', () => {
    expect(tagDifferences(['<a>', '<b>'], ['<a>', '<c>'])).toEqual(['lost tag: <b>', 'gained tag: <c>'])
  })

  it('reports a reorder', () => {
    expect(tagDifferences(['<a>', '<b>'], ['<b>', '<a>'])).toEqual(['the same tags in another order'])
  })

  it("lets Next's size marker move, and still sees it go", () => {
    const marker = '<meta name="next-size-adjust" content=""/>'
    expect(tagDifferences([marker, '<a>', '<b>'], ['<a>', '<b>', marker])).toEqual([])
    expect(tagDifferences([marker, '<a>', '<b>'], ['<b>', '<a>', marker])).toEqual(['the same tags in another order'])
    expect(tagDifferences([marker, '<a>'], ['<a>'])).toEqual([`lost tag: ${marker}`])
  })

  it('counts a repeated tag', () => {
    expect(tagDifferences(['<a>', '<a>'], ['<a>'])).toEqual(['lost tag: <a>'])
  })
})

describe('captures', () => {
  const captureOf = (res: RawResponse) => {
    const capture = emptyCapture(null, 'sources')
    addToCapture(capture, 'host /about plain', shape(res))
    return capture
  }

  it('survive being written and read back', () => {
    const capture = captureOf(page('<title>About</title>'))
    expect(JSON.parse(serialiseCapture(capture))).toEqual(capture)
  })

  it('compare equal for one page, and report what moved', () => {
    const a = captureOf(page('<title>About</title>', '<main>x</main>', { 'cache-control': 'one' }))
    const b = captureOf(page('<title>Other</title>', '<main>y</main>', { 'cache-control': 'two' }))
    expect(compareStored(a, a, 'host /about plain', { body: true })).toEqual([])
    expect(compareStored(a, b, 'host /about plain', { body: true })).toEqual([
      'lost tag: <title>About</title>',
      'gained tag: <title>Other</title>',
      'header cache-control: one vs two',
      'body (34 vs 34 chars)',
    ])
    expect(compareStored(a, b, 'host /about plain', { body: false })).not.toContain('body (34 vs 34 chars)')
  })

  it("skip a static file's last-modified, which the checkout sets, and still report other headers", () => {
    const a = captureOf(page('', '', { 'last-modified': 'Fri, 06 Nov 2026 21:44:38 GMT', 'cache-control': 'one' }))
    const b = captureOf(page('', '', { 'last-modified': 'Sun, 08 Nov 2026 20:26:00 GMT', 'cache-control': 'one' }))
    const c = captureOf(page('', '', { 'last-modified': 'Sun, 08 Nov 2026 20:26:00 GMT', 'cache-control': 'two' }))
    expect(compareStored(a, b, 'host /about plain', { body: true })).toEqual([])
    expect(compareStored(a, c, 'host /about plain', { body: true })).toEqual(['header cache-control: one vs two'])
  })

  it('report an answer only one side has', () => {
    const a = captureOf(page(''))
    expect(compareStored(a, emptyCapture(null, ''), 'host /about plain', { body: true })).toEqual(['only in the first capture'])
    expect(compareStored(emptyCapture(null, ''), a, 'host /about plain', { body: true })).toEqual(['only in the second capture'])
  })
})

/*
 * B5c's before-and-after: a harness build of the merge base against one of this
 * branch, on the same paths. See stellr-document.spec.ts for how each is captured.
 *
 * It is a one-time proof, so it reads `split`, a frozen copy of the head capture taken
 * when the split was made. `head` moves on: a later PR that changes a page's tags
 * regenerates it, and that says nothing about what the split did. Never regenerate
 * `split` or `base` for such a change.
 */
describe('the root layout split changes nothing on Stellr pages', () => {
  const read = (file: string) => JSON.parse(readFileSync(file, 'utf8')) as Capture
  const base = read('e2e/tenancy/stellr-document-base.json')
  const live = read('e2e/tenancy/stellr-document-head.json')
  const head = read('e2e/tenancy/stellr-document-split.json')

  it('holds a capture of the merge base', () => {
    expect(base.commit).toMatch(/^[0-9a-f]{40}$/)
    expect(head.commit).toBeNull()
  })

  // What ties the frozen copy to a build: the spec holds `live` to the build in front of
  // it. Once the sources have moved on, the two are free to differ.
  it('froze the head capture that was taken from these sources', () => {
    expect(live.sourcesSha === head.sourcesSha ? live : head).toEqual(head)
  })

  it('asks the same paths on both builds', () => {
    expect(Object.keys(head.entries).sort()).toEqual(Object.keys(base.entries).sort())
    expect(Object.keys(base.entries).length).toBeGreaterThan(600)
  })

  it('renders a real share of them, so matching means something', () => {
    const rendered = Object.values(base.entries).filter(([status]) => status === 200)
    expect(rendered.length).toBeGreaterThan(100)
  })

  // The one thing the move does change. Next names a share card under a route group by
  // a hash of the group's path, so the og:image URL takes a new suffix. Named here, by
  // its exact old and new value, so that anything else still fails. next.config.mjs
  // keeps the old URLs answering, and stellr-document.spec.ts checks they do.
  const RENAMED_SHARE_CARDS = [
    ['/lp/', 'opengraph-image-k8l0a9', 'opengraph-image-1ypvlb'],
    ['/credentials/', 'opengraph-image-14f88v', 'opengraph-image-bboc2v'],
  ]
  const withRenames = (capture: Capture): Capture => {
    let text = JSON.stringify(capture)
    for (const [, before, after] of RENAMED_SHARE_CARDS) text = text.replaceAll(before, after)
    return JSON.parse(text) as Capture
  }

  it('answers every one alike: status, headers, each head tag in order, and the markup', () => {
    const renamed = withRenames(base)
    const differing = Object.keys(base.entries).flatMap((key) =>
      compareStored(renamed, head, key, { body: true }).map((difference) => `${key}: ${difference}`),
    )
    expect(differing).toEqual([])
  })

  it('finds the share card rename it allows for, so it is not hiding nothing', () => {
    for (const [prefix, before, after] of RENAMED_SHARE_CARDS) {
      const tags = (capture: Capture) => Object.values(capture.tagSets).flat().filter((tag) => tag.includes(prefix) && tag.includes('og:image'))
      expect(tags(base).some((tag) => tag.includes(before))).toBe(true)
      expect(tags(head).some((tag) => tag.includes(after))).toBe(true)
    }
  })

  it('has no other share card under a route group', () => {
    const cards = Object.values(head.tagSets).flat().filter((tag) => /opengraph-image-[a-z0-9]{6}/.test(tag))
    const known = RENAMED_SHARE_CARDS.map(([, , after]) => after)
    expect(cards.filter((tag) => !known.some((name) => tag.includes(name)))).toEqual([])
  })
})
