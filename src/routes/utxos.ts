import { Router, Request } from 'express';
import { getDb } from '../db/index.js';
import { sanitizeToken, clampInt, isValidEncryptedOutput } from '../lib/validators.js';

const router = Router();

const MAX_RANGE_SIZE = 1000;
const MAX_INDICES_BATCH = 500;

router.get(
  '/range',
  async (
    req: Request<object, object, object, { token?: string; start?: string; end?: string }>,
    res
  ) => {
    try {
      const token = sanitizeToken(req.query.token);
      const start = clampInt(req.query.start, 0, 0, Number.MAX_SAFE_INTEGER);
      const end = clampInt(req.query.end, 20000, start, start + MAX_RANGE_SIZE);

      const db = getDb();

      const [{ count: totalCount }, { data: rows }] = await Promise.all([
        db.from('commitments').select('*', { count: 'exact', head: true }).eq('token', token),
        db
          .from('commitments')
          .select('commitment_index, commitment, encrypted_output')
          .eq('token', token)
          .gte('commitment_index', start)
          .lt('commitment_index', end)
          .order('commitment_index', { ascending: true })
          .limit(MAX_RANGE_SIZE),
      ]);

      const total = totalCount ?? 0;
      const list = rows ?? [];

      res.json({
        encrypted_outputs: list.map((r) => r.encrypted_output),
        total,
        hasMore: list.length >= MAX_RANGE_SIZE || end < total,
        len: list.length,
        utxos: list.map((r) => ({
          index: r.commitment_index,
          commitment: r.commitment,
          encrypted_output: r.encrypted_output,
        })),
      });
    } catch (error) {
      console.error('UTXOs range error:', error);
      res.status(500).json({ error: 'Failed to fetch UTXOs' });
    }
  }
);

router.get('/check/:encryptedOutput', async (req: Request<{ encryptedOutput: string }, object, object, { token?: string }>, res) => {
  try {
    const { encryptedOutput } = req.params;
    const token = sanitizeToken(req.query.token);

    if (!isValidEncryptedOutput(encryptedOutput)) {
      return res.status(400).json({ error: 'Invalid encrypted output' });
    }

    const db = getDb();
    const { data: row } = await db
      .from('commitments')
      .select('id')
      .eq('encrypted_output', encryptedOutput)
      .eq('token', token)
      .maybeSingle();

    res.json({ exists: !!row });
  } catch (error) {
    console.error('UTXO check error:', error);
    res.status(500).json({ error: 'Failed to check UTXO' });
  }
});

router.post('/indices', async (req, res) => {
  try {
    const { encrypted_outputs, token: bodyToken } = req.body as { encrypted_outputs?: unknown; token?: unknown };
    if (!Array.isArray(encrypted_outputs)) {
      return res.status(400).json({ error: 'encrypted_outputs must be an array' });
    }
    if (encrypted_outputs.length > MAX_INDICES_BATCH) {
      return res.status(400).json({ error: `Maximum ${MAX_INDICES_BATCH} items per request` });
    }

    const valid = encrypted_outputs.filter((e): e is string => typeof e === 'string' && isValidEncryptedOutput(e));
    const invalidCount = encrypted_outputs.length - valid.length;
    if (invalidCount > 0) {
      return res.status(400).json({ error: `${invalidCount} invalid encrypted output(s)` });
    }

    const token = sanitizeToken(bodyToken);
    const db = getDb();

    let query = db
      .from('commitments')
      .select('encrypted_output, commitment_index')
      .eq('token', token)
      .in('encrypted_output', valid);

    const { data: rows } = await query;

    const byEnc = new Map<string, number>();
    for (const r of rows ?? []) {
      byEnc.set(r.encrypted_output, r.commitment_index);
    }

    const indices = valid.map((enc) => byEnc.get(enc) ?? -1);

    res.json({ indices });
  } catch (error) {
    console.error('UTXO indices error:', error);
    res.status(500).json({ error: 'Failed to fetch indices' });
  }
});

export default router;
