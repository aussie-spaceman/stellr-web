import type { SchoolSelection } from '@/components/member/SchoolSearchInput'

export interface SchoolPayload {
  school_name: string
  school_address_street: string | null
  school_address_city: string | null
  school_address_state: string | null
  school_address_zip: string | null
}

export function resolveSchoolPayload(sel: SchoolSelection | null): SchoolPayload {
  if (!sel) return { school_name: '', school_address_street: null, school_address_city: null, school_address_state: null, school_address_zip: null }
  if (sel.type === 'existing') {
    return { school_name: sel.name, school_address_street: null, school_address_city: null, school_address_state: null, school_address_zip: null }
  }
  return {
    school_name: sel.data.name,
    school_address_street: sel.data.address_line1 || null,
    school_address_city: sel.data.city || null,
    school_address_state: sel.data.state || null,
    school_address_zip: sel.data.postcode || null,
  }
}
