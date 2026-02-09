/**
 * Security middleware: rate limiting, safe error handler
 */

import rateLimit from 'express-rate-limit';
import type { Request, Response, NextFunction } from 'express';

const RELAY_WINDOW_MS = 60 * 1000; // 1 min
const RELAY_MAX = 30; // deposit/withdraw relay per IP per min
const GENERAL_WINDOW_MS = 60 * 1000;
const GENERAL_MAX = 120; // general read/utility endpoints

export const relayLimiter = rateLimit({
  windowMs: RELAY_WINDOW_MS,
  max: RELAY_MAX,
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

export const generalLimiter = rateLimit({
  windowMs: GENERAL_WINDOW_MS,
  max: GENERAL_MAX,
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

/** Never leak internal error details to client */
export function safeErrorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
}
