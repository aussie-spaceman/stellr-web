export type CampaignSeason = 'fall' | 'spring'

export interface CampaignDates {
  label: string       // e.g. "Fall 2026"
  startDate: string   // ISO date
  endDate: string     // ISO date
  registrationOpens: string
  registrationCloses: string
}

/**
 * Returns all derived dates for a campaign based solely on its season and year.
 *
 * Fall   — Campaign: Aug 15 – Dec 15. Registration: Aug 1 – Nov 30.
 * Spring — Campaign: Jan 1  – Apr 30. Registration: Dec 1 (prior year) – Mar 31.
 */
export function getCampaignDates(season: CampaignSeason, year: number): CampaignDates {
  if (season === 'fall') {
    return {
      label: `Fall ${year}`,
      startDate: `${year}-08-15`,
      endDate: `${year}-12-15`,
      registrationOpens: `${year}-08-01`,
      registrationCloses: `${year}-11-30`,
    }
  }
  // spring — registration opens in December of the prior year
  return {
    label: `Spring ${year}`,
    startDate: `${year}-01-01`,
    endDate: `${year}-04-30`,
    registrationOpens: `${year - 1}-12-01`,
    registrationCloses: `${year}-03-31`,
  }
}

export function campaignStatusFromDates(
  dates: CampaignDates,
  registrationOpenOverride?: boolean
): 'Open' | 'Coming soon' | 'Closed' {
  if (registrationOpenOverride === false) return 'Closed'
  const today = new Date().toISOString().split('T')[0]
  if (dates.endDate < today) return 'Closed'
  if (dates.startDate > today) return 'Coming soon'
  return 'Open'
}
