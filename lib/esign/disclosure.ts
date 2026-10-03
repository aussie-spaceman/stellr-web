// The disclosure every signer reads and accepts before signing with Stellr
// signing: what signing electronically means, and their right to paper.
//
// It covers what the federal E-SIGN Act (15 U.S.C. 7001(c)) asks a business
// to tell a consumer before relying on an electronic record: the right to a
// paper copy and how to get one, the right to withdraw consent and what that
// means, what the consent covers, how to keep contact details up to date, and
// what is needed to open and keep the records.
//
// Any change to the wording is a new version: add it to DISCLOSURES and point
// DISCLOSURE_VERSION at it. Every version stays here, because a template
// published under an earlier one still shows that one's words: the version
// each signer accepted is stored with their signature, and the template
// publishing script records it on each document version.

export const DISCLOSURE_TITLE = 'Agreeing to sign electronically'

const SHARED: readonly string[] = [
  'Stellr Education would like you to receive, review and sign this document electronically. Your electronic signature has the same effect as signing on paper.',
  'This agreement to sign electronically covers this document and the copies, notices and reminders we send you about it. It does not cover anything else.',
  'You can have this document on paper instead, at no cost. Email privacy@stellreducation.org or reply to the email that brought you here, and we will post you a copy to sign and return. You can also ask for a paper copy of anything you have already signed.',
  'You can withdraw your agreement to sign electronically at any time before you sign, the same way. After that we will deal with you on paper. Withdrawing does not undo a signature you have already given.',
  'To keep your contact details up to date, update your Stellr account, or email privacy@stellreducation.org.',
  'You will need a device with a current web browser and an email account, and a way to open and save PDF files (most phones and computers can). If you can read this page and open the document below, you have what you need.',
]

const RECORD = 'When you sign, we record your name, email address, the date and time, and the internet address and browser you used, so the signature can be shown to be yours.'

export const DISCLOSURES: Record<string, readonly string[]> = {
  '2026-10-v1': [
    ...SHARED,
    `${RECORD} We keep the signed document and that record for seven years. Our Privacy Policy explains how we use and protect them.`,
  ],
  // Participation Agreements V2.3: kept for the membership and 7 years after.
  '2026-10-v2': [
    ...SHARED,
    `${RECORD} We keep the signed document and that record while you are a Stellr member and for seven years after your account closes. Our Privacy Policy explains how we use and protect them.`,
  ],
}

/** The version new templates are published with. */
export const DISCLOSURE_VERSION = '2026-10-v2'

/** The words of a disclosure version; an unknown one falls back to the current. */
export function disclosureParagraphs(version: string | null | undefined): readonly string[] {
  return (version && DISCLOSURES[version]) || DISCLOSURES[DISCLOSURE_VERSION]
}

/** The current version's words. */
export const DISCLOSURE_PARAGRAPHS: readonly string[] = DISCLOSURES[DISCLOSURE_VERSION]
