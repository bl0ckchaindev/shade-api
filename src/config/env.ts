import 'dotenv/config';
import { PublicKey } from '@solana/web3.js';

const isDevnet = (process.env.RPC_URL ?? '').includes('devnet') || process.env.NETWORK === 'devnet';

/** Parse CORS origins: comma-separated list, or * for allow-all */
function getCorsOrigins(): string[] | '*' {
  const raw = process.env.CORS_ORIGINS ?? '';
  if (raw === '*' || raw.trim() === '') return '*';
  return raw.split(',').map((o) => o.trim()).filter(Boolean);
}

export const config = {
  rpcUrl: process.env.RPC_URL ?? 'https://api.devnet.solana.com',
  isDevnet,
  programId: new PublicKey(process.env.PROGRAM_ID ?? 'AC3k4mMzmKHEVMt2Lpr7HwiwqeBth3BfSvvbL8XfpR4G'),
  relayerKeypairPath: process.env.RELAYER_KEYPAIR_PATH ?? './relayer-keypair.json',
  altAddress: new PublicKey(process.env.ALT_ADDRESS ?? '7R5yXHwPZb8bL4DSLqXB3WWgGcAh7TGePJUzNGxzncyB'),
  feeRecipient: new PublicKey(process.env.FEE_RECIPIENT ?? '37aE2MTeWyDLogD4KbBHmLp9A2XWddqfTbAAfWfQYm7U'),
  port: parseInt(process.env.PORT ?? '3001', 10),
  supabaseUrl: process.env.SUPABASE_URL ?? '',
  supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  corsOrigins: getCorsOrigins(),
  configCacheTtlMs: parseInt(process.env.CONFIG_CACHE_TTL_MS ?? '30000', 10), // 30s default
  // 0 = always fetch fresh from chain (avoids UnknownRoot when tree updates between requests)
  merkleCacheTtlMs: parseInt(process.env.MERKLE_CACHE_TTL_MS ?? '0', 10),
} as const;

export function validateConfig(): void {
  const missing: string[] = [];
  if (!config.supabaseUrl || !config.supabaseServiceKey) {
    missing.push('SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY');
  }
  if (missing.length > 0) {
    throw new Error(`Missing required env vars: ${[...new Set(missing)].join(', ')}`);
  }
}
