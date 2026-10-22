import type { MetadataRoute } from 'next'
import { webManifest } from '@/lib/web-manifest'

/**
 * The public site's manifest, built once at deploy. The member app's variant is
 * app/app.webmanifest; next.config serves it at this URL on the app host.
 */
export default function manifest(): MetadataRoute.Manifest {
  return webManifest(false)
}
