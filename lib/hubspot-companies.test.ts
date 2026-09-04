import { describe, it, expect } from 'vitest'
import {
  domainFromEmail,
  isFreeEmailDomain,
  normaliseDomain,
} from './hubspot-companies'

describe('normaliseDomain', () => {
  it('strips protocol, www, path, query and port', () => {
    expect(normaliseDomain('https://www.carson.k12.nv.us/about?x=1')).toBe('carson.k12.nv.us')
    expect(normaliseDomain('http://example.com:8080/')).toBe('example.com')
    expect(normaliseDomain('  WWW.Example.COM  ')).toBe('example.com')
  })

  it('keeps multi-part public-suffix domains intact', () => {
    // School districts live under long suffixes; truncating to the last two
    // labels would merge every Nevada district into "nv.us".
    expect(normaliseDomain('washoeschools.net')).toBe('washoeschools.net')
    expect(normaliseDomain('https://ccsd.net')).toBe('ccsd.net')
  })

  it('rejects values that are not domains', () => {
    expect(normaliseDomain('not a domain')).toBeUndefined()
    expect(normaliseDomain('localhost')).toBeUndefined()
    expect(normaliseDomain('')).toBeUndefined()
    expect(normaliseDomain(undefined)).toBeUndefined()
  })
})

describe('domainFromEmail', () => {
  it('takes the domain from an work address', () => {
    expect(domainFromEmail('rchambers@carson.k12.nv.us')).toBe('carson.k12.nv.us')
    expect(domainFromEmail('  Head@Example.COM ')).toBe('example.com')
  })

  /**
   * The trap this guards. A prospect replying from a personal address must not
   * create a company called "Gmail" that then accumulates every unrelated
   * consumer lead as an employee.
   */
  it('returns nothing for consumer mailbox providers', () => {
    for (const e of [
      'a@gmail.com', 'b@yahoo.com', 'c@hotmail.com', 'd@outlook.com',
      'e@icloud.com', 'f@aol.com', 'g@proton.me', 'h@comcast.net',
    ]) {
      expect(domainFromEmail(e)).toBeUndefined()
    }
  })

  it('returns nothing for a malformed address', () => {
    expect(domainFromEmail('no-at-sign')).toBeUndefined()
    expect(domainFromEmail(undefined)).toBeUndefined()
  })
})

describe('isFreeEmailDomain', () => {
  it('identifies consumer providers', () => {
    expect(isFreeEmailDomain('gmail.com')).toBe(true)
    expect(isFreeEmailDomain('ccsd.net')).toBe(false)
    expect(isFreeEmailDomain(undefined)).toBe(false)
  })
})
