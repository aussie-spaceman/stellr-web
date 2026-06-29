import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { notifyMember } from '@/lib/notify'
import { grantTierAllocations } from '@/lib/entitlements'

// GET /api/cron/alumni-upgrades — runs daily (see vercel.json).
// The Alumni tier "automatically upgrades on July 1st of the School Student's
// graduating year" (PRD §2). Grants a complimentary active Alumni membership to
// members whose graduation_year has passed (on/after July 1), expiring their
// existing FREE membership. Paid memberships are left untouched. Idempotent via
// sent_reminders (kind='alumni').

export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = supabaseServer()
  const today = new Date()
  const year = today.getUTCFullYear()
  const julyFirstThisYear = Date.UTC(year, 6, 1) // month 6 = July

  // Alumni tier.
  const { data: alumniTier } = await db
    .from('membership_tiers')
    .select('id')
    .eq('name', 'Alumni')
    .maybeSingle()
  if (!alumniTier) return NextResponse.json({ error: 'Alumni tier not found', upgraded: 0 }, { status: 200 })

  // Candidates: graduation year is set and has been reached.
  const { data: members } = await db
    .from('members')
    .select('id, graduation_year')
    .not('graduation_year', 'is', null)
    .lte('graduation_year', year)
  if (!members?.length) return NextResponse.json({ upgraded: 0 })

  let upgraded = 0

  for (const m of members) {
    const gradYear = m.graduation_year as number
    // For the current graduating cohort, only act on/after July 1.
    if (gradYear === year && today.getTime() < julyFirstThisYear) continue

    // Dedupe one upgrade per member per graduating year.
    const { error: dedupeErr } = await db
      .from('sent_reminders')
      .insert({ kind: 'alumni', ref_id: m.id, member_id: m.id, bucket: String(gradYear) })
    if (dedupeErr) continue // already processed

    // Skip if already on Alumni.
    const { data: existingAlumni } = await db
      .from('member_memberships')
      .select('id')
      .eq('member_id', m.id)
      .eq('tier_id', alumniTier.id)
      .eq('renewal_status', 'active')
      .maybeSingle()
    if (existingAlumni) continue

    // Expire active FREE memberships (leave paid ones intact).
    const { data: actives } = await db
      .from('member_memberships')
      .select('id, membership_tiers(is_free)')
      .eq('member_id', m.id)
      .eq('renewal_status', 'active')
    for (const a of actives ?? []) {
      const tier = Array.isArray(a.membership_tiers) ? a.membership_tiers[0] : a.membership_tiers
      if ((tier as { is_free?: boolean } | null)?.is_free) {
        await db.from('member_memberships').update({ renewal_status: 'expired' }).eq('id', a.id)
      }
    }

    const { data: mm } = await db.from('member_memberships').insert({
      member_id: m.id,
      tier_id: alumniTier.id,
      started_at: today.toISOString().split('T')[0],
      renewal_status: 'active',
      is_complimentary: true,
      source: 'system',
    }).select('id').maybeSingle()
    if (mm?.id) await grantTierAllocations(mm.id).catch((e) => console.error('[alumni-upgrades] grantTierAllocations (non-fatal):', e))

    await notifyMember(m.id, {
      type: 'session',
      body: 'Congratulations — your membership has been upgraded to Alumni. 🎓',
    })
    upgraded++
  }

  return NextResponse.json({ upgraded })
}
