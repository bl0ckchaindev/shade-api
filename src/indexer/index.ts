/**
 * Shade program event indexer.
 * Uses connection.onLogs() to subscribe to program logs and writes CommitmentData to the commitments table.
 * Anchor events are logged as base64(discriminator[8] + borsh(fields)). We match the discriminator
 * so commitment and encrypted_output are read from the correct layout (SOL vs SPL).
 */
import { createHash } from 'crypto';
import { PublicKey } from '@solana/web3.js';
import { getConnection } from '../solana/connection.js';
import { config } from '../config/env.js';
import { getDb } from '../db/index.js';

/** Anchor event discriminator = first 8 bytes of sha256("event:EventName"). */
function eventDiscriminator(eventName: string): Buffer {
  return createHash('sha256').update(`event:${eventName}`).digest().subarray(0, 8);
}

const DISCRIMINATOR_COMMITMENT = eventDiscriminator('CommitmentData');
const DISCRIMINATOR_SPL_COMMITMENT = eventDiscriminator('SplCommitmentData');

/** Commitment bytes to decimal (big-endian, same as root/circuit/instruction). */
function commitmentToDecimal(commitment: Uint8Array): string {
  const buf = Buffer.from(commitment);
  if (buf.length !== 32) return '0';
  return BigInt('0x' + buf.toString('hex')).toString(10);
}

/** Layout after 8-byte discriminator: index(8) + commitment(32) + encLen(4) + encrypted_output. */
function parseCommitmentData(data: Buffer): { index: number; commitment: string; encryptedOutput: string } | null {
  const minLen = 8 + 8 + 32 + 4;
  if (data.length < minLen) return null;
  const index = Number(data.readBigUInt64LE(8));
  const commitmentBytes = data.slice(16, 48);
  const encLen = data.readUInt32LE(48);
  if (52 + encLen > data.length) return null;
  const encryptedOutput = data.slice(52, 52 + encLen);
  return {
    index,
    commitment: commitmentToDecimal(commitmentBytes),
    encryptedOutput: encryptedOutput.toString('hex'),
  };
}

/** Layout after 8-byte discriminator: index(8) + mint(32) + commitment(32) + encLen(4) + encrypted_output. */
function parseSplCommitmentData(
  data: Buffer
): { index: number; mintAddress: string; commitment: string; encryptedOutput: string } | null {
  const minLen = 8 + 8 + 32 + 32 + 4;
  if (data.length < minLen) return null;
  const index = Number(data.readBigUInt64LE(8));
  const mintBytes = data.slice(16, 48);
  const commitmentBytes = data.slice(48, 80);
  const encLen = data.readUInt32LE(80);
  if (84 + encLen > data.length) return null;
  const encryptedOutput = data.slice(84, 84 + encLen);
  return {
    index,
    mintAddress: new PublicKey(mintBytes).toString(),
    commitment: commitmentToDecimal(commitmentBytes),
    encryptedOutput: encryptedOutput.toString('hex'),
  };
}

/** Canonical mints per network. Always store these in DB so mint_address is never invalid. */
const SOL_MINT = 'So11111111111111111111111111111111111111112';

const MAINNET_MINT_TO_TOKEN: Record<string, string> = {
  '11111111111111111111111111111112': 'sol',
  [SOL_MINT]: 'sol',
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 'usdc',
  'USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB': 'yesa',
};
const DEVNET_MINT_TO_TOKEN: Record<string, string> = {
  '11111111111111111111111111111112': 'sol',
  [SOL_MINT]: 'sol',
  'DWvrXGqTYq1SW9ey857z1nXBxSxihwxdFyQfaRunsAXa': 'usdc',
  'EwtK6Bydxsm4vAvvMiEG3ymtkJ7WToRpQdeV45wB1Qpa': 'yesa',
  'GykHjnHqwNsFmyY2wFT1drprpm1SZWR69CKPMUSFZBvH': 'yesa',
};

const MAINNET_TOKEN_TO_MINT: Record<string, string> = {
  sol: SOL_MINT,
  usdc: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  yesa: 'USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB',
};
const DEVNET_TOKEN_TO_MINT: Record<string, string> = {
  sol: SOL_MINT,
  usdc: 'DWvrXGqTYq1SW9ey857z1nXBxSxihwxdFyQfaRunsAXa',
  yesa: 'EwtK6Bydxsm4vAvvMiEG3ymtkJ7WToRpQdeV45wB1Qpa',
};

const MINT_TO_TOKEN = config.isDevnet ? DEVNET_MINT_TO_TOKEN : MAINNET_MINT_TO_TOKEN;
const TOKEN_TO_MINT = config.isDevnet ? DEVNET_TOKEN_TO_MINT : MAINNET_TOKEN_TO_MINT;

function processLogLines(
  logLines: string[],
  transactionSignature: string
): Array<{
  token: string;
  commitment_index: number;
  commitment: string;
  encrypted_output: string;
  mint_address: string | null;
  transaction_signature: string;
}> {
  const rows: Array<{
    token: string;
    commitment_index: number;
    commitment: string;
    encrypted_output: string;
    mint_address: string | null;
    transaction_signature: string;
  }> = [];

  for (const log of logLines) {
    if (!log.includes('Program data:')) continue;
    const parts = log.split('Program data: ');
    if (parts.length < 2) continue;
    const dataEncoded = parts[1].trim();
    let data: Buffer;
    try {
      data = Buffer.from(dataEncoded, 'base64');
    } catch {
      try {
        data = Buffer.from(dataEncoded, 'hex');
      } catch {
        continue;
      }
    }
    if (data.length < 8) continue;

    const disc = data.subarray(0, 8);
    let parsed: ReturnType<typeof parseCommitmentData> | ReturnType<typeof parseSplCommitmentData> = null;
    if (disc.equals(DISCRIMINATOR_COMMITMENT)) {
      parsed = parseCommitmentData(data);
    } else if (disc.equals(DISCRIMINATOR_SPL_COMMITMENT)) {
      parsed = parseSplCommitmentData(data);
    }
    if (!parsed) continue;

    const token = 'mintAddress' in parsed ? (MINT_TO_TOKEN[parsed.mintAddress as string] ?? 'sol') : 'sol';
    const mintAddress: string | null = TOKEN_TO_MINT[token] ?? SOL_MINT;
    rows.push({
      token,
      commitment_index: parsed.index,
      commitment: parsed.commitment,
      encrypted_output: parsed.encryptedOutput,
      mint_address: mintAddress,
      transaction_signature: transactionSignature,
    });
  }

  return rows;
}

async function indexLogs(logLines: string[], transactionSignature: string): Promise<void> {
  const rows = processLogLines(logLines, transactionSignature);
  if (rows.length === 0) return;

  try {
    const db = getDb();
    await db.from('commitments').upsert(rows, { onConflict: 'commitment', ignoreDuplicates: true });
  } catch (e) {
    console.error('Indexer insert error:', e);
  }
}

const CATCH_UP_LIMIT = 50;
const RESUBSCRIBE_DELAY_MS = 5000;

/**
 * Run a one-time catch-up: fetch recent signatures and index any commitments from their logs.
 * Use after startup to pick up txs that landed while the server was down.
 */
async function catchUpOnce(): Promise<void> {
  const connection = getConnection();
  try {
    const sigs = await connection.getSignaturesForAddress(config.programId, { limit: CATCH_UP_LIMIT });
    for (const sigInfo of sigs) {
      const tx = await connection.getParsedTransaction(sigInfo.signature, {
        maxSupportedTransactionVersion: 0,
      });
      if (tx?.meta?.logMessages?.length) {
        await indexLogs(tx.meta.logMessages, sigInfo.signature);
      }
    }
  } catch (e) {
    console.error('Indexer catch-up error:', e);
  }
}

/**
 * Start the indexer: optional catch-up, then subscribe to program logs via connection.onLogs().
 * Call this when the backend starts (e.g. after app.listen).
 */
export function startIndexer(): void {
  const connection = getConnection();

  console.log('Shade indexer: starting (logs subscription)...');

  catchUpOnce()
    .then(() => {
      console.log('Shade indexer: catch-up done, subscribing to program logs.');
    })
    .catch((e) => {
      console.error('Shade indexer: catch-up failed:', e);
    });

  const subscribe = (): void => {
    try {
      connection.onLogs(
        config.programId,
        (logs, _ctx) => {
          const signature = (logs as { signature?: string; logs?: string[] }).signature;
          if (logs.logs?.length && signature) {
            indexLogs(logs.logs, signature).catch((e) => {
              console.error('Indexer callback error:', e);
            });
          }
        },
        'confirmed'
      );
      console.log('Shade indexer: subscribed to program logs (confirmed).');
    } catch (e) {
      console.error('Shade indexer: subscribe error, resubscribing in', RESUBSCRIBE_DELAY_MS, 'ms:', e);
      setTimeout(subscribe, RESUBSCRIBE_DELAY_MS);
    }
  };

  subscribe();
}
