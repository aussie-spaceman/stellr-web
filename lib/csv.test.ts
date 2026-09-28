import { describe, it, expect } from 'vitest'
import { csvCell, toCsv } from './csv'

describe('csvCell', () => {
  it('passes plain text through unquoted', () => {
    expect(csvCell('Tamara Buk')).toBe('Tamara Buk')
    expect(csvCell('0412 345 678')).toBe('0412 345 678')
  })

  it('renders null and undefined as empty', () => {
    expect(csvCell(null)).toBe('')
    expect(csvCell(undefined)).toBe('')
  })

  it('quotes commas, quotes and newlines', () => {
    expect(csvCell('Buk, Tamara')).toBe('"Buk, Tamara"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"')
  })

  it.each(['=1+1', '+1 555 0100', '-2', '@SUM(A1)', '\tx', '\rx'])(
    'neutralises a leading formula character: %j',
    (v) => {
      expect(csvCell(v).replace(/^"/, '').startsWith("'")).toBe(true)
    },
  )

  it('keeps an international phone number readable', () => {
    expect(csvCell('+1 555 0100')).toBe("'+1 555 0100")
  })

  it('neutralises and quotes a formula that also contains a comma', () => {
    expect(csvCell('=HYPERLINK("http://x","y")')).toBe(`"'=HYPERLINK(""http://x"",""y"")"`)
  })

  it('leaves formula characters alone when not leading', () => {
    expect(csvCell('a=b')).toBe('a=b')
    expect(csvCell('555-0100')).toBe('555-0100')
  })
})

describe('toCsv', () => {
  it('joins cells with commas and rows with newlines', () => {
    expect(toCsv([['First', 'Phone'], ['Ann', '+61 400'], ['Bo', null]])).toBe(
      "First,Phone\nAnn,'+61 400\nBo,",
    )
  })
})
