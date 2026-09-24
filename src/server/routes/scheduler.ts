import { Hono } from 'hono';
import { postLevelOfTheDay } from '../services/DailyService';

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
