/**
 * Write the config the CI `lighthouse` job measures: lighthouserc.json plus one
 * real event's detail and registration pages.
 *
 * WHY: lhci aborts the whole run on the first URL that answers 404, so one bad
 * URL meant no report at all. And an event named in the config can disappear,
 * so the event is chosen at run time from what Sanity publishes today. Every URL
 * is checked against the running app first; one that fails is dropped with a
 * warning, and the rest are still measured.
 *
 * Usage: tsx scripts/lighthouse-urls.ts <output config path>
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { getAllEvents } from '@/lib/events/repo'

export type EventRow = {
  slug: string
  date: string
  endDate?: string | null
  registrationOpen?: boolean | null
}

const CANDIDATES = 5
const ORIGIN = 'http://localhost:3000'

/**
 * The events most worth measuring, best first: upcoming with registration open
 * (the page people actually land on), other upcoming, then the most recent past.
 */
export function rankEvents(events: EventRow[], today: string): string[] {
  const lastDay = (e: EventRow) => e.endDate ?? e.date
  const upcoming = events.filter((e) => lastDay(e) >= today).sort((a, b) => a.date.localeCompare(b.date))
  const isOpen = (e: EventRow) => e.registrationOpen === true
  const past = events.filter((e) => lastDay(e) < today).sort((a, b) => b.date.localeCompare(a.date))
  return [...upcoming.filter(isOpen), ...upcoming.filter((e) => !isOpen(e)), ...past].map((e) => e.slug)
}

export function eventUrls(origin: string, slug: string): string[] {
  return [`${origin}/events/${slug}`, `${origin}/register/${slug}/individual`]
}

async function isOk(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(60_000) })
    return res.status === 200
  } catch {
    return false
  }
}

async function fetchEvents(): Promise<EventRow[]> {
  const events = await getAllEvents()
  if (!events) throw new Error('NEXT_PUBLIC_SANITY_PROJECT_ID is not set')
  return (events as (Omit<EventRow, 'slug'> & { slug: { current: string } })[])
    .filter((e) => e.date)
    .map((e) => ({ slug: e.slug.current, date: e.date, endDate: e.endDate, registrationOpen: e.registrationOpen }))
}

async function chooseEventUrls(): Promise<string[]> {
  const today = new Date().toISOString().slice(0, 10)
  for (const slug of rankEvents(await fetchEvents(), today).slice(0, CANDIDATES)) {
    const urls = eventUrls(ORIGIN, slug)
    if ((await Promise.all(urls.map(isOk))).every(Boolean)) {
      console.log(`Event measured: ${slug}`)
      return urls
    }
    console.log(`Skipped event ${slug}: its pages did not all answer 200.`)
  }
  throw new Error('no event has both pages answering 200')
}

async function main(): Promise<void> {
  const out = process.argv[2]
  if (!out) throw new Error('Usage: tsx scripts/lighthouse-urls.ts <output config path>')
  const rc = JSON.parse(readFileSync('lighthouserc.json', 'utf8'))

  const stable: string[] = []
  for (const url of rc.ci.collect.url as string[]) {
    if (await isOk(url)) stable.push(url)
    else console.log(`::warning::Lighthouse: dropped ${url}, it did not answer 200.`)
  }
  const events = await chooseEventUrls().catch((err: Error) => {
    console.log(`::warning::Lighthouse: no event page will be measured: ${err.message}.`)
    return [] as string[]
  })

  const urls = [...stable, ...events]
  if (urls.length === 0) throw new Error('No page answered 200, so there is nothing to measure.')
  rc.ci.collect.url = urls
  writeFileSync(out, JSON.stringify(rc, null, 2))
  console.log(`Measuring:\n${urls.join('\n')}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: Error) => {
    console.error(err.message)
    process.exit(1)
  })
}
