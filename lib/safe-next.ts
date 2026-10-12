// deep review AUTH-7: the single, hardened `safeNext` for post-auth redirects.
//
// Previously three un-shared copies (onboarding, sign-in, sign-up) each did
// `next.startsWith('/') && !next.startsWith('//')`. That accepts `/\evil.com`
// and `/\t/evil.com`: browsers normalise a backslash to a forward slash in
// http(s) URLs, so `redirect('/\\evil.com')` sends the user to
// https://evil.com — an open redirect / phishing hop from a trusted origin
// (e.g. a fake "sign in again" page aimed at parents). A leading whitespace
// char (tab/newline) is likewise stripped by browsers, turning `/\t/evil.com`
// into `//evil.com` → protocol-relative external.
//
// So we accept only a genuine same-origin relative path: it must start with a
// single `/` that is NOT followed by another `/` or a backslash, and must
// contain no whitespace or backslash anywhere. Everything else → null, and the
// caller falls back to its safe default. Fails closed.
export function safeNext(next: string | undefined | null): string | null {
  return next && /^\/(?![\\/])[^\s\\]*$/.test(next) ? next : null
}
