import { supabaseServer } from '@/lib/supabase'
import { EmailManager } from '@/components/admin/email/EmailManager'

export const metadata = { title: 'Admin — Email Campaigns' }

export default async function AdminEmailPage() {
  const db = supabaseServer()
  const [{ data: templates }, { data: campaigns }, { data: tiers }] = await Promise.all([
    db
      .from('email_templates')
      .select('id, key, name, subject, body_json, updated_at')
      .eq('is_archived', false)
      .order('updated_at', { ascending: false }),
    db
      .from('email_campaigns')
      .select('id, name, trigger_type, scheduled_at, event_key, status, audience, sent_at, created_at, email_templates(name)')
      .neq('status', 'archived')
      .order('created_at', { ascending: false }),
    db
      .from('membership_tiers')
      .select('id, name, sort_order')
      .order('sort_order'),
  ])

  const campaignsOut = (campaigns ?? []).map((c) => {
    const tpl = Array.isArray(c.email_templates) ? c.email_templates[0] : c.email_templates
    return { ...c, templateName: (tpl as { name: string } | null)?.name ?? '—' }
  })

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-heading uppercase text-title text-brand-blue-dark">Email Campaigns</h1>
        <p className="mt-0.5 text-sm text-brand-muted-soft">
          Reusable templates and scheduled / event-triggered sends to members. Marketing-consent suppression is always applied.
        </p>
      </div>

      <EmailManager
        templates={templates ?? []}
        campaigns={campaignsOut}
        tiers={tiers ?? []}
      />
    </div>
  )
}
