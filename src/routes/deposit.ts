import { Router } from 'express';
import { VersionedTransaction } from '@solana/web3.js';
import { getConnection } from '../solana/connection.js';
import { isValidBase64, isValidSolanaAddress } from '../lib/validators.js';

const router = Router();
const MAX_TX_SIZE = 1232; // Solana max serialized tx size

interface DepositRequestBody {
  signedTransaction?: string;
  senderAddress?: string;
  referralWalletAddress?: string;
}

router.post('/', async (req, res) => {
  try {
    const { signedTransaction, senderAddress } = req.body as DepositRequestBody;
    if (!signedTransaction || !senderAddress) {
      return res.status(400).json({ error: 'signedTransaction and senderAddress are required' });
    }

    if (!isValidBase64(signedTransaction, MAX_TX_SIZE)) {
      return res.status(400).json({ error: 'Invalid transaction' });
    }
    if (!isValidSolanaAddress(senderAddress)) {
      return res.status(400).json({ error: 'Invalid sender address' });
    }

    const connection = getConnection();
    const txBuffer = Buffer.from(signedTransaction, 'base64');
    const transaction = VersionedTransaction.deserialize(txBuffer);

    const signature = await connection.sendTransaction(transaction, {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
      maxRetries: 3,
    });

    res.json({ signature, success: true });
  } catch (error: unknown) {
    console.error('Deposit relay error:', error);
    const err = error as { transactionMessage?: string; message?: string; transactionLogs?: string[] };
    const message = err.transactionMessage ?? err.message ?? 'Failed to relay deposit';
    res.status(500).json({ error: String(message) });
  }
});

export default router;
