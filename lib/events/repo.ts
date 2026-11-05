/**
 * The events facade (multi-tenancy plan S3). One door for event reads, so S5
 * and S8 can move callers from Sanity to Postgres without touching each one.
 *
 * It changes NOTHING about how events are read: every getter here returns exactly
 * what lib/sanity returns today, with the same query and cache window.
 *
 * This module imports lib/sanity and nothing else, so a page that reads an event
 * loads no database client and has no path to a write
 * (test/events-facade-ratchet.test.ts). The Postgres mirror is lib/events/mirror.ts.
 */
import {
  getEventBySlug as sanityEventBySlug,
  getAllEvents as sanityAllEvents,
  getAllCampaigns as sanityAllCampaigns,
  getEventsBySlugs as sanityEventsBySlugs,
  getEventsByIds as sanityEventsByIds,
  getFeaturedEvents as sanityFeaturedEvents,
  getEventsForSurveySchedule as sanityEventsForSurveySchedule,
  getEventsForHubspotSync as sanityEventsForHubspotSync,
  getEventsForSchema as sanityEventsForSchema,
} from '@/lib/sanity'

/** One event by slug, from Sanity exactly as lib/sanity returns it. */
export async function getEventBySlug(slug: string) {
  return sanityEventBySlug(slug)
}

/** Every live event, from Sanity (unchanged). */
export async function getAllEvents() {
  return sanityAllEvents()
}

/** Every campaign, which is an event document too, from Sanity (unchanged). */
export async function getAllCampaigns() {
  return sanityAllCampaigns()
}

/** Minimal metadata for a set of slugs, from Sanity (unchanged). */
export async function getEventsBySlugs(slugs: string[]) {
  return sanityEventsBySlugs(slugs)
}

/** Minimal metadata for a set of Sanity _ids, from Sanity (unchanged). */
export async function getEventsByIds(ids: string[]) {
  return sanityEventsByIds(ids)
}

/** The homepage's featured live events, from Sanity (unchanged). */
export async function getFeaturedEvents() {
  return sanityFeaturedEvents()
}

/** Live events with a date, for the survey scheduler, from Sanity (unchanged). */
export async function getEventsForSurveySchedule() {
  return sanityEventsForSurveySchedule()
}

/** Every event with a slug, for the HubSpot option sync, from Sanity (unchanged). */
export async function getEventsForHubspotSync() {
  return sanityEventsForHubspotSync()
}

/** Live events with a date, for structured data, from Sanity (unchanged). */
export async function getEventsForSchema() {
  return sanityEventsForSchema()
}
