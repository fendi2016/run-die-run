import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { createServer, getServerPort } from '@devvit/web/server';
import { currency } from './routes/currency';
import { curse } from './routes/curse';
import { discovery } from './routes/discovery';
import { follow } from './routes/follow';
import { forms } from './routes/forms';
import { leaderboard } from './routes/leaderboard';
import { levels } from './routes/levels';
import { menu } from './routes/menu';
import { publish } from './routes/publish';
import { runs } from './routes/runs';
import { triggers } from './routes/triggers';

const app = new Hono();
const internal = new Hono();

internal.route('/menu', menu);
internal.route('/form', forms);
internal.route('/triggers', triggers);

app.route('/internal', internal);
app.route('/api/runs', runs);
app.route('/api/levels', levels);
app.route('/api/publish', publish);
app.route('/api/curse', curse);
app.route('/api/discovery', discovery);
app.route('/api/follow', follow);
app.route('/api/leaderboard', leaderboard);
app.route('/api/currency', currency);

serve({
  fetch: app.fetch,
  createServer,
  port: getServerPort(),
});
