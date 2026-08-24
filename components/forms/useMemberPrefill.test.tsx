import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import {
  __resetMemberPrefillCache,
  usePrefillFields,
  usePrefillForm,
  usePrefillNameEmail,
} from './useMemberPrefill'

const MEMBER = {
  firstName: 'Dana',
  lastName: 'Reyes',
  email: 'dana@lincolnhigh.edu',
  phone: '555-0100',
  schoolName: 'Lincoln High School',
}

/** Resolve the prefill fetch on demand, so "arrives late" is testable. */
let release: (value: unknown) => void
function stubFetch(payload: unknown = MEMBER) {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ ok: true, json: async () => payload } as Response)
        }),
    ),
  )
}

beforeEach(() => {
  __resetMemberPrefillCache()
  stubFetch()
})
afterEach(() => vi.unstubAllGlobals())

function RhfForm() {
  const { register, reset } = useForm<{ firstName: string; email: string }>({
    defaultValues: { firstName: '', email: '' },
  })
  usePrefillForm(reset, (p) => ({ firstName: p.firstName, email: p.email }))
  return (
    <form>
      <input aria-label="First name" {...register('firstName')} />
      <input aria-label="Email" {...register('email')} />
    </form>
  )
}

function StateForm() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  usePrefillNameEmail(name, setName, email, setEmail)
  return (
    <form>
      <input aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} />
      <input aria-label="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
    </form>
  )
}

function FieldsForm() {
  const [email, setEmail] = useState('')
  usePrefillFields({ email: [email, setEmail] })
  return <input aria-label="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
}

describe('member prefill', () => {
  it('fills a react-hook-form once the member record arrives', async () => {
    render(<RhfForm />)
    expect(screen.getByLabelText('First name')).toHaveValue('')

    release(null)
    await waitFor(() => expect(screen.getByLabelText('First name')).toHaveValue('Dana'))
    expect(screen.getByLabelText('Email')).toHaveValue('dana@lincolnhigh.edu')
  })

  it('never overwrites a field the visitor already typed into', async () => {
    const user = userEvent.setup()
    render(<RhfForm />)

    // Prefill is still in flight — exactly the race a fast typist creates.
    await user.type(screen.getByLabelText('First name'), 'Sam')
    release(null)

    await waitFor(() => expect(screen.getByLabelText('Email')).toHaveValue('dana@lincolnhigh.edu'))
    expect(screen.getByLabelText('First name')).toHaveValue('Sam')
  })

  it('fills a useState name/email pair, and leaves typed values alone', async () => {
    const user = userEvent.setup()
    render(<StateForm />)

    await user.type(screen.getByLabelText('Email'), 'me@example.com')
    release(null)

    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue('Dana Reyes'))
    expect(screen.getByLabelText('Email')).toHaveValue('me@example.com')
  })

  it('fills mapped useState fields', async () => {
    render(<FieldsForm />)
    release(null)
    await waitFor(() => expect(screen.getByLabelText('Email')).toHaveValue('dana@lincolnhigh.edu'))
  })

  it('leaves every form untouched for a signed-out visitor', async () => {
    stubFetch({})
    render(<RhfForm />)
    release(null)

    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(screen.getByLabelText('First name')).toHaveValue('')
    expect(screen.getByLabelText('Email')).toHaveValue('')
  })

  it('makes one request no matter how many forms are on the page', async () => {
    render(
      <>
        <RhfForm />
        <StateForm />
        <FieldsForm />
      </>,
    )
    release(null)

    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue('Dana Reyes'))
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
