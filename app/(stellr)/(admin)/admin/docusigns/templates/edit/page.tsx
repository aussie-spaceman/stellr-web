import Link from 'next/link'
import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { supabaseServer } from '@/lib/supabase'
import { parseFieldMap } from '@/lib/esign/native/template'
import { TEMPLATE_KEYS } from '@/lib/esign/native/template-admin'
import { TemplateEditor } from '@/components/admin/TemplateEditor'

export const metadata = { title: 'Admin — Edit agreement document' }

// The field editor. ?from=<version id> starts from that version's file and
// fields; ?key=<document> starts a new document of that kind.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export default async function EditTemplatePage({ searchParams }: { searchParams: Promise<{ from?: string; key?: string }> }) {
  const { sessionClaims } = await auth()
  const role = (sessionClaims?.metadata as { role?: string } | undefined)?.role
  if (role !== 'admin') redirect('/account')

  const { from, key } = await searchParams
  let initial = { documentKey: TEMPLATE_KEYS.includes(key as never) ? (key as string) : 'minor', title: '', pdfPath: null as string | null, fields: [] as ReturnType<typeof parseFieldMap>['fields'], roles: [] as ReturnType<typeof parseFieldMap>['roles'], fromVersion: null as string | null }
  if (from && UUID.test(from)) {
    const { data } = await supabaseServer().from('esign_templates').select('id, key, version, title, pdf_path, field_map').eq('id', from).maybeSingle()
    if (data) {
      const map = parseFieldMap(data.field_map)
      initial = { documentKey: data.key as string, title: data.title as string, pdfPath: data.pdf_path as string, fields: map.fields, roles: map.roles, fromVersion: `${data.key} v${data.version}` }
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm">
          <Link href="/admin/docusigns/templates" className="text-primary-deep underline">Agreement documents</Link>
        </p>
        <h1 className="mt-1 font-heading text-2xl font-semibold text-ink">
          {initial.fromVersion ? `Edit fields, starting from ${initial.fromVersion}` : 'New agreement document'}
        </h1>
        <p className="mt-0.5 text-sm text-content-muted">
          Saving makes a new version. It is checked, then waits for approval before anyone is sent it.
        </p>
      </div>
      <TemplateEditor {...initial} keys={TEMPLATE_KEYS} />
    </div>
  )
}
