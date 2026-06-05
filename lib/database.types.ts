export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export interface RegistrationRow {
  id: string
  event_slug: string
  event_title: string
  type: 'individual' | 'group'
  status: 'pending' | 'confirmed' | 'withdrawn'
  created_at: string
  updated_at: string
  withdrawn_at: string | null
  teacher_first_name: string | null
  teacher_last_name: string | null
  teacher_email: string | null
  school_name: string | null
  school_address_street: string | null
  school_address_city: string | null
  school_address_state: string | null
  school_address_zip: string | null
  invoice_requested: boolean
  registrant_role: 'teacher' | 'student_manager'
  teacher_poc_first_name: string | null
  teacher_poc_last_name: string | null
  teacher_poc_email: string | null
  member_pays_individually: boolean
  details_method: 'add_now' | 'spreadsheet' | 'email_link'
}

export type RegistrationInsert = Omit<RegistrationRow, 'id' | 'created_at' | 'updated_at'>

export interface ParticipantRow {
  id: string
  registration_id: string
  first_name: string
  last_name: string
  nickname: string | null
  email: string
  phone: string
  date_of_birth: string
  grade: string | null
  gender: string
  ethnicity: string[]
  t_shirt_size: string
  school_name: string
  age_bracket: string
  event_role: string
  dietary_requirements: string[]
  health_conditions: string | null
  emergency_contact_first_name: string | null
  emergency_contact_last_name: string | null
  emergency_contact_email: string | null
  emergency_contact_phone: string | null
  membership_id: string
  company_name: string | null
  award: string | null
  created_at: string
}

export type ParticipantInsert = Omit<ParticipantRow, 'id' | 'created_at' | 'membership_id' | 'company_name' | 'award'>

export interface Database {
  public: {
    Tables: {
      registrations: {
        Row: RegistrationRow
        Insert: RegistrationInsert
        Update: Partial<RegistrationInsert>
      }
      participants: {
        Row: ParticipantRow
        Insert: ParticipantInsert
        Update: Partial<ParticipantInsert>
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
