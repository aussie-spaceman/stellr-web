/**
 * Request header carrying this request's nonce to the layouts (lib/request-nonce.ts).
 *
 * Its own file so a layout that reads the nonce doesn't import lib/csp.ts, which
 * imports the consent script and the tag manager to hash them. The tenant tree's
 * layouts read the nonce, and test/tenant-tree-no-analytics.test.ts walks their imports.
 */
export const NONCE_HEADER = 'x-nonce'
