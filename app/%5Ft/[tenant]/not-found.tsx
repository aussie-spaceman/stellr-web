import { SectionHeading } from '@stellr/web-ui'

export default function TenantNotFound() {
  return (
    <>
      <SectionHeading title="We can’t find that page" />
      <p className="mt-4 max-w-prose text-ink">
        Check the link your organiser sent you, or ask them for a new one.
      </p>
    </>
  )
}
