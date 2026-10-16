import type { Page } from '@playwright/test'

/**
 * How far the page is wider than the screen, and what pokes out.
 *
 * Compares the document's scroll width with the layout viewport's
 * `clientWidth`, NOT `innerWidth`: mobile Chrome zooms out to fit a page that
 * is too wide, which grows `innerWidth` to match and hides the overflow from
 * any check against it. (That is how a review on 15 Oct 2026 first measured
 * /network as fine while it was 867px wide on every phone.)
 */
export async function horizontalOverflow(page: Page): Promise<{ overflowPx: number; offenders: string[] }> {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth
    const overflowPx = document.documentElement.scrollWidth - vw
    if (overflowPx <= 1) return { overflowPx: 0, offenders: [] }

    // Elements that reach past the right edge with no ancestor clipping them.
    const offenders: { el: string; right: number }[] = []
    for (const el of Array.from(document.body.querySelectorAll('*'))) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.right <= vw + 1) continue
      let clipped = false
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        if (/(hidden|clip|auto|scroll)/.test(getComputedStyle(p).overflowX) && p.getBoundingClientRect().right <= vw + 1) {
          clipped = true
          break
        }
      }
      if (clipped) continue
      const cls = typeof el.className === 'string' ? el.className.split(/\s+/).slice(0, 5).join('.') : ''
      offenders.push({ el: `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''} (right ${Math.round(r.right)})`, right: r.right })
    }
    // Innermost elements last; report the few that reach furthest.
    return {
      overflowPx,
      offenders: offenders
        .sort((a, b) => b.right - a.right)
        .slice(0, 5)
        .map((o) => o.el),
    }
  })
}

/** Path part of every URL in the site's sitemap. */
export async function sitemapPaths(page: Page): Promise<string[]> {
  const res = await page.request.get('/sitemap.xml')
  const xml = await res.text()
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname)
}
