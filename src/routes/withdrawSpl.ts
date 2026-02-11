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
  lookupTableAddress?: string;
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
    !mintAddress
  ) {
    throw new Error('Missing required withdraw SPL parameters');
  }

  const relayerKeypair = getRelayerKeypair();
  if (!relayerKeypair) {
    throw new Error('Relayer not configured; cannot build SPL withdraw instruction');
  }
  const { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } = await import(
    '@solana/spl-token'
  );
  const mint = new PublicKey(mintAddress);
  const signerPubkey = relayerKeypair.publicKey;
  const signerTokenAccount = getAssociatedTokenAddressSync(mint, signerPubkey);

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
    const body = req.body as WithdrawSplRequestBody;

    const err = validateWithdrawSplBuildParams(body);
    if (err) return res.status(400).json({ error: err });

    const connection = getConnection();
    const {
      getAssociatedTokenAddressSync,
      createAssociatedTokenAccountIdempotentInstruction,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    } = await import('@solana/spl-token');
    const mint = new PublicKey(body.mintAddress!);
    const recipient = new PublicKey(body.recipient!);
    const recipientAta = new PublicKey(body.recipientAta!);
    const derivedRecipientAta = getAssociatedTokenAddressSync(mint, recipient);
    if (!derivedRecipientAta.equals(recipientAta)) {
      return res.status(400).json({ error: 'recipientAta does not match recipient and mint' });
    }
    const relayerKeypair = getRelayerKeypair();
    if (!relayerKeypair) {
      return res.status(503).json({ error: 'Relayer not configured. SPL withdraw requires relayer as signer.' });
    }
    const payer = relayerKeypair.publicKey;
    const signerTokenAccount = getAssociatedTokenAddressSync(mint, payer);

    const instructionData = Buffer.from(body.serializedProof!, 'base64');
    const computeIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 });
    const withdrawIx = await buildWithdrawSplInstruction(body);

    // Ensure recipient ATA exists (program expects AccountNotInitialized otherwise). Only add create instruction when needed to stay under tx size limit.
    const recipientAtaInfo = await connection.getAccountInfo(recipientAta);
    const createRecipientAtaIx = createAssociatedTokenAccountIdempotentInstruction(
      payer,
      recipientAta,
      recipient,
      mint,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    const treeAta = new PublicKey(body.treeAta!);
    const feeRecipientAta = new PublicKey(body.feeRecipientTokenAccount!);

    // Validate token accounts so program does not fail with InvalidTokenAccount (0x1781)
    const tokenProgramId = TOKEN_PROGRAM_ID.toBase58();
    for (const { name, pubkey } of [
      { name: 'treeAta', pubkey: treeAta },
      { name: 'feeRecipientTokenAccount', pubkey: feeRecipientAta },
    ] as const) {
      const info = await connection.getAccountInfo(pubkey);
      if (!info) {
        return res.status(400).json({
          error: `${name} account does not exist at ${pubkey.toBase58()}. Ensure the pool is initialized for this mint (tree ATA = ATA(mint, treePDA)).`,
        });
      }
      if (info.owner.toBase58() !== tokenProgramId) {
        return res.status(400).json({
          error: `${name} is not an SPL token account (owner is ${info.owner.toBase58()}, expected ${tokenProgramId}). Check that treeAta = ATA(mint, treePDA) and feeRecipientTokenAccount = ATA(mint, feeRecipient).`,
        });
      }
    }

    const signerAtaInfo = await connection.getAccountInfo(signerTokenAccount);
    const createSignerAtaIx = createAssociatedTokenAccountIdempotentInstruction(
      payer,
      signerTokenAccount,
      payer,
      mint,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    const instructions = [
      computeIx,
      ...(recipientAtaInfo == null ? [createRecipientAtaIx] : []),
      ...(signerAtaInfo == null ? [createSignerAtaIx] : []),
      withdrawIx,
    ];

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
      payerKey: payer,
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

    const MIN_RELAYER_LAMPORTS = 10_000_000; // 0.01 SOL for tx fees and rent
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
    console.error('Withdraw SPL error:', error);
    const err = error as { message?: string; transactionMessage?: string };
    const msg = err.transactionMessage ?? err.message ?? '';
    if (msg.includes('insufficient funds for rent')) {
      return res.status(503).json({
        error: 'Relayer has insufficient SOL for transaction fees and rent. Fund the relayer wallet.',
      });
    }
    const message =
      err.transactionMessage ?? (error instanceof Error ? error.message : 'Failed to process withdraw');
    res.status(500).json({ error: message });
  }
});

export default router;
