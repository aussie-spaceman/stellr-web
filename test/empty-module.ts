// Vitest stub for the `server-only` / `client-only` guard packages.
//
// Those packages intentionally throw unless the bundler sets the RSC
// `react-server` export condition (which Next's compiler does, but Vitest does
// not). Aliasing them to this empty module lets Server Components be imported in
// tests without tripping the guard. It has no effect on the real Next build,
// which still enforces the server/client boundary.
export {}
