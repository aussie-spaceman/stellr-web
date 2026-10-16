/**
 * A new tab for a URL that only arrives after an await (a signed link, a
 * rendered preview).
 *
 * iOS Safari lets a page open a window only during the tap itself. A
 * `window.open` after a fetch counts as a popup and is silently dropped, so
 * the button looks dead. Call this synchronously in the click handler, before
 * the first await: it opens a blank tab while the tap still counts, and `go`
 * points that tab at the URL once it is known.
 *
 * `noopener` can't be passed here (it makes `window.open` return null, and the
 * tab could never be pointed anywhere), so the opener link is cut by hand.
 */
export interface PendingTab {
  /** True while the blank tab exists: false if the browser refused it or the reader closed it. */
  readonly open: boolean
  /** Sends the tab to `url`. With no tab, goes there in this one. */
  go(url: string): void
  /** Closes the blank tab (the fetch failed, or there is nothing to open). */
  close(): void
}

export function openPendingTab(): PendingTab {
  let tab: Window | null = null
  try {
    tab = window.open('', '_blank')
  } catch {
    tab = null
  }
  if (tab) {
    try {
      tab.opener = null
      tab.document.title = 'Opening…'
      tab.document.body.textContent = 'Opening…'
    } catch {
      /* cosmetic only */
    }
  }
  const live = () => !!tab && !tab.closed
  return {
    get open() {
      return live()
    },
    go(url: string) {
      if (tab && live()) tab.location.href = url
      else window.location.assign(url)
    },
    close() {
      if (tab && live()) tab.close()
    },
  }
}
