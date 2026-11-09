import { Eyebrow } from '@stellr/web-ui'

/** What the banner address answers when no check-in is open: Stellr's page and the tenant tree's. */
export function checkInNotOpen() {
  return (
    <div className="flex items-start justify-center bg-surface px-4 py-8">
      <div className="w-full max-w-md space-y-3 rounded-ds-card border border-line bg-white p-6 text-center shadow-xs">
        <Eyebrow>Event check-in</Eyebrow>
        <h1 className="font-display text-xl font-bold text-ink">Check-in isn’t open yet</h1>
        <p className="text-content-body">
          Head to the registration desk and we’ll check you in, or scan the code again in a few minutes.
        </p>
      </div>
    </div>
  )
}
