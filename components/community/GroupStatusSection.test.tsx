import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { GroupStatusSection } from './GroupStatusSection'
import type { GroupStatus } from '@/lib/group-status'

const group = (over: Partial<GroupStatus>): GroupStatus => ({
  registrationId: 'reg-1',
  name: 'Lincoln MS',
  paid: true,
  invoiceRequested: false,
  amountDueCents: null,
  checkInCodeUrl: null,
  people: [],
  ...over,
})

describe('GroupStatusSection: the group’s check-in code', () => {
  it('links the teacher to their group’s code for the desk', () => {
    const url = 'https://www.stellreducation.org/check-in/nevada/code?c=g.abc'
    render(<GroupStatusSection groups={[group({ checkInCodeUrl: url })]} />)
    expect(screen.getByRole('link', { name: /Show our check-in code/ })).toHaveAttribute('href', url)
  })

  it('says nothing about a code when there isn’t one (a campaign, or no signing secret)', () => {
    render(<GroupStatusSection groups={[group({})]} />)
    expect(screen.queryByRole('link', { name: /check-in code/ })).toBeNull()
  })
})
