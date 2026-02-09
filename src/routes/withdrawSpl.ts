import { Router } from 'express';
import {
  PublicKey,
  TransactionInstruction,
  VersionedTransaction,
  TransactionMessage,
  ComputeBudgetProgram,
} from '@solana/web3.js';
import { getConnection, getRelayerKeypair } from '../solana/connection.js';
import { config } from '../config/env.js';
import { isValidBase64, isValidSolanaAddress } from '../lib/validators.js';

const router = Router();
/** Solana serialized transaction size limit (bytes). Exceeding causes SendTransactionError. */
const MAX_TX_SIZE_RAW = 1232;

interface WithdrawSplRequestBody {
  signedTransaction?: string;
  serializedProof?: string;
  treeAccount?: string;
  nullifier0PDA?: string;
  nullifier1PDA?: string;
  nullifier2PDA?: string;
  nullifier3PDA?: string;
  globalConfigAccount?: string;
  recipient?: string;
  recipientAta?: string;
  treeAta?: string;
  feeRecipientTokenAccount?: string;
  mintAddress?: string;
  signerTokenAccount?: string;
  lookupTableAddress?: string;
  senderAddress?: string;
}

async function buildWithdrawSplInstruction(params: WithdrawSplRequestBody): Promise<TransactionInstruction> {
  const {
    serializedProof,
    treeAccount,
    nullifier0PDA,
    nullifier1PDA,
    nullifier2PDA,
    nullifier3PDA,
    globalConfigAccount,
    recipient,
    recipientAta,
    treeAta,
    feeRecipientTokenAccount,
    mintAddress,
    senderAddress,
  } = params;

  if (
    !serializedProof ||
    !treeAccount ||
    !nullifier0PDA ||
    !nullifier1PDA ||
    !nullifier2PDA ||
    !nullifier3PDA ||
    !globalConfigAccount ||
    !recipient ||
    !recipientAta ||
    !treeAta ||
    !feeRecipientTokenAccount ||
    !mintAddress ||
    !senderAddress
  ) {
    throw new Error('Missing required withdraw SPL parameters');
  }

  const { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } = await import(
    '@solana/spl-token'
  );
  const mint = new PublicKey(mintAddress);
  const signerPubkey = new PublicKey(senderAddress);
  const signerTokenAccount = params.signerTokenAccount
    ? new PublicKey(params.signerTokenAccount)
    : getAssociatedTokenAddressSync(mint, signerPubkey);

  const instructionData = Buffer.from(serializedProof, 'base64');

  return new TransactionInstruction({
    programId: config.programId,
    keys: [
      { pubkey: new PublicKey(treeAccount), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(nullifier0PDA), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(nullifier1PDA), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(nullifier2PDA), isSigner: false, isWritable: false },
      { pubkey: new PublicKey(nullifier3PDA), isSigner: false, isWritable: false },
      { pubkey: new PublicKey(globalConfigAccount), isSigner: false, isWritable: false },
      { pubkey: signerPubkey, isSigner: true, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: signerTokenAccount, isSigner: false, isWritable: true },
      { pubkey: new PublicKey(recipient), isSigner: false, isWritable: false },
      { pubkey: new PublicKey(recipientAta), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(treeAta), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(feeRecipientTokenAccount), isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: new PublicKey('11111111111111111111111111111111'), isSigner: false, isWritable: false },
    ],
    data: instructionData,
  });
}

function validateWithdrawSplBuildParams(body: WithdrawSplRequestBody): string | null {
  const required = [
    body.serializedProof,
    body.treeAccount,
    body.nullifier0PDA,
    body.nullifier1PDA,
    body.nullifier2PDA,
    body.nullifier3PDA,
    body.globalConfigAccount,
    body.recipient,
    body.recipientAta,
    body.treeAta,
    body.feeRecipientTokenAccount,
    body.mintAddress,
    body.senderAddress,
  ];
  if (required.some((r) => !r || typeof r !== 'string')) return 'Missing required parameters';
  const addrs = [
    body.treeAccount!,
    body.nullifier0PDA!,
    body.nullifier1PDA!,
    body.nullifier2PDA!,
    body.nullifier3PDA!,
    body.globalConfigAccount!,
    body.recipient!,
    body.recipientAta!,
    body.treeAta!,
    body.feeRecipientTokenAccount!,
    body.mintAddress!,
    body.senderAddress!,
  ];
  if (addrs.some((a) => !isValidSolanaAddress(a))) return 'Invalid address';
  if (body.signerTokenAccount && !isValidSolanaAddress(body.signerTokenAccount)) return 'Invalid address';
  if (!isValidBase64(body.serializedProof!, 64 * 1024)) return 'Invalid proof';
  if (body.lookupTableAddress && !isValidSolanaAddress(body.lookupTableAddress)) return 'Invalid lookup table address';
  return null;
}

router.post('/', async (req, res) => {
  try {
    const body = req.body as WithdrawSplRequestBody;

    if (body.signedTransaction) {
      if (!isValidBase64(body.signedTransaction, MAX_TX_SIZE_RAW)) {
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

    const err = validateWithdrawSplBuildParams(body);
    if (err) return res.status(400).json({ error: err });

    const connection = getConnection();
    const instructionData = Buffer.from(body.serializedProof!, 'base64');
    const computeIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 });
    const withdrawIx = await buildWithdrawSplInstruction(body);

    // Ensure recipient ATA exists (program expects AccountNotInitialized otherwise). Only add create instruction when needed to stay under tx size limit.
    const {
      getAssociatedTokenAddressSync,
      createAssociatedTokenAccountIdempotentInstruction,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    } = await import('@solana/spl-token');
    const mint = new PublicKey(body.mintAddress!);
    const recipient = new PublicKey(body.recipient!);
    const recipientAta = new PublicKey(body.recipientAta!);
    const payer = new PublicKey(body.senderAddress!);
    const derivedRecipientAta = getAssociatedTokenAddressSync(mint, recipient);
    if (!derivedRecipientAta.equals(recipientAta)) {
      return res.status(400).json({ error: 'recipientAta does not match recipient and mint' });
    }
    const recipientAtaInfo = await connection.getAccountInfo(recipientAta);
    const createRecipientAtaIx = createAssociatedTokenAccountIdempotentInstruction(
      payer,
      recipientAta,
      recipient,
      mint,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    const instructions =
      recipientAtaInfo == null
        ? [computeIx, createRecipientAtaIx, withdrawIx]
        : [computeIx, withdrawIx];

    // Address Lookup Table (ALT) is required to stay under 1232 bytes: without it, 15 accounts
    // are encoded as 32 bytes each (~480 bytes) instead of 1-byte indices (~15 bytes).
    const requestedAltAddress = new PublicKey(body.lookupTableAddress ?? config.altAddress);
    let lookupTableAccount = await connection.getAddressLookupTable(requestedAltAddress);
    if (!lookupTableAccount.value) {
      // Token-specific ALT (e.g. USDC) may not exist or may be deactivated; fall back to default ALT.
      console.warn(
        `Withdraw SPL: lookup table ${requestedAltAddress.toBase58()} not found or deactivated, falling back to default ALT`
      );
      lookupTableAccount = await connection.getAddressLookupTable(config.altAddress);
    }
    const usedAlt = lookupTableAccount.value ? (requestedAltAddress.equals(config.altAddress) ? 'default' : 'requested') : 'none';

    const { blockhash } = await connection.getLatestBlockhash('confirmed');
    const messageV0 = new TransactionMessage({
      payerKey: new PublicKey(body.senderAddress!),
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message(
      lookupTableAccount.value ? [lookupTableAccount.value] : []
    );

    const transaction = new VersionedTransaction(messageV0);
    const serialized = transaction.serialize();
    const txSize = serialized.length;

    console.log(
      `Withdraw SPL: instructionData=${instructionData.length} bytes, serialized tx=${txSize} bytes, ALT=${usedAlt}`
    );

    if (txSize > MAX_TX_SIZE_RAW) {
      return res.status(400).json({
        error:
          `Transaction too large: ${txSize} bytes (Solana limit: ${MAX_TX_SIZE_RAW} bytes). ` +
          (usedAlt === 'none'
            ? 'No valid Address Lookup Table (ALT) was available; ensure ALT_ADDRESS (and token-specific ALT if used) exist on-chain and are not deactivated.'
            : 'Try a smaller withdrawal amount or ensure the ALT includes all accounts used by the SPL withdraw instruction.'),
      });
    }

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

    res.json({ transaction: Buffer.from(serialized).toString('base64') });
  } catch (error: unknown) {
    console.error('Withdraw SPL error:', error);
    const message =
      error && typeof error === 'object' && 'transactionMessage' in error
        ? String((error as { transactionMessage?: string }).transactionMessage)
        : error instanceof Error
          ? error.message
          : 'Failed to process withdraw';
    res.status(500).json({ error: message });
  }
});

export default router;
