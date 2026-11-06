# proxy.ts matcher: gated prefixes always run the proxy — 2026-11-05

Slug: `proxy-matcher-gated-prefixes`. Handover: `HANDOVER-proxy-matcher-gated-prefixes-2026-11-05.md`. Doc snapshot: `1yafIyQhJLdw6VZQYW1s44h2VBQecD0CfDsbVcHVhxzA`.
PR #553 → `dev` as `15071aed`; **not promoted** (a separate session will). Migration: none.

An audit of the matcher's extension exclusion found nothing exposed. A third matcher entry now runs the proxy on gated prefixes whatever the extension, and real static files stay skipped.

| # | Item | State | Next | Done |
|---|---|---|---|---|
| proxy-matcher-gated-prefixes.1 | **HIGH** Promote #553 | On `dev` only. Dev push CI passed with test steps run, and the dev deployment is READY. No request was made to it. Production still skips the proxy on these paths. | Include it in the separate promotion. Then request `/admin/x.css` signed out: expect 404 or 307, not 500. | ☐ |
| proxy-matcher-gated-prefixes.2 | Role gate for a signed-in non-admin on these paths | Never exercised. Local checks were signed out or used forged headers. | On `dev` with a member session, request `/admin/members/x.css`: expect it refused, as `/admin/members` is. | ☐ |
| proxy-matcher-gated-prefixes.3 | Proxy-run volume after promotion | Bot volume on these paths was not measured. Legitimate traffic should add no runs, since `public/` has no file under these prefixes. | About a week after promotion, read per-route Observability for extension paths under the gated prefixes. | ☐ |
| proxy-matcher-gated-prefixes.4 | `pay-seat` lookup is not tied to the slug | Read in code only: the lookup is by token alone. Dev has no seat tokens. It still needs the real token. | Owner decides: tie it to `event_slug` as `pay` and `join` are, or accept it. | ☐ |
| proxy-matcher-gated-prefixes.5 | A new gated route group must add its prefix | Nothing enforces this. A missed prefix returns that group to the old behaviour. | Add a test comparing the gated top-level route folders with the matcher entry. | ☐ |
| proxy-matcher-gated-prefixes.6 | `x-stellr-private-route` is set but unread | Nothing in `app`, `components` or `lib` reads it. The comment at `proxy.ts:331` is stale: tracking is decided in the browser. | Remove the header, or correct the comment. | ☐ |
| proxy-matcher-gated-prefixes.7 | The `_next` exclusion has no end boundary | `/_nextfoo` skips the proxy but only reaches a 404. No effect today. Deliberately left. | Change it to `_next(?:/\|$)` when that line is next edited. | ☐ |
| proxy-matcher-gated-prefixes.8 | Flaky e2e on the #553 PR run | `e2e/core/registration-docusign.spec.ts:74` passed on retry, once. Cause not looked at. The dev push run passed. | Look into it only if it repeats. | ☐ |
