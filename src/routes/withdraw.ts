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

/** Relayer public key for note-based withdraw: client sends build params with senderAddress = relayer; API signs and submits. */
router.get('/relayer-address', (_req, res) => {
  const keypair = getRelayerKeypair();
  if (!keypair) {
    return res.status(503).json({ error: 'Relayer keypair not configured' });
  }
  res.json({ relayerAddress: keypair.publicKey.toBase58() });
});

interface WithdrawRequestBody {
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
}

function buildWithdrawInstruction(
  params: WithdrawRequestBody,
  signerPubkey: PublicKey
): TransactionInstruction {
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
    !feeRecipientAccount
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
      { pubkey: signerPubkey, isSigner: true, isWritable: true },
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
  ];
  if (addrs.some((a) => !isValidSolanaAddress(a))) return 'Invalid address';
  if (!isValidBase64(body.serializedProof!, 64 * 1024)) return 'Invalid proof';
  if (body.lookupTableAddress && !isValidSolanaAddress(body.lookupTableAddress)) return 'Invalid lookup table address';
  return null;
}

router.post('/', async (req, res) => {
  try {
    if (typeof req.body !== 'object' || req.body === null || Array.isArray(req.body)) {
      return res.status(400).json({ error: 'Invalid request body' });
    }
    const body = req.body as WithdrawRequestBody;

    const err = validateWithdrawBuildParams(body);
    if (err) return res.status(400).json({ error: err });

    const relayerKeypair = getRelayerKeypair();
    if (!relayerKeypair) {
      return res.status(503).json({ error: 'Relayer not configured. SOL withdraw requires relayer as signer.' });
    }

    const connection = getConnection();
    const lookupTableAddress = new PublicKey(body.lookupTableAddress ?? config.altAddress);
    const lookupTableAccount = await connection.getAddressLookupTable(lookupTableAddress);

    const computeIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 });
    const withdrawIx = buildWithdrawInstruction(body, relayerKeypair.publicKey);

    const { blockhash } = await connection.getLatestBlockhash('confirmed');
    const messageV0 = new TransactionMessage({
      payerKey: relayerKeypair.publicKey,
      recentBlockhash: blockhash,
      instructions: [computeIx, withdrawIx],
    }).compileToV0Message(
      lookupTableAccount.value ? [lookupTableAccount.value] : []
    );

    const transaction = new VersionedTransaction(messageV0);

    const MIN_RELAYER_LAMPORTS = 10_000_000; // 0.01 SOL
    const relayerBalance = await connection.getBalance(relayerKeypair.publicKey);
    if (relayerBalance < MIN_RELAYER_LAMPORTS) {
      return res.status(503).json({
        error: 'Relayer has insufficient SOL to pay transaction fees. Fund the relayer wallet with at least 0.01 SOL.',
        relayerAddress: relayerKeypair.publicKey.toBase58(),
      });
    }

    transaction.sign([relayerKeypair]);
    const signature = await connection.sendTransaction(transaction, {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
      maxRetries: 3,
    });
    return res.json({ signature, success: true });
  } catch (error: unknown) {
    console.error('Withdraw error:', error);
    const err = error as { message?: string; transactionMessage?: string };
    const msg = err.transactionMessage ?? err.message ?? '';
    if (msg.includes('insufficient funds for rent')) {
      return res.status(503).json({
        error: 'Relayer has insufficient SOL for transaction fees and rent. Fund the relayer wallet (see server logs for address).',
      });
    }
    res.status(500).json({ error: 'Failed to process withdraw' });
  }
});

export default router;
