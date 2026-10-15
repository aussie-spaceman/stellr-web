/**
 * Placeholder shown the moment a member or admin link is tapped, while the
 * server prepares the page. Without one, a tap on a slow connection showed
 * nothing at all until the whole page arrived, which invites a second tap.
 */
export function PageSkeleton({ variant = 'list' }: { variant?: 'list' | 'cards' | 'table' }) {
  return (
    <div role="status" aria-live="polite" className="animate-pulse motion-reduce:animate-none">
      <span className="sr-only">Loading…</span>
      <div className="mb-6 space-y-2" aria-hidden>
        <div className="h-3 w-24 rounded bg-line-light" />
        <div className="h-8 w-56 max-w-full rounded bg-line-light" />
      </div>
      {variant === 'cards' && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" aria-hidden>
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="h-32 rounded-card border border-line bg-white" />
          ))}
        </div>
      )}
      {variant === 'list' && (
        <div className="space-y-3" aria-hidden>
          <div className="h-40 rounded-card border border-line bg-white" />
          <div className="h-24 rounded-card border border-line bg-white" />
          <div className="h-24 rounded-card border border-line bg-white" />
        </div>
      )}
      {variant === 'table' && (
        <div className="overflow-hidden rounded-card border border-line bg-white" aria-hidden>
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="h-12 border-b border-line-light last:border-b-0" />
          ))}
        </div>
      )}
    </div>
  )
}
