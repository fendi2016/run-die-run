import { Hono } from 'hono';
import { postLevelOfTheDay } from '../services/DailyService';
import { expireOldTraps } from '../services/UndoService';

export const scheduler = new Hono();

// devvit.json `scheduler.tasks.daily-level` (cron).
scheduler.post('/daily-level', async (c) => {
  try {
    const result = await postLevelOfTheDay(false);
    console.log(`Level of the Day: ${JSON.stringify(result)}`);
    return c.json({ status: 'ok' }, 200);
  } catch (error) {
    console.error(`Level of the Day failed: ${error}`);
    return c.json({ status: 'error' }, 500);
  }
});

// devvit.json `scheduler.tasks.expire-traps` (hourly): player traps leave a
// level after PLAYER_TRAP_LIFETIME_MS (see UndoService.expireOldTraps).
scheduler.post('/expire-traps', async (c) => {
  try {
    const result = await expireOldTraps();
    console.log(`Expired traps: ${JSON.stringify(result)}`);
    return c.json({ status: 'ok' }, 200);
  } catch (error) {
    console.error(`Expiring traps failed: ${error}`);
    return c.json({ status: 'error' }, 500);
  }
});
