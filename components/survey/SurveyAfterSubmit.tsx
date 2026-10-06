import { Button } from '@stellr/web-ui'

// After submitting, and on re-opening a link once submitted (handover A4, P2):
// thanks, then a reason to use the web app — the event credential, and the
// account that keeps a history of surveys. A soft call to action only: the
// certificate is never gated behind the survey (D1).
export function SurveyAfterSubmit({ eventTitle, signedIn, justSubmitted }: { eventTitle: string; signedIn: boolean; justSubmitted: boolean }) {
  return (
    <section className="rounded-ds-card border border-line bg-white p-6 sm:p-8">
      <p className="font-subheading text-xs font-semibold uppercase tracking-[0.14em] text-enviro-green-text">
        {justSubmitted ? 'Submitted' : 'Already submitted'}
      </p>
      <h1 className="mt-2 font-display text-3xl font-bold text-ink">Thank you</h1>
      <p className="mt-3 text-content-body">
        {justSubmitted
          ? `Your answers about ${eventTitle} are in. We read every one, and they shape the next event.`
          : `Your answers about ${eventTitle} are already in. Submitted answers can’t be changed.`}
      </p>
      <div className="mt-6 rounded-control bg-surface p-5">
        <h2 className="font-display text-lg font-bold text-ink">Your {eventTitle} credential</h2>
        <p className="mt-1 text-sm text-content-body">
          Your certificate and credential live in your Stellr account, along with every survey you’ve submitted.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          {signedIn ? (
            <>
              <Button variant="primaryStrong" href="/community/credentials">View my credentials</Button>
              <Button variant="secondaryStrong" href="/community/surveys">My surveys</Button>
            </>
          ) : (
            <>
              <Button variant="primaryStrong" href="/sign-in?redirect_url=/community/credentials">Sign in</Button>
              <Button variant="secondaryStrong" href="/sign-up?next=/community/credentials">Create an account</Button>
            </>
          )}
        </div>
      </div>
    </section>
  )
}
