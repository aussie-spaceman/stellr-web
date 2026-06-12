import { createSign, createHmac } from 'crypto'

const ENV = {
  oauthUrl:       process.env.DOCUSIGN_OAUTH_URL         ?? 'https://account-d.docusign.com',
  basePath:       process.env.DOCUSIGN_BASE_PATH         ?? 'https://demo.docusign.net/restapi',
  accountId:      process.env.DOCUSIGN_ACCOUNT_ID        ?? '',
  integrationKey: process.env.DOCUSIGN_INTEGRATION_KEY   ?? '',
  userId:         process.env.DOCUSIGN_USER_ID           ?? '',
  privateKey:     (process.env.DOCUSIGN_PRIVATE_KEY      ?? '').replace(/\\n/g, '\n'),
  templateId:       process.env.DOCUSIGN_TEMPLATE_ID         ?? '', // minor / guardian consent
  adultTemplateId:  process.env.DOCUSIGN_ADULT_TEMPLATE_ID   ?? '', // adult participation agreement
  mentorTemplateId: process.env.DOCUSIGN_MENTOR_TEMPLATE_ID  ?? '', // mentor participation agreement
  stellrRepName:  process.env.DOCUSIGN_STELLR_REP_NAME  ?? 'Stellr Education',
  stellrRepEmail: process.env.DOCUSIGN_STELLR_REP_EMAIL ?? '', // counter-signer on mentor agreements
  connectHmacKey: process.env.DOCUSIGN_CONNECT_HMAC_KEY  ?? '',
}

let tokenCache: { accessToken: string; expiresAt: number } | null = null

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

async function getAccessToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt - 60_000) return tokenCache.accessToken

  const now = Math.floor(Date.now() / 1000)
  const header  = base64url(Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })))
  const payload = base64url(Buffer.from(JSON.stringify({
    iss:   ENV.integrationKey,
    sub:   ENV.userId,
    aud:   ENV.oauthUrl.replace('https://', ''),
    iat:   now,
    exp:   now + 3600,
    scope: 'signature impersonation',
  })))
  const input = `${header}.${payload}`

  const sign = createSign('RSA-SHA256')
  sign.update(input)
  const sig = base64url(sign.sign(ENV.privateKey))
  const jwt = `${input}.${sig}`

  const res = await fetch(`${ENV.oauthUrl}/oauth/token`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  })
  if (!res.ok) throw new Error(`DocuSign auth failed: ${await res.text()}`)

  const data = await res.json() as { access_token: string; expires_in: number }
  tokenCache = { accessToken: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 }
  return tokenCache.accessToken
}

async function dsRequest(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getAccessToken()
  const { headers: extraHeaders, ...rest } = init
  return fetch(`${ENV.basePath}/v2.1/accounts/${ENV.accountId}${path}`, {
    ...rest,
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
  })
}

function consentDocBase64(minor: string, guardian: string, event: string): string {
  const text = [
    'PARENTAL / LEGAL GUARDIAN CONSENT FORM',
    'Stellr Education',
    '',
    `Event:       ${event}`,
    `Participant: ${minor}`,
    `Guardian:    ${guardian}`,
    '',
    `I, ${guardian}, as parent or legal guardian of ${minor},`,
    'give my consent for my child to participate in the above-mentioned',
    'Stellr Education event.',
    '',
    'By signing, I acknowledge that:',
    '  1. My child will participate in educational and collaborative activities.',
    '  2. Stellr Education may collect personal information per their Privacy Policy.',
    '  3. Photos or videos may be taken for educational and promotional purposes.',
    '  4. I have read and agree to the Stellr Education Terms & Conditions.',
    '',
    '',
    'Guardian Signature: ____________________   Guardian Date: ____________',
    '',
    'Participant Signature: _________________   Participant Date: __________',
    '',
  ].join('\n')
  return Buffer.from(text).toString('base64')
}

// ── Public interface ──────────────────────────────────────────────────────────

export interface EnvelopeParams {
  minorFirstName:  string
  minorLastName:   string
  minorEmail:      string
  minorDateOfBirth?: string
  guardianName:    string
  guardianEmail:   string
  guardianPhone?:  string
  relationship?:   string
  eventTitle:      string
  schoolName?:     string
  schoolState?:    string
}

// Envelope creation reports how many signers it was issued with so the
// roster can show per-signer progress (signers_total / signers_completed).
export interface CreatedEnvelope {
  envelopeId: string
  signerCount: number
}

export async function createConsentEnvelope(p: EnvelopeParams): Promise<CreatedEnvelope> {
  const minorName = `${p.minorFirstName} ${p.minorLastName}`
  const signerCount = p.minorEmail ? 2 : 1
  let body: object

  if (ENV.templateId) {
    // Guardian + minor sign concurrently (identical routingOrder). The 'Minor'
    // role must exist on the DocuSign template; it is only added when the minor
    // has an email on file. The informational text tabs are sent on BOTH roles
    // so each field prefills regardless of which recipient owns it in the
    // template (DocuSign ignores tab values a recipient doesn't own).
    const sharedTextTabs = [
      { tabLabel: 'MinorName',        value: minorName               },
      { tabLabel: 'MinorDateOfBirth', value: p.minorDateOfBirth ?? '' },
      { tabLabel: 'EventTitle',       value: p.eventTitle            },
      { tabLabel: 'GuardianName',     value: p.guardianName          },
      { tabLabel: 'GuardianEmail',    value: p.guardianEmail         },
      { tabLabel: 'GuardianPhone',    value: p.guardianPhone   ?? '' },
      { tabLabel: 'MinorRelationship', value: p.relationship   ?? '' },
      { tabLabel: 'SchoolName',       value: p.schoolName      ?? '' },
      { tabLabel: 'SchoolState',      value: p.schoolState     ?? '' },
    ]
    const templateRoles: object[] = [{
      roleName:     'Guardian',
      name:         p.guardianName,
      email:        p.guardianEmail,
      routingOrder: '1',
      tabs: { textTabs: sharedTextTabs },
    }]
    if (p.minorEmail) {
      templateRoles.push({
        roleName:     'Minor',
        name:         minorName,
        email:        p.minorEmail,
        routingOrder: '1',
        tabs: { textTabs: sharedTextTabs },
      })
    }
    body = {
      status:       'sent',
      emailSubject: `Parental Consent Required — ${p.eventTitle}`,
      templateId:   ENV.templateId,
      templateRoles,
    }
  } else {
    const signers: object[] = [{
      email:        p.guardianEmail,
      name:         p.guardianName,
      recipientId:  '1',
      routingOrder: '1',
      tabs: {
        signHereTabs:   [{ anchorString: 'Guardian Signature:', anchorXOffset: '130', anchorYOffset: '-5', anchorUnits: 'pixels' }],
        dateSignedTabs: [{ anchorString: 'Guardian Date:',      anchorXOffset: '90',  anchorYOffset: '-5', anchorUnits: 'pixels' }],
      },
    }]
    if (p.minorEmail) {
      signers.push({
        email:        p.minorEmail,
        name:         minorName,
        recipientId:  '2',
        routingOrder: '1',
        tabs: {
          signHereTabs:   [{ anchorString: 'Participant Signature:', anchorXOffset: '140', anchorYOffset: '-5', anchorUnits: 'pixels' }],
          dateSignedTabs: [{ anchorString: 'Participant Date:',      anchorXOffset: '95',  anchorYOffset: '-5', anchorUnits: 'pixels' }],
        },
      })
    }
    body = {
      status:       'sent',
      emailSubject: `Parental Consent Required — ${p.eventTitle}`,
      documents: [{
        documentId:     '1',
        name:           'Parental Consent Form',
        fileExtension:  'txt',
        documentBase64: consentDocBase64(minorName, p.guardianName, p.eventTitle),
      }],
      recipients: { signers },
    }
  }

  const res = await dsRequest('/envelopes', { method: 'POST', body: JSON.stringify(body) })
  if (!res.ok) throw new Error(`DocuSign create envelope failed: ${await res.text()}`)
  const data = await res.json() as { envelopeId: string }
  return { envelopeId: data.envelopeId, signerCount }
}

// ── Adult & Mentor participation agreements ────────────────────────────────────
// Self-signed envelopes (the participant is the signer). TeacherPhone / MentorPhone
// are sourced from the participant's existing `phone` column, mirroring how
// GuardianPhone is populated from emergency_contact_phone on the minor consent form.

export interface AdultAgreementParams {
  firstName:    string
  lastName:     string
  email:        string
  phone?:       string
  eventTitle:   string
  schoolName?:  string
  schoolState?: string
}

export async function createAdultAgreementEnvelope(p: AdultAgreementParams): Promise<CreatedEnvelope> {
  if (!ENV.adultTemplateId) throw new Error('DOCUSIGN_ADULT_TEMPLATE_ID not configured')
  const fullName = `${p.firstName} ${p.lastName}`

  const body = {
    status:        'sent',
    emailSubject:  `Participation Agreement — ${p.eventTitle}`,
    templateId:    ENV.adultTemplateId,
    templateRoles: [{
      roleName: 'Adult',
      name:     fullName,
      email:    p.email,
      tabs: {
        textTabs: [
          { tabLabel: 'TeacherName',  value: fullName            },
          { tabLabel: 'TeacherEmail', value: p.email             },
          { tabLabel: 'TeacherPhone', value: p.phone      ?? ''  },
          { tabLabel: 'EventTitle',   value: p.eventTitle        },
          { tabLabel: 'SchoolName',   value: p.schoolName ?? ''  },
          { tabLabel: 'SchoolState',  value: p.schoolState ?? '' },
        ],
      },
    }],
  }

  const res = await dsRequest('/envelopes', { method: 'POST', body: JSON.stringify(body) })
  if (!res.ok) throw new Error(`DocuSign create adult envelope failed: ${await res.text()}`)
  const data = await res.json() as { envelopeId: string }
  return { envelopeId: data.envelopeId, signerCount: 1 }
}

export interface MentorAgreementParams {
  firstName:  string
  lastName:   string
  email:      string
  phone?:     string
  eventTitle: string
}

export async function createMentorAgreementEnvelope(p: MentorAgreementParams): Promise<CreatedEnvelope> {
  if (!ENV.mentorTemplateId) throw new Error('DOCUSIGN_MENTOR_TEMPLATE_ID not configured')
  const fullName = `${p.firstName} ${p.lastName}`
  const signerCount = ENV.stellrRepEmail ? 2 : 1

  // Mentor + Stellr representative counter-sign concurrently (identical
  // routingOrder). The 'StellrRepresentative' role must exist on the template;
  // it is only added when DOCUSIGN_STELLR_REP_EMAIL is configured.
  const templateRoles: object[] = [{
    roleName:     'Mentor',
    name:         fullName,
    email:        p.email,
    routingOrder: '1',
    tabs: {
      textTabs: [
        { tabLabel: 'MentorName',  value: fullName      },
        { tabLabel: 'MentorEmail', value: p.email       },
        { tabLabel: 'MentorPhone', value: p.phone ?? '' },
        { tabLabel: 'EventTitle',  value: p.eventTitle  },
      ],
    },
  }]
  if (ENV.stellrRepEmail) {
    templateRoles.push({
      roleName:     'StellrRepresentative',
      name:         ENV.stellrRepName,
      email:        ENV.stellrRepEmail,
      routingOrder: '1',
    })
  }

  const body = {
    status:       'sent',
    emailSubject: `Mentor Participation Agreement — ${p.eventTitle}`,
    templateId:   ENV.mentorTemplateId,
    templateRoles,
  }

  const res = await dsRequest('/envelopes', { method: 'POST', body: JSON.stringify(body) })
  if (!res.ok) throw new Error(`DocuSign create mentor envelope failed: ${await res.text()}`)
  const data = await res.json() as { envelopeId: string }
  return { envelopeId: data.envelopeId, signerCount }
}

// Per-signer progress for an in-flight envelope, used by the Connect webhook
// to keep signers_total / signers_completed current. Carbon copies and other
// non-signing recipients are excluded.
export async function getEnvelopeSignerProgress(
  envelopeId: string,
): Promise<{ total: number; completed: number }> {
  const res = await dsRequest(`/envelopes/${envelopeId}/recipients`)
  if (!res.ok) throw new Error(`DocuSign recipients fetch failed: ${await res.text()}`)
  const data = await res.json() as { signers?: { status?: string }[] }
  const signers = data.signers ?? []
  return {
    total: signers.length,
    completed: signers.filter((s) => (s.status ?? '').toLowerCase() === 'completed').length,
  }
}

export async function resendEnvelope(envelopeId: string): Promise<void> {
  const recipientsRes = await dsRequest(`/envelopes/${envelopeId}/recipients`)
  if (!recipientsRes.ok) throw new Error('Failed to fetch envelope recipients')
  const recipients = await recipientsRes.json()

  const resendRes = await dsRequest(
    `/envelopes/${envelopeId}/recipients?resend_envelope=true`,
    { method: 'PUT', body: JSON.stringify(recipients) },
  )
  if (!resendRes.ok) throw new Error(`DocuSign resend failed: ${await resendRes.text()}`)
}

// Voids an in-flight envelope. DocuSign only allows voiding envelopes that are
// not yet completed/declined; for those the API returns an error, which the
// caller should treat as "nothing to void" rather than a hard failure.
export async function voidEnvelope(envelopeId: string, reason = 'Record deleted by administrator'): Promise<void> {
  const res = await dsRequest(`/envelopes/${envelopeId}`, {
    method: 'PUT',
    body: JSON.stringify({ status: 'voided', voidedReason: reason }),
  })
  if (!res.ok) throw new Error(`DocuSign void failed: ${await res.text()}`)
}

export async function getEnvelopeDocument(envelopeId: string): Promise<ArrayBuffer> {
  const res = await dsRequest(`/envelopes/${envelopeId}/documents/combined`, {
    headers: { Accept: 'application/pdf' },
  })
  if (!res.ok) throw new Error(`DocuSign document fetch failed: ${await res.text()}`)
  return res.arrayBuffer()
}

export function verifyConnectHmac(body: string, signature: string): boolean {
  if (!ENV.connectHmacKey) return true
  const expected = createHmac('sha256', ENV.connectHmacKey)
    .update(body, 'utf8')
    .digest('base64')
  return expected === signature
}

export function isMinor(dateOfBirth: string): boolean {
  if (!dateOfBirth) return false
  const dob = new Date(dateOfBirth)
  const eighteenth = new Date(dob.getFullYear() + 18, dob.getMonth(), dob.getDate())
  return new Date() < eighteenth
}

export type AgreementType = 'minor' | 'adult' | 'mentor'

// Which DocuSign agreement (if any) a participant needs, based on age and role:
//   • under 18                         → minor parental-consent form
//   • adult registering as a mentor    → mentor participation agreement
//   • any other adult attendee         → adult participation agreement
//   • adult school student (edge case) → none
export function classifyAgreement(
  eventRole: string | null | undefined,
  dateOfBirth: string | null | undefined,
): AgreementType | null {
  if (dateOfBirth && isMinor(dateOfBirth)) return 'minor'
  const role = (eventRole ?? '').toLowerCase().replace(/\s+/g, '_')
  if (role === 'mentor') return 'mentor'
  if (!role || role === 'school_student') return null
  return 'adult'
}
