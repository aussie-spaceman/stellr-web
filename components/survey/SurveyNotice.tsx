import { Button } from '@stellr/web-ui'

// A survey link that can't be answered right now: not open yet, paused,
// closed, someone else's, or not a valid link at all.
export function SurveyNotice({ title, children, showAccountLinks }: { title: string; children: React.ReactNode; showAccountLinks?: boolean }) {
  return (
    <main className="min-h-screen bg-surface px-4 py-10 sm:py-16">
      <section className="mx-auto max-w-2xl rounded-ds-card border border-line bg-white p-6 sm:p-8">
        <p className="font-subheading text-xs font-semibold uppercase tracking-[0.14em] text-primary-deep">Stellr survey</p>
        <h1 className="mt-2 font-display text-2xl font-bold text-ink">{title}</h1>
        <div className="mt-3 space-y-3 text-content-body">{children}</div>
        {showAccountLinks && (
          <div className="mt-6 flex flex-wrap gap-3">
            <Button variant="primaryStrong" href="/community/credentials">View my credentials</Button>
            <Button variant="secondaryStrong" href="/community/surveys">My surveys</Button>
          </div>
        )}
      </section>
    </main>
  )
}
