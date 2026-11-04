// Semgrep rule test for .semgrep/service-role.yml: a server module outside the
// allow-list (this path is not under app/, lib/, scripts/, …). Never imported
// or compiled: .semgrep/ is excluded from tsconfig and from scans (.semgrepignore).

// ruleid: stellr-service-role-outside-allowlist
import { supabaseServer } from '@/lib/supabase'
// ruleid: stellr-service-role-outside-allowlist
import { supabaseServerTyped as typed } from '../../lib/supabase'
// ruleid: stellr-service-role-outside-allowlist
import * as sb from '@/lib/supabase'

// ok: stellr-service-role-outside-allowlist
import { supabase } from '@/lib/supabase-public'
// ok: stellr-service-role-outside-allowlist
import { supabasePublicKey } from '@/lib/supabase-keys'

// ruleid: stellr-service-role-outside-allowlist
const lazy = () => import('@/lib/supabase')

export const refs = [supabaseServer, typed, sb, supabase, supabasePublicKey, lazy]
