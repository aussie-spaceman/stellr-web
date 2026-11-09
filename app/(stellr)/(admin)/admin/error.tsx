'use client'

import { RouteError } from '@/components/ui/RouteError'

export default function AdminError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError {...props} />
}
