import { PublicKey } from '@solana/web3.js';
import { getConnection } from './connection.js';
import { config } from '../config/env.js';
const MERKLE_TREE_SEED = Buffer.from('merkle_tree');
const GLOBAL_CONFIG_SEED = Buffer.from('global_config');
const SOL_MINT = new PublicKey('11111111111111111111111111111111');

interface GlobalConfigLayout {
  authority: Uint8Array;
  depositFeeRate: number;
  withdrawalFeeRate: number;
  feeErrorMargin: number;
  bump: number;
}

interface MerkleTreeAccountLayout {
  authority: Uint8Array;
  nextIndex: bigint;
  root: Uint8Array;
  rootIndex: bigint;
  maxDepositAmount: bigint;
  height: number;
  rootHistorySize: number;
  bump: number;
}

export function getTreeAccountPDA(mint?: PublicKey): PublicKey {
  const seeds = mint
    ? [MERKLE_TREE_SEED, mint.toBuffer()]
    : [MERKLE_TREE_SEED];
  const [pda] = PublicKey.findProgramAddressSync(seeds, config.programId);
  return pda;
}

export function getGlobalConfigPDA(): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync([GLOBAL_CONFIG_SEED], config.programId);
  return pda;
}

export async function fetchGlobalConfig(): Promise<{
  depositFeeRate: number;
  withdrawalFeeRate: number;
  feeErrorMargin: number;
}> {
  const connection = getConnection();
  const globalConfigPDA = getGlobalConfigPDA();
  const accountInfo = await connection.getAccountInfo(globalConfigPDA);
  if (!accountInfo?.data) {
    throw new Error('Global config account not found');
  }
  const data = accountInfo.data;
  if (data.length < 8 + 32 + 2 + 2 + 2 + 1) {
    throw new Error('Invalid global config data');
  }
  const depositFeeRate = data.readUInt16LE(8 + 32);
  const withdrawalFeeRate = data.readUInt16LE(8 + 32 + 2);
  const feeErrorMargin = data.readUInt16LE(8 + 32 + 4);
  return { depositFeeRate, withdrawalFeeRate, feeErrorMargin };
}

/**
 * Merkle tree account layout (Shade program lib.rs MerkleTreeAccount, #[account(zero_copy)]).
 * Anchor writes 8-byte discriminator then the struct (space = 8 + size_of::<MerkleTreeAccount>()).
 * We read root from root_history[root_index] so we return the exact 32 bytes the program compares in is_known_root().
 */
const TREE_DISCRIMINATOR = 8;
const TREE_AUTHORITY_LEN = 32;
const TREE_NEXT_INDEX_LEN = 8;
const TREE_SUBTREES_LEN = 26 * 32; // 832
const TREE_ROOT_LEN = 32;
const TREE_ROOT_HISTORY_LEN = 100 * 32; // 3200

// With 8-byte discriminator: authority at 8, next_index at 40, subtrees at 48, root at 880, root_history at 912, root_index at 4112
const TREE_NEXT_INDEX_OFF = TREE_DISCRIMINATOR + TREE_AUTHORITY_LEN; // 40
const TREE_SUBTREES_OFF = TREE_NEXT_INDEX_OFF + TREE_NEXT_INDEX_LEN; // 48
const TREE_ROOT_OFF = TREE_SUBTREES_OFF + TREE_SUBTREES_LEN; // 880
const TREE_ROOT_HISTORY_OFF = TREE_ROOT_OFF + TREE_ROOT_LEN; // 912
const TREE_ROOT_INDEX_OFF = TREE_ROOT_HISTORY_OFF + TREE_ROOT_HISTORY_LEN; // 4112

/** Convert 32-byte root to decimal. Chain stores same BE order as instruction (leInt2Buff then reverse in prover). */
function bytes32ToDecimalString(buf: Buffer): string {
  return BigInt('0x' + Buffer.from(buf).toString('hex')).toString(10);
}

export type MerkleTreeState = {
  root: string;
  nextIndex: number;
  subtrees: string[];
};

/** Returns null when the tree account does not exist (e.g. SPL tree never initialized). */
export async function fetchMerkleTreeState(mint?: PublicKey): Promise<MerkleTreeState | null> {
  const connection = getConnection();
  const treePDA = getTreeAccountPDA(mint);
  const accountInfo = await connection.getAccountInfo(treePDA);
  if (!accountInfo?.data) {
    return null;
  }
  const data = accountInfo.data;

  if (data.length < TREE_ROOT_INDEX_OFF + 8) {
    throw new Error('Merkle tree account too small');
  }

  const nextIndex = Number(data.readBigUInt64LE(TREE_NEXT_INDEX_OFF));
  const rootIndex = Number(data.readBigUInt64LE(TREE_ROOT_INDEX_OFF)) % 100;

  // Return root from root_history[root_index] — exactly what the program checks in is_known_root()
  const rootHistoryOff = TREE_ROOT_HISTORY_OFF + rootIndex * 32;
  const rootBytes = Buffer.from(data.slice(rootHistoryOff, rootHistoryOff + 32));
  const rootStr = bytes32ToDecimalString(rootBytes);

  const subtrees: string[] = [];
  for (let i = 0; i < 26; i++) {
    const off = TREE_SUBTREES_OFF + i * 32;
    const subBytes = Buffer.from(data.slice(off, off + 32));
    subtrees.push(bytes32ToDecimalString(subBytes));
  }
  return { root: rootStr, nextIndex, subtrees };
}
