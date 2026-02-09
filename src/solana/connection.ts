import { Connection, Keypair } from '@solana/web3.js';
import { config } from '../config/env.js';
import { readFileSync, existsSync } from 'fs';

let connection: Connection | null = null;
let relayerKeypair: Keypair | null = null;

export function getConnection(): Connection {
  if (!connection) {
    connection = new Connection(config.rpcUrl);
  }
  return connection;
}

export function getRelayerKeypair(): Keypair | null {
  if (!relayerKeypair && existsSync(config.relayerKeypairPath)) {
    const keypairData = JSON.parse(readFileSync(config.relayerKeypairPath, 'utf-8'));
    relayerKeypair = Keypair.fromSecretKey(Uint8Array.from(keypairData));
  }
  return relayerKeypair;
}
