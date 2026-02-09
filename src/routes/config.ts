import { Router } from 'express';
import { fetchGlobalConfig } from '../solana/contract.js';
import { config } from '../config/env.js';
import { createCache } from '../lib/cache.js';

const router = Router();

export interface ConfigResponse {
  withdraw_fee_rate: number;
  withdraw_rent_fee: number;
  deposit_fee_rate: number;
  usdc_withdraw_rent_fee: number;
  rent_fees: Record<string, number>;
}

const configCache = createCache<ConfigResponse>(config.configCacheTtlMs);

const TOKEN_RENT_FEES: Record<string, number> = {
  sol: 0.000005,
  usdc: 0.002,
  usdt: 0.002,
  yesa: 0.002,
  zec: 0.002,
  ore: 0.002,
  store: 0.002,
};

export async function getConfigResponse(): Promise<ConfigResponse> {
  const cached = configCache.get('global');
  if (cached) return cached;

  const { depositFeeRate, withdrawalFeeRate } = await fetchGlobalConfig();
  const withdrawFeeRate = withdrawalFeeRate / 10000;
  const depositFeeRateVal = depositFeeRate / 10000;

  const rentFees: Record<string, number> = {};
  for (const [token, fee] of Object.entries(TOKEN_RENT_FEES)) {
    rentFees[token] = fee;
  }

  const data = {
    withdraw_fee_rate: withdrawFeeRate,
    withdraw_rent_fee: TOKEN_RENT_FEES.sol,
    deposit_fee_rate: depositFeeRateVal,
    usdc_withdraw_rent_fee: TOKEN_RENT_FEES.usdc,
    rent_fees: rentFees,
  };
  configCache.set('global', data);
  return data;
}

router.get('/', async (_req, res) => {
  try {
    const configData = await getConfigResponse();
    res.json(configData);
  } catch (error) {
    console.error('Config error:', error);
    res.status(500).json({ error: 'Failed to fetch config' });
  }
});

export default router;
