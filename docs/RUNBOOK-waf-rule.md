# Runbook: Vercel WAF rate-limit rule (registration and check-in)

**Owner action, one time, about 10 minutes. Plan S1.**

The app already rate-limits these routes in memory (`lib/rate-limit.ts`), but
that count lives in one warm function instance and resets on a cold start. A
Vercel Firewall rule counts at the edge, across all instances, and a blocked
request never starts a function, so it also protects the Hobby CPU meter.

Vercel Firewall custom rules, rate limiting included, come with the Hobby plan
at no charge. Check the plan's rule allowance on the Firewall page before you
start; this runbook needs **one** rule.

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
10. First, set the rule to **Log** instead of **Deny / 429** if the form offers
    it. **Save Rule**, then **Review Changes** and **Publish**.
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

## Related

- HSTS (`Strict-Transport-Security: max-age=31536000; includeSubDomains`) is set
  for every response in `next.config.mjs`. `preload` is deliberately left off:
  joining the browsers' preload list is slow to undo, so it waits for the
  owner's decision, after every subdomain is confirmed HTTPS-only.
- The Content-Security-Policy is Report-Only for now (`lib/csp.ts`, reports to
  `/api/csp-report`, visible in the function logs as lines starting `[csp]`).
