import { Router } from 'express';
import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  VersionedTransaction,
  TransactionMessage,
  ComputeBudgetProgram,
} from '@solana/web3.js';
import { getConnection, getRelayerKeypair } from '../solana/connection.js';
import { config } from '../config/env.js';
import { isValidBase64, isValidSolanaAddress } from '../lib/validators.js';

const router = Router();

/** Return relayer public key so the frontend can use it as senderAddress for withdraw-by-note (no wallet). */
router.get('/relayer-address', (_req, res) => {
  const keypair = getRelayerKeypair();
  if (!keypair) {
    return res.status(503).json({ error: 'Relayer keypair not configured' });
  }
  res.json({ relayerAddress: keypair.publicKey.toBase58() });
});
const MAX_TX_SIZE = 1232;

interface WithdrawRequestBody {
  signedTransaction?: string;
  serializedProof?: string;
  treeAccount?: string;
  nullifier0PDA?: string;
  nullifier1PDA?: string;
  nullifier2PDA?: string;
  nullifier3PDA?: string;
  treeTokenAccount?: string;
  globalConfigAccount?: string;
  recipient?: string;
  feeRecipientAccount?: string;
  encryptedOutput1?: string;
  encryptedOutput2?: string;
  lookupTableAddress?: string;
  senderAddress?: string;
}

function buildWithdrawInstruction(params: WithdrawRequestBody): TransactionInstruction {
  const {
    serializedProof,
    treeAccount,
    nullifier0PDA,
    nullifier1PDA,
    nullifier2PDA,
    nullifier3PDA,
    treeTokenAccount,
    globalConfigAccount,
    recipient,
    feeRecipientAccount,
    senderAddress,
  } = params;

  if (
    !serializedProof ||
    !treeAccount ||
    !nullifier0PDA ||
    !nullifier1PDA ||
    !nullifier2PDA ||
    !nullifier3PDA ||
    !treeTokenAccount ||
    !globalConfigAccount ||
    !recipient ||
    !feeRecipientAccount ||
    !senderAddress
  ) {
    throw new Error('Missing required withdraw parameters');
  }

  const instructionData = Buffer.from(serializedProof, 'base64');

  return new TransactionInstruction({
    programId: config.programId,
    keys: [
      { pubkey: new PublicKey(treeAccount), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(nullifier0PDA), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(nullifier1PDA), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(nullifier2PDA), isSigner: false, isWritable: false },
      { pubkey: new PublicKey(nullifier3PDA), isSigner: false, isWritable: false },
      { pubkey: new PublicKey(treeTokenAccount), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(globalConfigAccount), isSigner: false, isWritable: false },
      { pubkey: new PublicKey(recipient), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(feeRecipientAccount), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(senderAddress), isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: instructionData,
  });
}

function validateWithdrawBuildParams(body: WithdrawRequestBody): string | null {
  const required = [
    body.serializedProof,
    body.treeAccount,
    body.nullifier0PDA,
    body.nullifier1PDA,
    body.nullifier2PDA,
    body.nullifier3PDA,
    body.treeTokenAccount,
    body.globalConfigAccount,
    body.recipient,
    body.feeRecipientAccount,
    body.senderAddress,
  ];
  if (required.some((r) => !r || typeof r !== 'string')) return 'Missing required parameters';
  const addrs = [
    body.treeAccount!,
    body.nullifier0PDA!,
    body.nullifier1PDA!,
    body.nullifier2PDA!,
    body.nullifier3PDA!,
    body.treeTokenAccount!,
    body.globalConfigAccount!,
    body.recipient!,
    body.feeRecipientAccount!,
    body.senderAddress!,
  ];
  if (addrs.some((a) => !isValidSolanaAddress(a))) return 'Invalid address';
  if (!isValidBase64(body.serializedProof!, 64 * 1024)) return 'Invalid proof';
  if (body.lookupTableAddress && !isValidSolanaAddress(body.lookupTableAddress)) return 'Invalid lookup table address';
  return null;
}

/** Withdraw using only the note – no wallet sign. Relayer decrypts (when supported), builds and submits. */
interface WithdrawByNoteBody {
  noteContent?: string;
  recipient?: string;
  token?: string;
  amount?: number;
}

router.post('/by-note', async (req, res) => {
  try {
    const body = req.body as WithdrawByNoteBody;
    if (!body.noteContent || typeof body.noteContent !== 'string' || body.noteContent.trim().length === 0) {
      return res.status(400).json({ error: 'Missing or invalid noteContent' });
    }
    if (!body.recipient || !isValidSolanaAddress(body.recipient)) {
      return res.status(400).json({ error: 'Missing or invalid recipient' });
    }
    const token = typeof body.token === 'string' ? body.token.toUpperCase() : '';
    if (!['SOL', 'USDC', 'YESA'].includes(token)) {
      return res.status(400).json({ error: 'Invalid token; use SOL, USDC, or YESA' });
    }
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }
    // Relayer cannot decrypt wallet-encrypted notes without user key. Return 501 until password-based or relayer-decrypt flow exists.
    return res.status(501).json({
      error: 'Withdraw by note is not yet supported by this relayer. Notes are encrypted with your wallet; use Connect Wallet to withdraw.',
    });
  } catch (err: unknown) {
    console.error('Withdraw by-note error:', err);
    return res.status(500).json({ error: 'Failed to process withdraw by note' });
  }
});

router.post('/', async (req, res) => {
  try {
    const body = req.body as WithdrawRequestBody;

    if (body.signedTransaction) {
      if (!isValidBase64(body.signedTransaction, MAX_TX_SIZE)) {
        return res.status(400).json({ error: 'Invalid transaction' });
      }
      const connection = getConnection();
      const txBuffer = Buffer.from(body.signedTransaction, 'base64');
      const transaction = VersionedTransaction.deserialize(txBuffer);

      const signature = await connection.sendTransaction(transaction, {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
        maxRetries: 3,
      });

      return res.json({ signature, success: true });
    }

    const err = validateWithdrawBuildParams(body);
    if (err) return res.status(400).json({ error: err });

    const connection = getConnection();
    const lookupTableAddress = new PublicKey(body.lookupTableAddress ?? config.altAddress);
    const lookupTableAccount = await connection.getAddressLookupTable(lookupTableAddress);

    const computeIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 });
    const withdrawIx = buildWithdrawInstruction(body);

    const { blockhash } = await connection.getLatestBlockhash('confirmed');
    const messageV0 = new TransactionMessage({
      payerKey: new PublicKey(body.senderAddress!),
      recentBlockhash: blockhash,
      instructions: [computeIx, withdrawIx],
    }).compileToV0Message(
      lookupTableAccount.value ? [lookupTableAccount.value] : []
    );

    const transaction = new VersionedTransaction(messageV0);

    const relayerKeypair = getRelayerKeypair();
    if (relayerKeypair && body.senderAddress === relayerKeypair.publicKey.toBase58()) {
      transaction.sign([relayerKeypair]);
      const signature = await connection.sendTransaction(transaction, {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
        maxRetries: 3,
      });
      return res.json({ signature, success: true });
    }

    const serialized = transaction.serialize();
    res.json({ transaction: Buffer.from(serialized).toString('base64') });
  } catch (error: unknown) {
    console.error('Withdraw error:', error);
    res.status(500).json({ error: 'Failed to process withdraw' });
  }
});

export default router;
