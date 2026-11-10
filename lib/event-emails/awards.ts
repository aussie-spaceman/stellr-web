// Event-level merge fields from the event's awards, for the close-out email:
// who won what, and which company were the Overall Event Champions. Read from
// the award assignments (Certificates tab), so they are right as soon as the
// awards are entered, before or after they are issued.
//
// Names are first names only: this email goes to every family on the roster.
// Two winners in one list who share a first name get a last initial.

import type { SupabaseClient } from '@supabase/supabase-js'
import { isAssignedAwardType, type AssignedAwardType } from '@/lib/event-awards'

export const AWARD_MERGE_TOKENS = [
  'champion_company',
  'individual_award_winners',
  'norm_chaffee_winners',
  'anita_gale_winners',
  'dick_edwards_winners',
] as const

export interface AwardWinner {
  awardType: AssignedAwardType
  participantId: string
  firstName: string
  lastName: string
  companyId: string | null
}

export interface AwardCompany {
  id: string
  number: number
  name: string | null
}

export function joinNames(names: string[]): string {
  const uniq = [...new Set(names.filter(Boolean))]
  if (uniq.length <= 1) return uniq[0] ?? ''
  return `${uniq.slice(0, -1).join(', ')} and ${uniq[uniq.length - 1]}`
}

/** "Lily, Riley S. and Riley T.": first names, a last initial only where two share one. */
export function winnerNames(people: { participantId: string; firstName: string; lastName: string }[]): string {
  const seen = new Map<string, (typeof people)[number]>()
  for (const p of people) if (!seen.has(p.participantId)) seen.set(p.participantId, p)
  const list = [...seen.values()]
    .map((p) => ({ first: p.firstName.trim(), last: p.lastName.trim() }))
    .filter((p) => p.first)
  const count = new Map<string, number>()
  for (const p of list) count.set(p.first.toLowerCase(), (count.get(p.first.toLowerCase()) ?? 0) + 1)
  const labelled = list
    .map((p) => ((count.get(p.first.toLowerCase()) ?? 0) > 1 && p.last ? `${p.first} ${p.last[0].toUpperCase()}.` : p.first))
    .sort((a, b) => a.localeCompare(b))
  return joinNames(labelled)
}

export function companyName(c: AwardCompany | undefined): string {
  if (!c) return ''
  return c.name?.trim() || `Company ${c.number}`
}

/** Pure: assignments + companies in, merge values out. */
export function awardMergeVars(winners: AwardWinner[], companies: AwardCompany[]): Record<string, string> {
  const of = (t: AssignedAwardType) => winners.filter((w) => w.awardType === t)
  const byId = new Map(companies.map((c) => [c.id, c]))
  const championCompanies = [...new Set(of('overall_champion').map((w) => w.companyId).filter((id): id is string => !!id))]
    .map((id) => byId.get(id))
    .filter((c): c is AwardCompany => !!c)
    .sort((a, b) => a.number - b.number)
  return {
    champion_company:         joinNames(championCompanies.map(companyName)),
    individual_award_winners: winnerNames(winners.filter((w) => w.awardType !== 'overall_champion')),
    norm_chaffee_winners:     winnerNames(of('norm_chaffee')),
    anita_gale_winners:       winnerNames(of('anita_gale')),
    dick_edwards_winners:     winnerNames(of('dick_edwards')),
  }
}

type AssignmentJoin = {
  award_type: string
  participant_id: string
  company_id: string | null
  participants: { first_name: string | null; last_name: string | null; company_id: string | null } | { first_name: string | null; last_name: string | null; company_id: string | null }[] | null
}

/** The award merge values for one event. A failed read leaves them empty and logs it. */
export async function loadAwardMergeVars(db: SupabaseClient, slug: string): Promise<Record<string, string>> {
  const [{ data: rows, error }, { data: companies, error: cErr }] = await Promise.all([
    db
      .from('event_award_assignments')
      .select('award_type, participant_id, company_id, participants(first_name, last_name, company_id)')
      .eq('event_slug', slug),
    db.from('event_companies').select('id, number, name').eq('event_slug', slug),
  ])
  if (error || cErr) {
    console.error('[event-emails] award merge fields could not be read:', error ?? cErr)
    return awardMergeVars([], [])
  }
  const winners: AwardWinner[] = ((rows ?? []) as AssignmentJoin[])
    .filter((r) => isAssignedAwardType(r.award_type))
    .map((r) => {
      const p = Array.isArray(r.participants) ? r.participants[0] : r.participants
      return {
        awardType: r.award_type as AssignedAwardType,
        participantId: r.participant_id,
        firstName: p?.first_name ?? '',
        lastName: p?.last_name ?? '',
        companyId: r.company_id ?? p?.company_id ?? null,
      }
    })
  return awardMergeVars(winners, (companies ?? []) as AwardCompany[])
}
