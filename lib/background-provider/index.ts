// Background-check provider selection. Call sites import getBackgroundProvider()
// and depend only on the BackgroundProvider interface — swapping vendors is a
// one-line change here plus the BACKGROUND_PROVIDER env var. Checkr is the
// default (US); a prior Certn implementation was retired in favour of it.

import type { BackgroundProvider } from '@/lib/background-provider/types'
import { checkrProvider } from '@/lib/background-provider/checkr'

export * from '@/lib/background-provider/types'

export function getBackgroundProvider(): BackgroundProvider {
  switch (process.env.BACKGROUND_PROVIDER) {
    case 'checkr':
    default:
      return checkrProvider
  }
}
