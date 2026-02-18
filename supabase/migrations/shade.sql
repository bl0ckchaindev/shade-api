-- Shade indexer schema (PostgreSQL)
-- Run this once when starting the project (e.g. Supabase SQL Editor or psql).
-- Only the commitments table is used (indexer writes; merkle proof + utxos routes read).

CREATE TABLE IF NOT EXISTS commitments (
  id BIGSERIAL PRIMARY KEY,
  token TEXT NOT NULL DEFAULT 'sol',
  commitment_index BIGINT NOT NULL,
  commitment TEXT NOT NULL UNIQUE,
  encrypted_output TEXT NOT NULL,
  mint_address TEXT,
  transaction_signature TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Composite (token, commitment_index) for range and token queries; INCLUDE for index-only scans
CREATE INDEX IF NOT EXISTS idx_commitments_token_index ON commitments (token, commitment_index)
  INCLUDE (commitment, encrypted_output);
CREATE INDEX IF NOT EXISTS idx_commitments_encrypted ON commitments (encrypted_output);

-- Unique on (transaction_signature, commitment) so we don't insert the same commitment from the same tx twice
CREATE UNIQUE INDEX IF NOT EXISTS idx_commitments_tx_commitment
  ON commitments (transaction_signature, commitment)
  WHERE transaction_signature IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_commitments_transaction_signature ON commitments (transaction_signature);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS commitments_updated_at ON commitments;
CREATE TRIGGER commitments_updated_at BEFORE UPDATE ON commitments FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE commitments ENABLE ROW LEVEL SECURITY;
