import { redirect, notFound } from 'next/navigation'
import { getCurrentMember } from '@/lib/community'
import { getEventBySlug } from '@/lib/sanity'
import { getMemberCampaignRegistration } from '@/lib/campaign-registrations'
import { deadlineInfo } from '@/lib/campaigns'
import { SubmitProposalForm } from '@/components/campaigns/SubmitProposalForm'

interface PageProps {
  params: Promise<{ slug: string }>
}

export default async function SubmitProposalPage({ params }: PageProps) {
  const { slug } = await params
  const member = await getCurrentMember()
  if (!member) redirect('/sign-in')

  const [campaign, reg] = await Promise.all([
    getEventBySlug(slug).catch(() => null),
    getMemberCampaignRegistration(member.id, slug),
  ])
  if (!campaign || campaign.activityType !== 'campaign') notFound()
  if (!reg) redirect(`/events/${slug}`)

  return (
    <SubmitProposalForm
      slug={slug}
      title={campaign.title}
      deadlineLabel={deadlineInfo(campaign.deadline)?.label ?? 'the deadline'}
      groupName={reg.group_name ?? member.first_name ?? 'there'}
      initialFileName={reg.proposal_file_name}
    />
  )
}
