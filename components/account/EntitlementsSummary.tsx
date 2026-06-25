import { getMemberEntitlementSummary } from '@/lib/entitlements'

// Member dashboard card: included coaching/mentoring balances + store credit +
// recent bookings, read from the entitlements ledger. Rendered in the Billing
// tab of /account. Defensive: if the entitlements schema isn't deployed yet (or
// a read fails) it renders nothing rather than breaking the page.
export async function EntitlementsSummary({ memberId }: { memberId: string }) {
  let summary
  try {
    summary = await getMemberEntitlementSummary(memberId)
  } catch {
    return null
  }

  const { coachingBalance, mentoringBalance, creditCents, bookings } = summary
  const hasAnything = coachingBalance > 0 || mentoringBalance > 0 || creditCents > 0 || bookings.length > 0
  if (!hasAnything) return null

  const money = (c: number) => `$${(c / 100).toFixed(2)}`

  return (
    <div className="rounded-xl border border-brand-border bg-white p-6">
      <h2 className="mb-1 text-base font-semibold text-brand-blue-dark">Sessions &amp; credit</h2>
      <p className="mb-4 text-xs text-brand-muted-soft">Your included coaching/mentoring and account credit.</p>

      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Coaching sessions" value={String(coachingBalance)} hint="included, remaining" />
        <Stat label="Mentoring cohorts" value={String(mentoringBalance)} hint="included this period" />
        <Stat label="Account credit" value={money(creditCents)} hint="applied at checkout" />
      </div>

      {bookings.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-brand-blue-dark">Recent bookings</h3>
          <table className="w-full text-sm">
            <thead className="text-left text-brand-muted-soft">
              <tr><th className="py-1 font-medium">Date</th><th className="font-medium">Status</th><th className="font-medium">Paid</th></tr>
            </thead>
            <tbody>
              {bookings.map((b) => (
                <tr key={b.id} className="border-t border-brand-border">
                  <td className="py-2">{new Date(b.created_at).toLocaleDateString()}</td>
                  <td className="capitalize">{b.status.replace('_', ' ')}</td>
                  <td>{b.amount_charged_cents > 0 ? money(b.amount_charged_cents) : 'Included'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-lg border border-brand-border bg-surface-muted px-4 py-3">
      <p className="text-xs text-brand-muted-soft">{label}</p>
      <p className="mt-0.5 font-display text-2xl font-bold text-ink">{value}</p>
      <p className="text-[11px] text-content-faint">{hint}</p>
    </div>
  )
}
