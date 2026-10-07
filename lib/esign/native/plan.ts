import { formatFormDate } from '@/lib/docusign-form-data'
import { isMinorOn } from '@/lib/age'
import type { CreateAgreementRequest } from '@/lib/esign/types'
import type { Role } from '@/lib/esign/native/template'

// How an agreement request becomes a document, pre-fill data and an ordered
// list of signers on Stellr signing. The pre-fill keys are the DocuSign tab
// labels, so a converted template fills exactly as it did in DocuSign.

export type TemplateKey = 'minor' | 'adult' | 'mentor' | 'membership_adult' | 'membership_minor'

/** The documents' own titles (Participation Agreements V2.3, 2 Oct 2026). */
export const AGREEMENT_TITLE = {
  minor: 'Participation Agreement — Student / Minor',
  adult: 'Participation Agreement — Educator / Chaperone',
  mentor: 'Mentor and Volunteer Agreement',
  membership: 'Membership Agreement',
} as const

/** The version of each agreement now issued, recorded on every agreement row (agreement_version). */
export const AGREEMENT_VERSION = '2.3'

/** DocuSign's role names, kept on recipient rows so every status surface reads them the same way. */
export const ROLE_NAME: Record<Role, string> = {
  guardian: 'Guardian',
  student: 'Minor',
  adult: 'Adult',
  mentor: 'Mentor',
  member: 'Member',
  stellr: 'StellrRepresentative',
}

export interface PlannedSigner {
  role: Role
  name: string
  email: string
  memberId: string | null
  /** Signing order. A minor's guardian always signs before the minor. */
  order: number
}

export interface IssuePlan {
  templateKey: TemplateKey
  /** What the agreement is called, for emails and the certificate. */
  label: string
  prefill: Record<string, string>
  names: Partial<Record<Role, string>>
  signers: PlannedSigner[]
  /** True when a child is the subject: signers confirm the child's birth year before anything is shown. */
  minorSubject: boolean
  /** The child's year of birth, for that check. */
  subjectBirthYear: string | null
}

const clean = (s: string | null | undefined) => (s ?? '').trim()
const lower = (s: string | null | undefined) => clean(s).toLowerCase()
const yearOf = (dob: string | null | undefined) => /^(\d{4})-/.exec(dob ?? '')?.[1] ?? null

export function planAgreement(req: CreateAgreementRequest): IssuePlan {
  const memberId = req.accounts?.memberId ?? null

  switch (req.type) {
    case 'minor': {
      const p = req.params
      const minorName = `${clean(p.minorFirstName)} ${clean(p.minorLastName)}`.trim()
      const signers: PlannedSigner[] = [
        { role: 'guardian', name: clean(p.guardianName), email: lower(p.guardianEmail), memberId: null, order: 1 },
      ]
      // Guardian first, always: nothing is collected from the child, not even
      // a signature or the device they used, until a parent has consented.
      if (clean(p.minorEmail)) {
        signers.push({ role: 'student', name: minorName, email: lower(p.minorEmail), memberId, order: 2 })
      }
      return {
        templateKey: 'minor',
        label: AGREEMENT_TITLE.minor,
        prefill: {
          MinorName: minorName,
          MinorDateOfBirth: formatFormDate(p.minorDateOfBirth),
          MinorEmail: lower(p.minorEmail),
          MinorGrade: clean(p.grade),
          EventTitle: clean(p.eventTitle),
          GuardianName: clean(p.guardianName),
          GuardianEmail: lower(p.guardianEmail),
          GuardianPhone: clean(p.guardianPhone),
          MinorRelationship: clean(p.relationship),
          SchoolName: clean(p.schoolName),
          SchoolState: clean(p.schoolState),
        },
        names: { guardian: clean(p.guardianName), student: minorName },
        signers,
        minorSubject: true,
        subjectBirthYear: yearOf(p.minorDateOfBirth),
      }
    }

    case 'adult': {
      const p = req.params
      const name = `${clean(p.firstName)} ${clean(p.lastName)}`.trim()
      return {
        templateKey: 'adult',
        label: AGREEMENT_TITLE.adult,
        prefill: {
          TeacherName: name,
          TeacherEmail: lower(p.email),
          TeacherPhone: clean(p.phone),
          EventTitle: clean(p.eventTitle),
          SchoolName: clean(p.schoolName),
          SchoolState: clean(p.schoolState),
        },
        names: { adult: name },
        signers: [{ role: 'adult', name, email: lower(p.email), memberId, order: 1 }],
        minorSubject: false,
        subjectBirthYear: null,
      }
    }

    case 'mentor':
    case 'volunteer': {
      const p = req.params
      const name = `${clean(p.firstName)} ${clean(p.lastName)}`.trim()
      const mentor: PlannedSigner = { role: 'mentor', name, email: lower(p.email), memberId, order: 2 }
      // §3A: a Mentor under the age of majority where they live needs a
      // parent or legal guardian to sign too, and the parent signs first.
      const underMajority = isMinorOn(p.dateOfBirth ?? null, undefined, p.state ?? null)
      if (underMajority && (!clean(p.guardianEmail) || !clean(p.guardianName))) {
        throw new Error('A parent or guardian name and email are required for a Mentor under the age of majority')
      }
      const guardian: PlannedSigner | null = underMajority
        ? { role: 'guardian', name: clean(p.guardianName), email: lower(p.guardianEmail), memberId: null, order: 1 }
        : null
      return {
        templateKey: 'mentor',
        label: AGREEMENT_TITLE.mentor,
        prefill: {
          MentorName: name,
          MentorEmail: lower(p.email),
          MentorPhone: clean(p.phone),
          EventTitle: clean(p.eventTitle),
          EmergencyContactName: clean(p.emergencyContactName),
          EmergencyContactPhone: clean(p.emergencyContactPhone),
        },
        names: { mentor: name, ...(guardian ? { guardian: guardian.name } : {}) },
        // Stellr's counter-signature is applied by the engine on completion,
        // under the standing authorisation, so it is not a signer here.
        signers: guardian ? [guardian, mentor] : [mentor],
        minorSubject: underMajority,
        subjectBirthYear: underMajority ? yearOf(p.dateOfBirth ?? undefined) : null,
      }
    }

    case 'membership': {
      const p = req.params
      const name = `${clean(p.firstName)} ${clean(p.lastName)}`.trim()
      if (isMinorOn(p.dateOfBirth)) {
        if (!clean(p.guardianEmail) || !clean(p.guardianName)) {
          throw new Error('A parent or guardian name and email are required for an under-18 membership agreement')
        }
        // V2.3: the Student / Minor agreement covers membership as well as
        // every event, so a Minor joining signs that same document.
        return {
          templateKey: 'minor',
          label: AGREEMENT_TITLE.minor,
          prefill: {
            MinorName: name,
            MinorDateOfBirth: formatFormDate(p.dateOfBirth),
            MinorEmail: lower(p.email),
            MinorGrade: clean(p.grade),
            GuardianName: clean(p.guardianName),
            GuardianEmail: lower(p.guardianEmail),
            GuardianPhone: clean(p.guardianPhone),
            MinorRelationship: clean(p.relationship),
          },
          names: { guardian: clean(p.guardianName), student: name },
          signers: [
            { role: 'guardian', name: clean(p.guardianName), email: lower(p.guardianEmail), memberId: null, order: 1 },
            { role: 'student', name, email: lower(p.email), memberId: p.memberId, order: 2 },
          ],
          minorSubject: true,
          subjectBirthYear: yearOf(p.dateOfBirth),
        }
      }
      // An adult joining signs the Educator / Chaperone agreement (David,
      // 7 Oct 2026): the same document as their events, so it is recorded as
      // one (dispatchTyped) and their next event finds it on file.
      return {
        templateKey: 'adult',
        label: AGREEMENT_TITLE.adult,
        prefill: {
          TeacherName: name,
          TeacherEmail: lower(p.email),
          TeacherPhone: clean(p.phone),
        },
        names: { adult: name },
        signers: [{ role: 'adult', name, email: lower(p.email), memberId: p.memberId, order: 1 }],
        minorSubject: false,
        subjectBirthYear: null,
      }
    }
  }
}
