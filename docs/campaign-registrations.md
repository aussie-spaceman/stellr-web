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
- **Educator Commons** is a real, seeded **open** Space (`community_spaces.slug =
  'educator-commons'`, theme `campaign`) with a `general` chat channel and four
  resource rows (one gated at `min_tier_rank = 1`).

## Routes / files
| Surface | Route | File |
|---|---|---|
| www board | `/events` | `app/(public)/events/page.tsx` (two groups) |
| www detail | `/events/[slug]` | branches to `components/campaigns/CampaignDetail.tsx` for campaigns |
| app dashboard | `/home` | `components/campaigns/DashboardCampaigns.tsx` |
| app Educator Commons | `/community/educator-commons` | static page shadowing `[spaceSlug]` |
| app My competitions | `/campaigns` | `app/(member)/campaigns/page.tsx` |
| app workspace | `/campaigns/[slug]` | `app/(member)/campaigns/[slug]/page.tsx` |
| app submit | `/campaigns/[slug]/submit` | + `SubmitProposalForm` |
| app signup step | `/register-campaign` | entry point A (chrome-less) |
| admin | `/admin/campaigns/[slug]` | teams, stats, Email everyone |

Shared: `components/campaigns/CampaignRegistrationModal.tsx` (3 steps, no payment;
`regContext = 'member' | 'signup' | 'events'`), `CampaignCard`, `CampaignsBoard`,
`CampaignRegisterButton`. Server helpers in `lib/campaign-registrations.ts` and
view/date/theme helpers in `lib/campaigns.ts`.

## APIs & emails
- `POST /api/campaigns/register` — create/idempotent-update a campaign registration → email (1).
- `POST /api/campaigns/[slug]/submit` — multipart upload (watermarks PDFs) → email (2).
- `POST /api/admin/campaigns/[slug]/email` — bulk email all registrants → email (3).
- Templates in `lib/email.ts`: `campaignRegistrationEmail`, `campaignProposalReceivedEmail`,
  `campaignBroadcastEmail`.

## Ops before go-live
1. Apply migration `120_campaign_registrations.sql`.
2. Upload the real Educator Commons resource files to the resources bucket and
   repoint the placeholder `storage_path`s (Admin → Community → Resources).
3. Author Campaigns in Sanity (`activityType = campaign`, theme, season, year,
   **deadline**, deliverable).
4. Optional: point the educator signup/onboarding completion redirect at
   `/register-campaign` to surface entry point A.
