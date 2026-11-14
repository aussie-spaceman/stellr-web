import { describe, it, expect } from 'vitest'
import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PlacementSlider } from './PlacementSlider'

let last = NaN
function Harness({ initial = 0.545, size = false }: { initial?: number; size?: boolean }) {
  const [v, setV] = useState(initial)
  const onChange = (n: number) => { last = n; setV(n) }
  return size
    ? <PlacementSlider label="Name size" value={v} onChange={onChange} min={16} max={72} step={1} unit="pt" />
    : <PlacementSlider label="Height on the page" value={v} onChange={onChange} min={0.3} max={0.8} step={0.005} scale={100} unit="%" suffix="down" />
}

const number = () => screen.getByRole('spinbutton') as HTMLInputElement
const range = () => screen.getByRole('slider') as HTMLInputElement

describe('PlacementSlider', () => {
  it('shows the stored fraction as a percentage', () => {
    render(<Harness />)
    expect(number().value).toBe('54.5')
    expect(screen.getByText('down')).toBeTruthy()
  })

  it('typing a percentage moves the slider', async () => {
    render(<Harness />)
    await userEvent.clear(number())
    await userEvent.type(number(), '62.5')
    expect(last).toBe(0.625)
    expect(range().value).toBe('0.625')
  })

  it('does not jump while a number is half typed', async () => {
    render(<Harness />)
    last = NaN
    await userEvent.clear(number())
    await userEvent.type(number(), '6')
    expect(Number.isNaN(last)).toBe(true)
  })

  it('snaps an out-of-range number to the slider end on Enter', async () => {
    render(<Harness />)
    await userEvent.clear(number())
    await userEvent.type(number(), '95{Enter}')
    expect(last).toBe(0.8)
    expect(number().value).toBe('80')
  })

  it('snaps low on blur and rounds to the shown precision', async () => {
    render(<Harness />)
    await userEvent.clear(number())
    await userEvent.type(number(), '12')
    await userEvent.tab()
    expect(last).toBe(0.3)
    await userEvent.clear(number())
    await userEvent.type(number(), '41.26')
    await userEvent.tab()
    expect(last).toBe(0.413)
  })

  it('Escape drops the edit, and an empty field keeps the value', async () => {
    render(<Harness />)
    await userEvent.clear(number())
    await userEvent.type(number(), '7{Escape}')
    expect(number().value).toBe('54.5')
    await userEvent.clear(number())
    await userEvent.tab()
    expect(number().value).toBe('54.5')
  })

  it('edits point sizes without scaling', async () => {
    render(<Harness initial={40} size />)
    expect(number().value).toBe('40')
    await userEvent.clear(number())
    await userEvent.type(number(), '48')
    expect(last).toBe(48)
    expect(screen.getByLabelText('Name size (pt)')).toBe(number())
  })
})
