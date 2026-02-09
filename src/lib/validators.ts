/**
 * Input validation and sanitization helpers
 */

const ALLOWED_TOKENS = new Set(['sol', 'usdc', 'usdt', 'yesa', 'zec', 'ore', 'store']);
const BASE64_REGEX = /^[A-Za-z0-9+/]*={0,2}$/;
const SOLANA_BASE58_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function isValidToken(token: unknown): token is string {
  return typeof token === 'string' && ALLOWED_TOKENS.has(token.toLowerCase());
}

export function sanitizeToken(token: unknown): string {
  if (!isValidToken(token)) return 'sol';
  return token.toLowerCase();
}

export function isValidBase64(str: unknown, maxBytes = 1024 * 1024): boolean {
  if (typeof str !== 'string' || str.length === 0) return false;
  if (str.length > maxBytes * 2) return false; // base64 is ~1.33x binary
  if (!BASE64_REGEX.test(str)) return false;
  try {
    const buf = Buffer.from(str, 'base64');
    return buf.length <= maxBytes && buf.length > 0;
  } catch {
    return false;
  }
}

export function isValidSolanaAddress(str: unknown): boolean {
  return typeof str === 'string' && str.length >= 32 && str.length <= 44 && SOLANA_BASE58_REGEX.test(str);
}

/** Commitment: decimal string, reasonable length (e.g. ~78 digits for 256-bit) */
export function isValidCommitment(str: unknown): boolean {
  if (typeof str !== 'string') return false;
  if (str.length < 1 || str.length > 100) return false;
  return /^\d+$/.test(str);
}

/** Hex string for encrypted output */
export function isValidEncryptedOutput(str: unknown, maxLen = 65536): boolean {
  if (typeof str !== 'string') return false;
  if (str.length < 1 || str.length > maxLen) return false;
  return /^[0-9a-fA-F]+$/.test(str);
}

export function clampInt(value: unknown, defaultVal: number, min: number, max: number): number {
  const n = typeof value === 'string' ? parseInt(value, 10) : Number(value);
  if (!Number.isFinite(n)) return defaultVal;
  return Math.max(min, Math.min(max, Math.floor(n)));
}
