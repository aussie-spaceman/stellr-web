'use client'
// Semgrep rule test for .semgrep/service-role-client.yml. Never imported or
// compiled: .semgrep/ is excluded from tsconfig and from scans (.semgrepignore).

// ruleid: stellr-service-role-in-client-module
import { supabaseServer } from '@/lib/supabase'
// ruleid: stellr-service-role-in-client-module
import { supabaseServerTyped as typed } from '../../lib/supabase'
// ruleid: stellr-service-role-in-client-module
import * as sb from '@/lib/supabase'

// ok: stellr-service-role-in-client-module
import { supabasePublicKey } from '@/lib/supabase-keys'
// ok: stellr-service-role-in-client-module
import { createClient } from '@supabase/supabase-js'

export const refs = [supabaseServer, typed, sb, supabasePublicKey, createClient]
