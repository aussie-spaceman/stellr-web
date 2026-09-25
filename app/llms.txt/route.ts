/**
 * llms.txt — a curated map of the site for answer engines and AI crawlers.
 *
 * Deliberately a route handler, not a file in public/: anything new under
 * public/ fails the `check:watermarks` prebuild guard, and serving it from the
 * app router keeps the site URL in one place alongside sitemap.ts / robots.ts.
 *
 * This is an editorial shortlist, not a mirror of the sitemap. It points at the
 * dozen pages we most want cited and omits transactional, legal and
 * registration routes.
 */

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.stellreducation.org'

export const dynamic = 'force-static'

const BODY = `# Stellr Education

> Stellr Education is a US 501(c)(3) nonprofit, founded in May 2021, that runs
> industry-simulation STEM design competitions connecting middle and high school
> students (grades 7–12) with practising aerospace, engineering and
> environmental professionals. Classroom Campaigns and the core curriculum are
> free; live competition events carry a per-participant fee, with scholarships
> so cost is never a barrier. Membership has a permanently free tier for school
> students, college students and educators.

Two competition themes run each year: the Space Design Challenge and the
Environmental Design Challenge. Both are delivered either as one-day live
events (in person or virtual; grades 7–12; no preparation required) or as
seasonal Campaigns that
teachers run in class over 4 or 10 weeks (grades 9–12, free), with a path to
the national championships. Students work as an engineering company answering
a client's Request for Proposal, judged by industry professionals. No lab, kit
or engineering background is needed.

## Programs
- [Design Competitions](${BASE_URL}/competitions): The Space Design Challenge and Environmental Design Challenge — formats, themes, what a competition day involves, and how to enter.
- [Upcoming events and campaigns](${BASE_URL}/events): Live competition dates, locations and registration status.
- [Curriculum](${BASE_URL}/curriculum): Free core engineering challenge material — the Request for Proposal, Mission Handbook and teacher and student guides — to run in class at any time; paid educator tiers add lesson plans, PD hours and standards alignment.
- [Academy](${BASE_URL}/academy): Mentoring, coaching, competition training and the STEM Power Skills programme.
- [Membership](${BASE_URL}/membership): Tier structure for students, alumni and educators, including what stays free.

## Guides for teachers
- [STEM competitions for your school, compared](${BASE_URL}/guides/stem-competitions-for-schools): Science Olympiad, FIRST, VEX, TSA TEAMS, StellarXplorers, Future City, NASA TechRise, eCYBERMISSION and Stellr side by side — grades, team size, cost, equipment and time, with sources.
- [How to run an engineering design challenge in your classroom](${BASE_URL}/guides/run-an-engineering-design-challenge): A summary of the eight stages and how proposals are judged — no lab, kit or engineering background needed.
- [Teacher Grant Program](${BASE_URL}/grant): Up to $500 a year plus documented PD hours for US high school teachers who run Stellr activities.

## Explainers
- [Why design competitions work](${BASE_URL}/events/why-design-competitions): How competitive industry simulation builds workplace readiness that classroom STEM alone does not.
- [Why Stellr](${BASE_URL}/why-stellr): What distinguishes Stellr's approach from science fairs and traditional STEM enrichment.
- [Impact](${BASE_URL}/impact): Participation demographics and outcomes, our position on AI in education, and how Stellr shapes student career trajectories.
- [Atmospheric requirements for space settlements](${BASE_URL}/curriculum/atmospheric-requirements): A worked interactive tutorial on sizing a settlement's atmosphere — pressure, oxygen partial pressure, fire risk and gas mass.
- [Teacher companion for the above](${BASE_URL}/curriculum/atmospheric-requirements/teachers): Answer key, timing, misconceptions and NGSS alignment.

## By audience
- [Students](${BASE_URL}/students): What students get from joining and competing.
- [Educators and schools](${BASE_URL}/educators): Classroom material, CTE pathways and school support.
- [Mentors and volunteers](${BASE_URL}/mentors): How STEM professionals contribute.
- [Partner network](${BASE_URL}/network): Universities, employers and industry partners.

## Organisation
- [About Stellr](${BASE_URL}/about): Mission, history and team.
- [News](${BASE_URL}/news): Announcements, competition results and community stories.
- [Scholarships](${BASE_URL}/scholarship): Fee assistance so cost is never a barrier to competing.
- [Contact](${BASE_URL}/contact): hello@stellreducation.org

## Optional
- [Host an event](${BASE_URL}/host-an-event): For facilities interested in running a live competition.
- [Volunteer](${BASE_URL}/volunteer): Event and campaign volunteering.
- [Donate](${BASE_URL}/donate): Supporting Stellr's work.
`

export function GET() {
  return new Response(BODY, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=3600, s-maxage=86400',
    },
  })
}
