import { getComplianceAudit } from '@/lib/compliance-admin'
import { ComplianceAuditTable } from '@/components/admin/ComplianceAuditTable'
import { ComplianceSyncButton } from '@/components/admin/ComplianceSyncButton'

export const metadata = { title: 'Admin — Background Checks' }

export default async function ComplianceAuditPage() {
  const audit = await getComplianceAudit()

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-heading uppercase text-title text-brand-blue-dark">Background Checks & Licenses</h1>
          <p className="mt-1 text-sm text-brand-muted-soft">
            Every adult in an event-facing role (teacher, mentor, volunteer, adult) who must be cleared to take part. Background checks are valid for 3 years;
            teacher licenses are valid until the expiry the teacher entered, once you verify them.
          </p>
        </div>
        <ComplianceSyncButton />
      </div>

      <ComplianceAuditTable
        rows={audit.rows}
        counts={audit.counts}
        reviewQueueCount={audit.reviewQueue.length}
      />
    </div>
  )
}
