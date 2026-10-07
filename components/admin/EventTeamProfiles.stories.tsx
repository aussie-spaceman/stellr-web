import type { Meta, StoryObj } from '@storybook/nextjs'
import EventTeamProfiles from './EventTeamProfiles'
import type { CompanyPlan, PlanningStudent } from '@/lib/team-profile/assign'
import { normaliseAnswers } from '@/lib/team-profile/questions'

// Roster tab → Team profiles (admins and event managers).
const meta: Meta<typeof EventTeamProfiles> = {
  title: 'Admin/Event team profiles',
  component: EventTeamProfiles,
  parameters: { nextjs: { appDirectory: true } },
  decorators: [(Story) => <div className="bg-brand-canvas p-4"><Story /></div>],
}
export default meta

type Story = StoryObj<typeof EventTeamProfiles>

const base: Omit<PlanningStudent, 'participantId' | 'firstName' | 'lastName'> = {
  school: 'Lincoln High School',
  grade: 'grade_10',
  gender: 'Female',
  age: 15.4,
  ethnicity: ['Hispanic or Latino'],
  experience: 1,
  registrationId: 'r1',
  isGroup: true,
  companyId: 'c1',
  companyNumber: 1,
  locked: false,
  status: 'submitted',
  lastSentAt: '2026-10-01T15:00:00Z',
  sendCount: 1,
  lastSendError: null,
  submittedAt: '2026-10-02T15:00:00Z',
  answers: normaliseAnswers({
    skills: { art: 'advanced', writing: 'intermediate', presenting: 'beginner', science_maths: 'intermediate', engineering: 'beginner', leadership: 'advanced' },
    strengths: ['creativity', 'teamwork'],
    weaknesses: ['time_management'],
    focus: 'design',
    teamStyle: 'take_charge',
    leadership: 'yes',
    presentingComfort: 4,
    competitions: ['science_fair'],
    teammates: ['Sam Lee', 'Jordan'],
    notes: 'I’d like to try the engineering side this year.',
  }),
  teammates: [{ typed: 'Sam Lee', participantId: 'p2' }, { typed: 'Jordan', participantId: null }],
  suggestedCompany: null,
}

const plan: CompanyPlan = {
  companies: [
    { id: 'c1', number: 1, name: 'Orbital Dynamics' },
    { id: 'c2', number: 2, name: null },
  ],
  students: [
    { ...base, participantId: 'p1', firstName: 'Lily', lastName: 'Nguyen' },
    { ...base, participantId: 'p2', firstName: 'Sam', lastName: 'Lee', gender: 'Male', locked: true, teammates: [], answers: { ...base.answers!, teammates: [] } },
    { ...base, participantId: 'p3', firstName: 'Ava', lastName: 'Patel', companyId: null, companyNumber: null, status: 'sent', submittedAt: null, answers: null, teammates: [], sendCount: 2, suggestedCompany: 2 },
    { ...base, participantId: 'p4', firstName: 'Noah', lastName: 'Kim', companyId: null, companyNumber: null, status: 'waiting', submittedAt: null, lastSentAt: null, sendCount: 0, answers: null, teammates: [], suggestedCompany: 2 },
  ],
}

export const Default: Story = { args: { eventSlug: 'storybook', plan } }
