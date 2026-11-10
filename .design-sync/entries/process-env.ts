// design-sync: lib/media-helpers.ts (used by the media sections) reads
// process.env at module load. Next and Storybook replace those reads at build
// time; a browser bundle has no `process`, so the first read throws and takes
// the whole bundle down. This entry is listed FIRST in cfg.extraEntries so it
// evaluates before media-helpers. The base URL is the public `stellr-media`
// Vercel Blob store - the same value Storybook inlines from .env, and already
// public in every page of the live site.
const g = globalThis as unknown as { process?: { env: Record<string, string | undefined> } }
g.process ??= { env: {} }
g.process.env.NODE_ENV ??= 'production'
g.process.env.NEXT_PUBLIC_MEDIA_BASE_URL ??= 'https://l3zabozgfpz3vahd.public.blob.vercel-storage.com'
export {}
