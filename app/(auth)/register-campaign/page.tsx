import { redirect } from 'next/navigation'
import { getCurrentMember } from '@/lib/community'
import { getAllCampaigns, type StellarEvent } from '@/lib/sanity'
import { themeFromType, THEME_META, seasonLabel, deadlineInfo, type CampaignOption } from '@/lib/campaigns'
import { SignupCampaignStep } from '@/components/campaigns/SignupCampaignStep'

export const dynamic = 'force-dynamic'

// Optional post-signup interstitial (entry point A). Wire the educator signup /
// onboarding completion to redirect here; the step itself links on to /home.
export default async function RegisterCampaignStepPage() {
  const member = await getCurrentMember()
  if (!member) redirect('/sign-in')

  const raw = (await getAllCampaigns().catch(() => [])) as StellarEvent[]
  // One option per theme (Space + Environmental), matching the design.
  const bestPerTheme = new Map<string, StellarEvent>()
  for (const c of raw ?? []) {
    const t = themeFromType(c.type)
    if (!bestPerTheme.has(t)) bestPerTheme.set(t, c)
  }

  const campaigns: CampaignOption[] = [...bestPerTheme.values()].map((c) => {
    const theme = themeFromType(c.type)
    return {
      slug: c.slug.current,
      title: c.title,
      theme,
      themeLabel: THEME_META[theme].label,
      seasonLabel: seasonLabel(c.season, c.campaignYear),
      deadlineLabel: deadlineInfo(c.deadline)?.label ?? '',
    }
  })

  // Nothing to offer — go straight to the dashboard.
  if (campaigns.length === 0) redirect('/home')

  return <SignupCampaignStep campaigns={campaigns} />
}
