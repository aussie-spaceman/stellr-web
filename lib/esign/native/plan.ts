import { formatFormDate } from '@/lib/docusign-form-data'
import { isMinorOn } from '@/lib/age'
import type { CreateAgreementRequest } from '@/lib/esign/types'
import type { Role } from '@/lib/esign/native/template'

// How an agreement request becomes a document, pre-fill data and an ordered
// list of signers on Stellr signing. The pre-fill keys are the DocuSign tab
// labels, so a converted template fills exactly as it did in DocuSign.

export type TemplateKey = 'minor' | 'adult' | 'mentor' | 'membership_adult' | 'membership_minor'

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
        label: 'Parental Consent Form',
        prefill: {
          MinorName: minorName,
          MinorDateOfBirth: formatFormDate(p.minorDateOfBirth),
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
        label: 'Participation Agreement',
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
      return {
        templateKey: 'mentor',
        label: 'Mentor Participation Agreement',
        prefill: {
          MentorName: name,
          MentorEmail: lower(p.email),
          MentorPhone: clean(p.phone),
          EventTitle: clean(p.eventTitle),
        },
        names: { mentor: name },
        // Stellr's counter-signature is applied by the engine on completion,
        // under the standing authorisation, so it is not a signer here.
        signers: [{ role: 'mentor', name, email: lower(p.email), memberId, order: 1 }],
        minorSubject: false,
        subjectBirthYear: null,
      }
    }

    case 'membership': {
      const p = req.params
      const name = `${clean(p.firstName)} ${clean(p.lastName)}`.trim()
      const prefill = {
        MemberName: name,
        MemberEmail: lower(p.email),
        MemberPhone: clean(p.phone),
        MemberDateOfBirth: formatFormDate(p.dateOfBirth),
        GuardianName: clean(p.guardianName),
        GuardianEmail: lower(p.guardianEmail),
        GuardianPhone: clean(p.guardianPhone),
        MinorRelationship: clean(p.relationship),
      }
      const member: PlannedSigner = { role: 'member', name, email: lower(p.email), memberId: p.memberId, order: 1 }

      if (isMinorOn(p.dateOfBirth)) {
        if (!clean(p.guardianEmail) || !clean(p.guardianName)) {
          throw new Error('A parent or guardian name and email are required for an under-18 membership agreement')
        }
        return {
          templateKey: 'membership_minor',
          label: 'Membership Agreement',
          prefill,
          names: { guardian: clean(p.guardianName), member: name },
          signers: [
            { role: 'guardian', name: clean(p.guardianName), email: lower(p.guardianEmail), memberId: null, order: 1 },
            { ...member, order: 2 },
          ],
          minorSubject: true,
          subjectBirthYear: yearOf(p.dateOfBirth),
        }
      }
      return {
        templateKey: 'membership_adult',
        label: 'Membership Agreement',
        prefill,
        names: { member: name },
        signers: [member],
        minorSubject: false,
        subjectBirthYear: null,
      }
    }
  }
}
