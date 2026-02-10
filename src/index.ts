import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import configRouter from './routes/config.js';
import merkleRouter from './routes/merkle.js';
import utxosRouter from './routes/utxos.js';
import depositRouter from './routes/deposit.js';
import depositSplRouter from './routes/depositSpl.js';
import withdrawRouter from './routes/withdraw.js';
import withdrawSplRouter from './routes/withdrawSpl.js';
import { config, validateConfig } from './config/env.js';
import { generalLimiter, relayLimiter, safeErrorHandler } from './middleware/security.js';
import { getDb } from './db/index.js';
import { startIndexer } from './indexer/index.js';

validateConfig();

const app = express();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(
  cors({
    origin: config.corsOrigins === '*' ? true : config.corsOrigins,
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type'],
  })
);
app.use(express.json({ limit: '512kb' }));

app.use(generalLimiter);

app.use('/config', configRouter);
app.use('/merkle', merkleRouter);
app.use('/utxos', utxosRouter);
app.use('/deposit', relayLimiter, depositRouter);
app.use('/deposit/spl', relayLimiter, depositSplRouter);
app.use('/withdraw', relayLimiter, withdrawRouter);
app.use('/withdraw/spl', relayLimiter, withdrawSplRouter);

app.get('/health', async (_req, res) => {
  const timestamp = new Date().toISOString();
  let database: 'ok' | 'error' = 'ok';
  let errorMessage: string | undefined;
  try {
    const db = getDb();
    await db.from('commitments').select('id').limit(1);
  } catch (err) {
    database = 'error';
    errorMessage = err instanceof Error ? err.message : 'Connection failed';
    console.error('Database connection error:', err);
    return res.status(503).json({
      status: 'degraded',
      timestamp,
      database,
      error: errorMessage,
    });
  }
  res.json({ status: 'ok', timestamp, database });
});

app.use(safeErrorHandler);

app.listen(config.port, () => {
  console.log(`Shade API running at http://localhost:${config.port}`);
  console.log('Endpoints:');
  console.log('  GET  /health       (includes DB connection check)');
  console.log('  GET  /config');
  console.log('  GET  /merkle/root');
  console.log('  GET  /merkle/path?token=&leafIndex=');
  console.log('  GET  /merkle/proof/:commitment');
  console.log('  GET  /utxos/range');
  console.log('  GET  /utxos/check/:encryptedOutput');
  console.log('  POST /utxos/indices');
  console.log('  POST /deposit');
  console.log('  POST /deposit/spl');
  console.log('  GET  /withdraw/relayer-address');
  console.log('  POST /withdraw');
  console.log('  POST /withdraw/spl');
  startIndexer();
});
