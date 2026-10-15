import { describe, it, expect, vi, afterEach } from 'vitest'
import { openPendingTab } from './open-in-new-tab'

function fakeTab() {
  return {
    opener: {} as unknown,
    closed: false,
    close: vi.fn(),
    location: { href: '' },
    document: { title: '', body: { textContent: '' } },
  }
}

describe('openPendingTab', () => {
  afterEach(() => vi.restoreAllMocks())

  it('opens a blank tab at once, without noopener, and cuts the opener link', () => {
    const tab = fakeTab()
    const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window)
    const pending = openPendingTab()
    expect(open).toHaveBeenCalledWith('', '_blank')
    expect(pending.open).toBe(true)
    expect(tab.opener).toBeNull()
  })

  it('points the tab at the URL once it is known', () => {
    const tab = fakeTab()
    vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window)
    openPendingTab().go('https://files.example/doc.pdf')
    expect(tab.location.href).toBe('https://files.example/doc.pdf')
  })

  it('closes the blank tab when there is nothing to open', () => {
    const tab = fakeTab()
    vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window)
    openPendingTab().close()
    expect(tab.close).toHaveBeenCalled()
  })

  it('goes there in this tab when the browser refuses a new one', () => {
    vi.spyOn(window, 'open').mockReturnValue(null)
    const assign = vi.fn()
    vi.spyOn(window, 'location', 'get').mockReturnValue({ assign } as unknown as Location)
    const pending = openPendingTab()
    expect(pending.open).toBe(false)
    pending.go('https://files.example/doc.pdf')
    expect(assign).toHaveBeenCalledWith('https://files.example/doc.pdf')
  })
})
