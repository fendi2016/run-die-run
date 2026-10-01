import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { createServer, getServerPort } from '@devvit/web/server';
import { analytics } from './routes/analytics';
import { curse } from './routes/curse';
import { deaths } from './routes/deaths';
import { discovery } from './routes/discovery';
import { follow } from './routes/follow';
import { leaderboard } from './routes/leaderboard';
import { levels } from './routes/levels';
import { forms, menu } from './routes/menu';
import { publish } from './routes/publish';
import { runs } from './routes/runs';
import { scheduler } from './routes/scheduler';
import { triggers } from './routes/triggers';
import { userStats } from './routes/userStats';
import { myCurses } from './routes/myCurses';
import { tutorial } from './routes/tutorial';

const app = new Hono();
const internal = new Hono();

internal.route('/menu', menu);
internal.route('/form', forms);
internal.route('/triggers', triggers);
internal.route('/scheduler', scheduler);

app.route('/internal', internal);
app.route('/api/runs', runs);
app.route('/api/levels', levels);
app.route('/api/publish', publish);
app.route('/api/curse', curse);
app.route('/api/deaths', deaths);
app.route('/api/discovery', discovery);
app.route('/api/follow', follow);
app.route('/api/leaderboard', leaderboard);
app.route('/api/stats', userStats);
app.route('/api/me/curses', myCurses);
app.route('/api/tutorial', tutorial);
app.route('/api/analytics', analytics);

serve({
  fetch: app.fetch,
  createServer,
  port: getServerPort(),
});
