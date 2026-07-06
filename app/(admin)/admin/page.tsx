import Link from 'next/link'

export const metadata = { title: 'Admin — Dashboard' }

// Admin landing page. The members list now lives at /admin/members; this will
// grow into an at-a-glance operations dashboard.
export default function AdminDashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow flex items-center gap-2 text-brand-blue">
          <span className="h-2 w-2 rounded-full bg-brand-blue-bright" /> Admin
        </p>
        <h1 className="mt-1 font-heading uppercase text-title text-brand-blue-dark">Dashboard</h1>
      </div>

      <div className="app-card p-6">
        <p className="text-sm text-brand-muted">Dashboard coming soon.</p>
        <Link
          href="/home"
          className="mt-4 inline-block rounded-lg bg-brand-blue px-4 py-2 text-sm font-medium text-white hover:bg-brand-blue-dark"
        >
          Return to web app
        </Link>
      </div>
    </div>
  )
}
