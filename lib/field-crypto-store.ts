import type { SupabaseClient } from '@supabase/supabase-js'
import type { DekRow, DekStore } from '@/lib/field-crypto'

// public.tenant_data_keys as a DekStore (supabase/migrations/
// 20261104400000_field_crypto_shadow.sql). The service role may read, insert
// and update rows (retire, re-wrap) but not delete or truncate them (the
// migration revokes Supabase's default GRANT ALL first): deleting a DEK
// destroys every value written under it, so that is an owner action in the
// SQL editor (docs/FIELD-CRYPTO.md).
//
// Errors from Supabase are rethrown as plain Errors carrying only the
// PostgREST code; FieldCrypto turns them into FieldCryptoError('store').

const UNIQUE_VIOLATION = '23505'

class StoreError extends Error {
  constructor(code: string | undefined) {
    super(`tenant_data_keys request failed (${code ?? 'unknown'})`)
    this.name = 'StoreError'
  }
}

export function supabaseDekStore(db: SupabaseClient): DekStore {
  return {
    async listKeys(tenantId) {
      const { data, error } = await db
        .from('tenant_data_keys')
        .select('tenant_id, key_id, master_key_id, wrapped_dek, created_at, retired_at')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: true })
      if (error) throw new StoreError(error.code)
      return (data ?? []) as DekRow[]
    },
    async insertKey(row) {
      const { error } = await db.from('tenant_data_keys').insert(row)
      if (!error) return 'ok'
      if (error.code === UNIQUE_VIOLATION) return 'conflict'
      throw new StoreError(error.code)
    },
    async retireKey(tenantId, keyId, at) {
      const { error } = await db
        .from('tenant_data_keys')
        .update({ retired_at: at })
        .eq('tenant_id', tenantId)
        .eq('key_id', keyId)
        .is('retired_at', null)
      if (error) throw new StoreError(error.code)
    },
    async updateWrapped(tenantId, keyId, masterKeyId, wrapped) {
      const { error } = await db
        .from('tenant_data_keys')
        .update({ master_key_id: masterKeyId, wrapped_dek: wrapped })
        .eq('tenant_id', tenantId)
        .eq('key_id', keyId)
      if (error) throw new StoreError(error.code)
    },
  }
}
