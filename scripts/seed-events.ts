/**
 * Seed script — creates the 3 confirmed Stellr events in Sanity.
 *
 * Prerequisites:
 *   1. NEXT_PUBLIC_SANITY_PROJECT_ID set in .env.local
 *   2. SANITY_API_TOKEN set in .env.local  (needs write permission)
 *
 * Run:
 *   npx tsx scripts/seed-events.ts
 */

import * as dotenv from 'dotenv'
import * as path from 'path'
import * as fs from 'fs'

// Load .env.local
const envPath = path.resolve(process.cwd(), '.env.local')
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath })
} else {
  dotenv.config()
}

const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID
const token = process.env.SANITY_API_TOKEN
const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET ?? 'production'

if (!projectId || projectId === '<your_project_id>') {
  console.error('❌  NEXT_PUBLIC_SANITY_PROJECT_ID is not set in .env.local')
  process.exit(1)
}

if (!token || token === '<write_token_for_mutations>') {
  console.error('❌  SANITY_API_TOKEN is not set in .env.local')
  console.error('   Get a write token at: https://sanity.io/manage → your project → API → Tokens')
  process.exit(1)
}

// Direct HTTP helper — bypasses all client wrappers
async function sanityQuery(query: string) {
  const url = `https://${projectId}.api.sanity.io/v2024-01-01/data/query/${dataset}?query=${encodeURIComponent(query)}`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  const json = await res.json() as { result?: unknown; error?: { description: string } }
  if (!res.ok) throw new Error(json.error?.description ?? `Query failed: ${res.status}`)
  return json.result
}

async function sanityMutate(mutations: unknown[]) {
  const url = `https://${projectId}.api.sanity.io/v2024-01-01/data/mutate/${dataset}?returnIds=true`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ mutations }),
  })
  const json = await res.json() as { transactionId?: string; results?: Array<{ id: string }>; error?: { description: string }; message?: string }
  if (!res.ok) throw new Error(json.error?.description ?? json.message ?? `Mutate failed: ${res.status}`)
  return json
}

const events = [
  {
    _type: 'event',
    title: 'Nevada Space Design Challenge',
    slug: { _type: 'slug', current: 'nevada-space-design-challenge-2026' },
    type: 'Space Design Challenge',
    gradeLevel: 'High School',
    date: '2026-11-06',
    endDate: '2026-11-07',
    venue: 'UNLV',
    city: 'Las Vegas',
    state: 'NV',
    tagline: 'Design a habitat for the next generation of space explorers.',
    registrationOpen: false,
    registrationOpenDate: '2026-08-01',
    registrationCloseDate: '2026-10-16',
    capacity: 120,
    eligibility: 'Open to high school students (grades 9–12). Teams of 4–6 students.',
    featured: true,
    description: [
      {
        _type: 'block',
        _key: 'intro',
        style: 'normal',
        children: [
          {
            _type: 'span',
            _key: 'intro-span',
            text: 'The Nevada Space Design Challenge is a Stellr flagship event held at UNLV in Las Vegas. Student teams are tasked with designing a sustainable habitat for long-duration space missions — integrating engineering, life sciences, resource management, and human factors.',
          },
        ],
      },
      {
        _type: 'block',
        _key: 'body',
        style: 'normal',
        children: [
          {
            _type: 'span',
            _key: 'body-span',
            text: 'Working under time pressure and guided by industry mentors from aerospace and engineering backgrounds, teams will present a fully reasoned design to a panel of expert judges. The challenge is multi-disciplinary by design — there is no single right answer, and teams are judged on the quality of their reasoning as much as their final solution.',
          },
        ],
      },
    ],
  },
  {
    _type: 'event',
    title: 'Minnesota Environmental Design Challenge',
    slug: { _type: 'slug', current: 'minnesota-environmental-design-challenge-2026' },
    type: 'Environmental Design Challenge',
    gradeLevel: 'High School',
    date: '2026-11-24',
    venue: 'MSU Mankato',
    city: 'Mankato',
    state: 'MN',
    tagline: 'Engineer solutions to real-world environmental problems.',
    registrationOpen: false,
    registrationOpenDate: '2026-08-01',
    registrationCloseDate: '2026-11-07',
    capacity: 100,
    eligibility: 'Open to high school students (grades 9–12). Teams of 4–6 students.',
    featured: true,
    description: [
      {
        _type: 'block',
        _key: 'intro',
        style: 'normal',
        children: [
          {
            _type: 'span',
            _key: 'intro-span',
            text: 'The Minnesota Environmental Design Challenge takes place at Minnesota State University, Mankato. Teams tackle a real-world environmental engineering scenario — designing systems or interventions that address sustainability, resource management, or ecological impact.',
          },
        ],
      },
      {
        _type: 'block',
        _key: 'body',
        style: 'normal',
        children: [
          {
            _type: 'span',
            _key: 'body-span',
            text: 'Mentored by professionals from environmental science, civil engineering, and business, student teams must balance technical feasibility with economic and social considerations — the same trade-offs faced by industry professionals every day.',
          },
        ],
      },
    ],
  },
  {
    _type: 'event',
    title: 'North Carolina Space Design Challenge',
    slug: { _type: 'slug', current: 'north-carolina-space-design-challenge-2027' },
    type: 'Space Design Challenge',
    gradeLevel: 'High School',
    date: '2027-02-06',
    venue: "St Mary's School",
    city: 'Raleigh',
    state: 'NC',
    tagline: 'Push the boundaries of space architecture.',
    registrationOpen: false,
    registrationOpenDate: '2026-10-01',
    registrationCloseDate: '2027-01-22',
    capacity: 100,
    eligibility: 'Open to high school students (grades 9–12). Teams of 4–6 students.',
    featured: true,
    description: [
      {
        _type: 'block',
        _key: 'intro',
        style: 'normal',
        children: [
          {
            _type: 'span',
            _key: 'intro-span',
            text: "The North Carolina Space Design Challenge is hosted at St Mary's School in Raleigh. Student teams will tackle a space architecture brief — designing structures, systems, or mission concepts that push the boundaries of what\'s possible beyond Earth.",
          },
        ],
      },
      {
        _type: 'block',
        _key: 'body',
        style: 'normal',
        children: [
          {
            _type: 'span',
            _key: 'body-span',
            text: 'Industry mentors from aerospace, materials science, and systems engineering will guide teams through the challenge. As with all Stellr events, the focus is on multi-disciplinary thinking — engineering decisions must account for human factors, cost, safety, and mission objectives simultaneously.',
          },
        ],
      },
    ],
  },
]

async function seed() {
  console.log(`\n🚀  Seeding Stellr events into Sanity...`)
  console.log(`   Project: ${projectId}  |  Dataset: ${dataset}\n`)

  for (const event of events) {
    // Check if slug already exists
    const existing = await sanityQuery(
      `*[_type == "event" && slug.current == "${event.slug.current}"][0]._id`
    )

    if (existing) {
      console.log(`⏭   Skipping "${event.title}" — already exists (${existing})`)
      continue
    }

    const result = await sanityMutate([{ create: event }])
    const id = result.results?.[0]?.id ?? 'unknown'
    console.log(`✅  Created "${event.title}"  →  ${id}`)
  }

  console.log('\n✨  Seeding complete.\n')
  console.log('Next: publish the documents in Sanity Studio at /studio')
  console.log('      (created documents are drafts until published)\n')
}

seed().catch((err) => {
  console.error('❌  Seed failed:', err.message)
  process.exit(1)
})
