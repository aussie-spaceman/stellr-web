import type { Metadata } from 'next'
import { StopRemindersForm } from '@/components/survey/StopRemindersForm'

// "Stop survey reminders" from the footer of every survey email. A button,
// not an action on page load, so a link scanner can't opt anyone out.
export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Stop survey reminders',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

export default async function StopRemindersPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  return (
    <div className="min-h-screen bg-surface px-4 py-10 sm:py-16">
      <section className="mx-auto max-w-2xl rounded-ds-card border border-line bg-white p-6 sm:p-8">
        <p className="font-subheading text-xs font-semibold uppercase tracking-[0.14em] text-primary-deep">Stellr survey</p>
        <h1 className="mt-2 font-display text-2xl font-bold text-ink">Stop survey reminders</h1>
        <p className="mt-3 text-content-body">
          We’ll stop sending reminders about this survey. You can still answer it from the original link until it closes. Other Stellr emails aren’t affected.
        </p>
        <StopRemindersForm token={token} />
      </section>
    </div>
  )
}
