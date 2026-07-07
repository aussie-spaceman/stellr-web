import { redirect } from 'next/navigation'

// The Access console moved under Members → /admin/members/access. Preserve old
// links (and any ?tab= deep-links) by redirecting.
export default async function LegacyAccessRedirect({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const { tab } = await searchParams
  redirect(tab ? `/admin/members/access?tab=${tab}` : '/admin/members/access')
}
