# Campaign Registrations

Adds **Campaigns** — a free, asynchronous Competition sub-type — across the public
site (`www`) and the web app (`app`), alongside ticketed **Events**.

A Campaign runs over a Spring/Fall season at the group's own pace, is **included
with membership** (no payment gateway in registration), and asks students to
submit a **proposal** before a **deadline**. Content is authored in Sanity.

## Visual code (do not deviate)
- **Campaign = pathway amber `#E0922F`** (`bg-pathway-amber`, tint `bg-pathway-amber-bg`,
  text `text-pathway-amber`) — borders, ribbons, "No payment" chips.
- **Event = primary blue.** Themes keep their own colours: Space violet, Environmental green.
- Amber top/left borders distinguish Campaign cards everywhere.

## Data model
- **Sanity** (`sanity/schemas/event.ts`): the existing `event` doc discriminates
  `activityType: 'live_event' | 'campaign'`. Campaign fields: `type` (theme —
  Space/Environmental), `season`, `campaignYear`, and (new) `deadline`, `deliverable`.
- **Supabase** (migration `120_campaign_registrations.sql`): campaign registrations
  reuse the `registrations` table with `type = 'campaign'` (added to the CHECK),
  plus new columns `group_name`, `contact_role`, `proposal_storage_path`,
  `proposal_file_name`, `proposal_notes`, `proposal_submitted_at`. Reuses
  `event_slug`/`event_title`, `teacher_*`, `teacher_member_id`, `student_count`.
  Proposals live in the private `campaign-proposals` storage bucket.
- ~~**Educator Commons**~~ **(removed, migration 128)** — was a seeded open Space
  (`community_spaces.slug = 'educator-commons'`); torn out as a Claude Design
  hallucination. Campaigns surface materials/workspace directly.

## Routes / files (as of Sept 2026)

| Surface | Route | File |
|---|---|---|
| www board | `/events` | `app/(public)/events/page.tsx` (two groups: live events, campaigns) |
| www detail | `/events/[slug]` | branches to `components/campaigns/CampaignDetail.tsx` for campaigns |
| www register | `/register/[slug]/group` | the standard group registration form; the CTA on the campaign detail card points here |
| app dashboard | `/home` | `components/campaigns/DashboardCampaigns.tsx` |
| app My competitions | `/campaigns` | `app/(member)/campaigns/page.tsx` |
| app workspace | `/campaigns/[slug]` | `app/(member)/campaigns/[slug]/page.tsx` |
| app submit | `/campaigns/[slug]/submit` | + `components/campaigns/SubmitProposalForm.tsx` |
| admin list | `/admin/competitions` | campaign rows carry a purple **Campaign** pill; `/admin/campaigns` redirects here (`next.config.mjs`) |
| admin detail | `/admin/competitions/[slug]` | tabs minus Settings for campaigns; header button **Proposals & email** → |
| admin proposals + broadcast | `/admin/campaigns/[slug]` | teams, proposal status, `components/admin/campaigns/CampaignEmailComposer.tsx` |

Shared: `CampaignCard`, `CampaignGridCard`, `CampaignDetail`, `DashboardCampaigns`,
`SubmitProposalForm` under `components/campaigns/`. Server helpers in
`lib/campaign-registrations.ts` (member context + registration reads) and
view/date/theme helpers in `lib/campaigns.ts`.

> The chrome-less signup step (`/register-campaign`, "entry point A") was designed but
> never wired to onboarding; removed in the Sept 2026 cleanup.

## APIs & emails

| Step | Endpoint | Email |
|---|---|---|
| Register | `POST /api/register/group` — the same handler as live events; writes `registrations.type = 'campaign'` when the Sanity event is a campaign, and skips payment | standard registration confirmation (`lib/registration-notify.ts`) |
| Submit proposal | `POST /api/campaigns/[slug]/submit` — multipart upload, PDFs watermarked, stored in the private `campaign-proposals` bucket | `campaignProposalReceivedEmail` |
| Broadcast | `POST /api/admin/campaigns/[slug]/email` — every registered group's teacher | `campaignBroadcastEmail` |

Templates live in `lib/email.ts`.

**Not this feature:** `api/cron/campaigns`, `api/cron/campaign-events`,
`api/cron/campaign-drip` and `api/admin/email/campaigns/*` are *email* campaigns
(`lib/email-campaigns.ts`, `RUNBOOK-tier-welcome-drips.md`) — the word collides, the
code does not.

## Data prerequisites (done)
- Migration `120_campaign_registrations.sql` is in production and in `supabase/baseline.sql`.
- Campaigns are authored in Sanity (`activityType = campaign`, theme, season, year,
  **deadline**, deliverable); a campaign with `registrationOpen` unset is closed
  (`lib/registration.ts`).
