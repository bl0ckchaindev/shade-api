import { Router } from 'express';
import { VersionedTransaction } from '@solana/web3.js';
import { getConnection } from '../solana/connection.js';
import { isValidBase64, isValidSolanaAddress } from '../lib/validators.js';
import { send } from 'process';

const router = Router();
const MAX_TX_SIZE = 1232;

interface DepositSplRequestBody {
  signedTransaction?: string;
  senderAddress?: string;
  mintAddress?: string;
  referralWalletAddress?: string;
}

router.post('/', async (req, res) => {
  try {
    if (typeof req.body !== 'object' || req.body === null || Array.isArray(req.body)) {
      return res.status(400).json({ error: 'Invalid request body' });
    }
    const { signedTransaction, senderAddress, mintAddress } = req.body as DepositSplRequestBody;
    if (!signedTransaction || !senderAddress || !mintAddress) {
      return res.status(400).json({ error: 'signedTransaction, senderAddress, and mintAddress are required' });
    }
    if (!isValidBase64(signedTransaction, MAX_TX_SIZE)) {
      return res.status(400).json({ error: 'Invalid transaction' });
    }
    if (!isValidSolanaAddress(senderAddress) || !isValidSolanaAddress(mintAddress)) {
      return res.status(400).json({ error: 'Invalid address' });
    }

    const connection = getConnection();
    const txBuffer = Buffer.from(signedTransaction, 'base64');
    const transaction = VersionedTransaction.deserialize(txBuffer);

    const signature = await connection.sendTransaction(transaction, {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
      maxRetries: 3,
    });

    return res.json({ signature, success: true });
  } catch (error: unknown) {
    console.error('Deposit SPL relay error:', error);
    return res.status(500).json({ error: 'Failed to relay deposit' });
  }
});

export default router;
