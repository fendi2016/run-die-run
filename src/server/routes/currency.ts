import { Hono } from 'hono';
import { context, redis } from '@devvit/web/server';
import type { CurrencyBalanceResponse } from '../../shared/currencyApi';
import { currencyKey } from '../core/redisKeys';

type ErrorResponse = {
  status: 'error';
  message: string;
};

export const currency = new Hono();

// Read-only balance lookup — the only writer is runs.ts's finish handler
// (spec: earn-only for now, no shop to spend it in yet).
currency.get('/', async (c) => {
  const { username } = context;
  if (!username) {
    return c.json<ErrorResponse>(
      { status: 'error', message: 'Must be signed in to view a balance' },
      401
    );
  }
  const raw = await redis.get(currencyKey(username));
  return c.json<CurrencyBalanceResponse>({ balance: Number(raw ?? 0) });
});
