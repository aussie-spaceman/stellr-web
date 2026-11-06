# Runbook: Vercel WAF rate-limit rules

**Owner action. Three rules, added at different times. Rule 1 is plan S1, about 10 minutes. Rules 2 and 3 are plan S5.**

| Rule | Covers | When |
|---|---|---|
| 1 | `/api/register/` and `/api/check-in` | First |
| 2 | `/credentials/` | Any time after rule 1 |
| 3 | Tenant hosts | After the zone is attached, never before |

**Start by reading what is there.** Open **Firewall** on **stellr-web**, see which rules exist, and start from the first one missing.

**Check the allowance.** Vercel's documentation, searched on 6 Nov 2026, did not state how many rules Hobby allows. If the Firewall page will not take a second rule, see "If only one rule fits" under rule 2.

# Rule 1: registration and check-in

A Vercel Firewall rule counts at the edge, across all instances, and a blocked
request never starts a function, so it also protects the Hobby CPU meter. It
works alongside the app's own limits (`lib/rate-limit.ts`).

Vercel Firewall custom rules, rate limiting included, come with the Hobby plan
at no charge.

Rule 1 already covers these paths on tenant hosts. It matches on the path, on
every host of the project, so nothing about it changes when a zone is attached.

## What the rule does

| Setting | Value |
|---|---|
| Project | the production project (`stellr-web`), not `stellr-web-dev` |
| Name | `Rate limit: registration and check-in` |
| If | Request Path **starts with** `/api/register/` **OR** Request Path **equals** `/api/check-in` |
| Then | **Rate Limit** |
| Algorithm | Fixed window |
| Window | 60 seconds |
| Limit | 60 requests |
| Key | IP address |
| When exceeded | Too Many Requests (429) |

Why 60 a minute per IP: the in-app limits are far lower for a single person
(3 registrations an hour per event), but check-in allows 600 an hour per event
from one IP, because a whole class checks in over the venue's Wi-Fi. A burst at
the door is a few dozen a minute. 60 a minute stays clear of that and still
stops a script.

## Steps

1. Sign in at vercel.com and open the **stellr-web** project (production).
2. Open the **Firewall** tab.
3. Choose **Configure** (top right), then **+ New Rule**.
4. **Name:** `Rate limit: registration and check-in`.
5. Under **If**, set the first condition: **Request Path**, **Starts with**,
   `/api/register/`.
6. Choose **+ OR** (not AND), and set the second condition: **Request Path**,
   **Equals**, `/api/check-in`.
7. Under **Then**, choose **Rate Limit**.
8. Set **Fixed Window**, **60** seconds, **60** requests, keyed by **IP Address**.
9. Set the action on exceeding the limit to **Too Many Requests (429)**.
10. First, set the action on exceeding the limit to **Log**, which Vercel lists
    as an option. **Save Rule**, then **Review Changes** and **Publish**.
11. After a day, open **Firewall → Overview**, filter by the rule, and check
    the logged hits. Expect none from real visitors. Then edit the rule, switch
    the action to **Too Many Requests (429)**, and publish again.

## Check it

- Firewall → Overview lists the rule as active.
- Registration still works: submit a test registration on the production site
  in the usual way, or watch the next real one arrive in the admin.
- Before an event, tell the check-in desk lead: if a phone at the door shows
  "Too many requests", wait a minute and try again, then report it.

## Undo

Firewall → Configure → the rule → **Disable** (or Delete) → **Publish**. Takes
effect within seconds; no deploy.

# Rule 2: public credential pages

`proxy.ts` limits `/credentials/` to 60 a minute per IP. This rule adds a count
across instances. The proxy's limit stays in memory on purpose: a database call
on that path would add to the middleware share of the CPU meter
(`docs/S5-CRONS-LIMITS-SMMA.md`).

| Setting | Value |
|---|---|
| Project | `stellr-web` |
| Name | `Rate limit: credential pages` |
| If | Request Path **starts with** `/credentials/` |
| Then | **Rate Limit**, Fixed Window, 60 seconds, 60 requests, keyed by IP Address |
| When exceeded | **Log** first, then Too Many Requests (429) |

Why 60: it matches the in-app number, so someone the app allows on one instance
is not refused here until they pass the same count across all of them.

**Why a second rule, when the plan says "extend the rule".** As we read Vercel's
documentation, a rule keeps one count per key across everything it matches. We
have not measured this. Added to rule 1, a credential page view at a venue would
use up the same 60 a minute as that venue's check-ins, on one shared IP.

**If only one rule fits.** Add **+ OR**, Request Path, Starts with,
`/credentials/` to rule 1, and accept the shared count. Tell the check-in desk
lead, and watch the logged hits during the next event.

Steps: as rule 1, steps 1 to 3 and 7 to 11, with the values above. After a day on
Log, read the hits, then switch to 429. A shared credential link can draw a burst
of crawlers from one network, so look for those before you switch.

Check it: open a real credential page on production and confirm it loads. Undo:
as rule 1.

# Rule 3: tenant hosts

**Not yet.** No tenant zone exists. Do this as part of the attach order in
`docs/TENANCY-S5.md` (Real tenant hosts), after the zone is attached and the
unknown-host 404 check has passed. Tenant hosts need Vercel Pro (G1), so check
the allowance again then, on that plan. Do it first on any `dev` project that
carries a test zone.

A tenant host serves more than rule 1's paths: register, sign, survey, check-in
and team-profile pages, plus their APIs (`lib/tenancy/tenant-surface.ts`).

| Setting | Value |
|---|---|
| Project | the project the zone is attached to |
| Name | `Rate limit: tenant hosts` |
| If | Hostname **ends with** the value of `TENANT_HOST_SUFFIX` **AND** Request Path **does not start with** `/_next/` |
| Then | **Rate Limit**, Fixed Window, 60 seconds, 300 requests, keyed by IP Address |
| When exceeded | **Log** only, until you have read one real event |

Three things to get right:

- **Leave out `/_next/`.** One page load pulls many script and style files, and
  each would count.
- **The Firewall sees the address the visitor typed.** It runs ahead of the
  proxy, so it never sees the internal `/_t/...` address. Do not write a condition
  on `/_t`.
- **300 is a starting guess, not a measurement.** A whole class at a venue shares
  one IP, and each student loads pages as well as posting. Keep it on Log through
  a tenant's first real event, then set the number from the logged hits.

Rule 1 still applies to a tenant's `/api/register/` and `/api/check-in` at 60 a
minute. One venue checking in on a tenant host is held to that, as on Stellr.

Check it: Firewall → Overview shows the rule's hits only on tenant hostnames, and
www and app are not among them. Undo: disable the rule and publish. If you are
rolling the whole zone back, detach the zone first, as the attach order says.

## Related

- HSTS (`Strict-Transport-Security: max-age=31536000; includeSubDomains`) is set
  for every response in `next.config.mjs`. `preload` is deliberately left off:
  joining the browsers' preload list is slow to undo, so it waits for the
  owner's decision, after every subdomain is confirmed HTTPS-only.
- The Content-Security-Policy is Report-Only for now (`lib/csp.ts`, reports to
  `/api/csp-report`, visible in the function logs as lines starting `[csp]`).
