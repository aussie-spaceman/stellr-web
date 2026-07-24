'use client'

import { useEffect, useRef } from 'react'
import { pushDataLayer, type DataLayerEvent } from '@/lib/analytics'

/**
 * Fires a single dataLayer event once, on mount. Render it from a server
 * component to emit a funnel event when a page loads (it renders nothing).
 *
 *   <TrackEvent event={{ event: 'competition_page_view', competition_id: slug, ... }} />
 *
 * The payload must contain zero PII — see lib/analytics.ts.
 */
export function TrackEvent({ event }: { event: DataLayerEvent }) {
  const fired = useRef(false)

  useEffect(() => {
    if (fired.current) return
    fired.current = true
    pushDataLayer(event)
    // Intentionally fire once per mount; a client-side route change unmounts and
    // remounts the page, giving a fresh event on the next detail page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return null
}
