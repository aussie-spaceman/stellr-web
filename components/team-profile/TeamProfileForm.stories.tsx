import type { Meta, StoryObj } from '@storybook/nextjs'
import { TeamProfileForm } from './TeamProfileForm'
import { EMPTY_ANSWERS, normaliseAnswers } from '@/lib/team-profile/questions'

// The pre-event team profile a student opens from their email
// (app/(public)/team-profile/[token]). Submitting is a network call, so in
// Storybook the submit shows the error state.
const meta: Meta<typeof TeamProfileForm> = {
  title: 'Team profile/Form',
  component: TeamProfileForm,
  decorators: [(Story) => <div className="bg-surface p-4"><div className="mx-auto max-w-2xl"><Story /></div></div>],
  args: { token: 'storybook', studentFirstName: 'Lily', eventTitle: '2027 Colorado Space Design Challenge', prefilled: false, submitted: false },
}
export default meta

type Story = StoryObj<typeof TeamProfileForm>

const lastYear = normaliseAnswers({
  skills: { art: 'beginner', writing: 'intermediate', presenting: 'beginner', science_maths: 'advanced', engineering: 'intermediate', leadership: 'beginner' },
  strengths: ['problem_solving', 'curiosity'],
  weaknesses: ['communication'],
  focus: 'engineering',
  teamStyle: 'ideas',
  leadership: 'maybe',
  presentingComfort: 2,
  competitions: ['robotics'],
})

export const New: Story = { args: { initial: EMPTY_ANSWERS } }
export const ReturningPrefilled: Story = { args: { initial: lastYear, prefilled: true } }
export const Submitted: Story = { args: { initial: lastYear, submitted: true } }
