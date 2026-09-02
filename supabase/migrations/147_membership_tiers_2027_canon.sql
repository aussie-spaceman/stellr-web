-- 147_membership_tiers_2027_canon.sql
-- Align the teacher membership family with the canonical "2027 Membership Tiers"
-- flyer (Shared drives/Stellr/1 Campaigns/Flyers/2027 - Membership Tiers.pdf).
--
-- Prices are ALREADY canonical and are deliberately untouched here: Educator $0,
-- Catalyst $149, Innovator $499, Trailblazer $999, all verified against the live
-- Stripe Prices. What was stale is (a) two tier descriptions and (b) the reach of
-- the student fan-out grant.
--
-- 1. Descriptions. `Innovator` still read "Lowest paid educator tier — 1yr free if
--    event participant": Catalyst has been the lowest paid educator tier since
--    migration 094, and the 1yr-free grant is keyed to teachers ATTENDING an event,
--    not to being a participant. `Trailblazer` still read "Sales-led (contact us)"
--    although migration 095 gave it a live Stripe price and self-serve checkout.
--
-- 2. Fan-out. The "registered students get Pathfinder" rule fires on Innovator OR
--    Trailblazer. The flyer puts that benefit on Trailblazer alone (Innovator's
--    student row is Campaign Guide ADVANCED + curated resources, nothing more), so
--    the rule is narrowed to Trailblazer.
--
-- Blast radius: nil. member_memberships holds zero paid teacher memberships, so no
-- student has ever been granted Pathfinder through this rule and there is nothing
-- to revoke or backfill.
--
-- Idempotent: re-running writes the same values.

begin;

-- 1. Tier descriptions ───────────────────────────────────────────────────────
update membership_tiers
   set description = 'Educator tier — everything in Catalyst plus advanced guides and assessment '
                     'tools, live student feedback calls, Common Core alignment, biweekly group '
                     'mentoring and the agentic AI tools.'
 where name = 'Innovator';

update membership_tiers
   set description = 'Top educator tier — everything in Innovator plus SCORM LMS upload, extended '
                     'live student feedback, a virtual presentation and awards ceremony, NGSS/ISTE/'
                     'TEKS alignment, and a year of Pathfinder membership for the students.'
 where name = 'Trailblazer';

-- 2. Narrow the student fan-out to Trailblazer ───────────────────────────────
update public.tier_grant_rules
   set conditions = jsonb_build_object(
         'source_tier_ids',
         (select jsonb_agg(id) from public.membership_tiers where name = 'Trailblazer'))
 where name = 'Educator tier → registered students get Pathfinder';

commit;
