/**
 * Database (Supabase) used by shade-api.
 *
 * Only the `commitments` table is used. You can drop unused tables:
 *   DROP TABLE IF EXISTS encrypted_to_index;
 *   DROP TABLE IF EXISTS merkle_tree;
 *
 * Endpoints and DB usage:
 * - GET  /config           — no DB; reads from chain.
 * - GET  /merkle/root      — no DB; reads from chain. Optional ?token=.
 * - GET  /merkle/proof/:c  — DB: commitments only (commitment_index + siblings by token).
 * - POST /deposit, /deposit/spl, /withdraw, /withdraw/spl — no DB; relay signed tx.
 * - GET  /utxos/range      — DB: commitments by token + commitment_index range.
 * - GET  /utxos/check/:eo  — DB: commitments by encrypted_output + token.
 * - POST /utxos/indices    — DB: commitments by token + encrypted_outputs.
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config/env.js';

let supabase: SupabaseClient | null = null;

export function getDb(): SupabaseClient {
  if (!supabase) {
    if (!config.supabaseUrl || !config.supabaseServiceKey) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in environment');
    }
    supabase = createClient(config.supabaseUrl, config.supabaseServiceKey, {
      auth: { persistSession: false },
    });
  }
  return supabase;
}

export interface CommitmentRow {
  id: number;
  token: string;
  commitment_index: number;
  commitment: string;
  encrypted_output: string;
  mint_address: string | null;
}
