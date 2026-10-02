import { createHash } from 'node:crypto'

// Stellr's School Data Terms: what a teacher agrees to on their school's
// behalf when they register a group, and what Stellr promises in return about
// the student information they share.
//
// The text lives here, not only in the page, so the exact wording a teacher
// accepted can be identified later: each group registration stores the
// version and the SHA-256 of these sections (registrations.school_data_terms_*).
// Any change to the wording is a new version.

export const SCHOOL_DATA_TERMS_VERSION = '2026-10-v1'
export const SCHOOL_DATA_TERMS_EFFECTIVE = '9 October 2026'

export interface TermsSection {
  heading: string
  paragraphs: string[]
}

export const SCHOOL_DATA_TERMS: TermsSection[] = [
  {
    heading: '1. Who these terms are between',
    paragraphs: [
      'These terms are between Stellr Education ("Stellr") and the school or district whose teacher, staff member or student manager registers a group of students for a Stellr event (the "School"). The person registering confirms they are authorised to accept them for the School.',
      'They cover the student information the School shares with Stellr to register and manage that group ("School Data"): for example names, email addresses, dates of birth, grades, school details, dietary and medical needs, and emergency contacts, however it is shared (a registration form, a roster spreadsheet, or a join link).',
    ],
  },
  {
    heading: '2. What Stellr uses School Data for',
    paragraphs: [
      'Only to run the competition the students are registered for and to keep them safe at it: registration, team and company assignment, event communications, consent forms, check-in, results, awards and credentials, and follow-up about that event.',
      'Stellr does not sell School Data, use it for targeted advertising, build profiles of students for any purpose unrelated to the event, or use it to develop or test products. Stellr may use School Data in aggregate, with no student identifiable, to report on who its programmes reach.',
    ],
  },
  {
    heading: '3. Who else sees it',
    paragraphs: [
      'Stellr does not disclose School Data to anyone except: the service providers that host and operate Stellr\'s systems, listed in Section 7.1 of the Privacy Policy, each bound to use it only on Stellr\'s instructions; the student\'s own parent or guardian; event staff and mentors who need it to run the event; and anyone the law requires Stellr to disclose it to.',
      'Before adding a service provider that receives School Data, Stellr adds it to that list.',
    ],
  },
  {
    heading: '4. Consent forms are the family\'s, not the School\'s',
    paragraphs: [
      'A participant under 18 needs a consent form signed by their parent or legal guardian. That form, and the record of its signing, comes from the family, not the School: it is Stellr\'s own legal record, kept for seven years from signing as the Privacy Policy describes, and is not School Data for the purposes of deletion under these terms. The School\'s consent cannot stand in for a parent\'s.',
    ],
  },
  {
    heading: '5. Keeping School Data safe',
    paragraphs: [
      'Stellr protects School Data with reasonable administrative, technical and physical safeguards, including encryption in transit and at rest, access limited to the people who need it, multi-factor sign-in for administrators, and logging of access to signed records.',
      'If Stellr learns that School Data has been accessed or disclosed without authorisation, it will tell the School within 72 hours of confirming it, say what happened and what is being done, and cooperate with the School in notifying families where the law requires.',
    ],
  },
  {
    heading: '6. Deleting School Data',
    paragraphs: [
      'When students withdraw from an event, or at the School\'s written request, Stellr deletes the School Data for those students within 30 days, except signed consent forms (Section 4) and records the law requires Stellr to keep, such as payment records.',
      'Otherwise Stellr keeps School Data for as long as the students have a Stellr account, or, for students without one, until 12 months after the event, then deletes it. Backup copies are deleted as they expire.',
    ],
  },
  {
    heading: '7. The School\'s rights',
    paragraphs: [
      'The School may ask to see the School Data Stellr holds about its students, to correct it, and to have it deleted as in Section 6. It may ask for a copy of these terms and of Stellr\'s list of service providers at any time.',
      'Where a state law gives the School further rights over student data held by an outside provider (for example Colorado\'s Student Data Transparency and Security Act or Utah\'s Student Data Protection Act), Stellr will honour them. A School that needs its own data agreement can ask for one.',
    ],
  },
  {
    heading: '8. Changes and contact',
    paragraphs: [
      'Stellr may update these terms. Each version is dated, the version a registration was made under is recorded with it, and changes do not reduce protection for School Data already shared without the School\'s agreement.',
      'Questions, requests and notices: privacy@stellreducation.org, subject line "School Data".',
    ],
  },
]

/** SHA-256 of the exact wording of this version, stored with each registration that accepts it. */
export function schoolDataTermsSha256(): string {
  const canonical = JSON.stringify({ version: SCHOOL_DATA_TERMS_VERSION, sections: SCHOOL_DATA_TERMS })
  return createHash('sha256').update(canonical).digest('hex')
}
