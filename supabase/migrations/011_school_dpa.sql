-- Add FERPA school official DPA acceptance timestamp to group registrations
ALTER TABLE registrations
  ADD COLUMN IF NOT EXISTS school_dpa_agreed_at timestamptz NULL;
