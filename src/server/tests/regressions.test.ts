import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
import { AsyncLocalStorage } from 'node:async_hooks';
import { parseDraftObjectsJson, type DraftObject } from '../../shared/editorApi';

// A versioned in-memory store that aborts WATCH transactions when a competing
// write occurs. Commits are synchronous to model Redis's atomic EXEC.
const values = new Map<string, string>();
const scores = new Map<string, Map<string, number>>();
const hashes = new Map<string, Map<string, string>>();
const revisions = new Map<string, number>();
const users = new AsyncLocalStorage<string>();
let beforeExec: (() => Promise<void>) | undefined;
let activeTransactions = 0;
const bump = (key: string) => revisions.set(key, (revisions.get(key) ?? 0) + 1);
function set(key: string, value: string) {
  values.set(key, value);
  bump(key);
  return 'OK';
}
function zAdd(key: string, member: { member: string; score: number }) {
  const entries = scores.get(key) ?? new Map<string, number>();
  entries.set(member.member, member.score);
  scores.set(key, entries);
  bump(key);
  return 1;
}
function incrBy(key: string, increment: number) {
  const value = Number(values.get(key) ?? 0) + increment;
  set(key, String(value));
  return value;
}
function zIncrBy(key: string, member: string, increment: number) {
  const value = (scores.get(key)?.get(member) ?? 0) + increment;
  zAdd(key, { member, score: value });
  return value;
}
function hSet(key: string, fieldValues: Record<string, string>) {
  const fields = hashes.get(key) ?? new Map<string, string>();
  let added = 0;
  for (const [field, value] of Object.entries(fieldValues)) {
    if (!fields.has(field)) added++;
    fields.set(field, value);
  }
  hashes.set(key, fields);
  bump(key);
  return added;
}
function hIncrBy(key: string, field: string, increment: number) {
  const value = Number(hashes.get(key)?.get(field) ?? 0) + increment;
  hSet(key, { [field]: String(value) });
  return value;
}
function zRangeSorted(
  key: string,
  start: number,
  end: number,
  options?: { reverse?: boolean }
) {
  return [...(scores.get(key) ?? [])]
    .sort((a, b) => (options?.reverse ? b[1] - a[1] : a[1] - b[1]))
    .slice(start, end === -1 ? undefined : end + 1)
    .map(([member, score]) => ({ member, score }));
}
const realtimeSent: { channel: string; message: unknown }[] = [];
const realtime = {
  send: async (channel: string, message: unknown) => {
    realtimeSent.push({ channel, message });
  },
};
const redis = {
  incrBy: async (key: string, increment: number) => incrBy(key, increment),
  zIncrBy: async (key: string, member: string, increment: number) =>
    zIncrBy(key, member, increment),
  get: async (key: string) => values.get(key),
  set: async (key: string, value: string) => set(key, value),
  exists: async (...keys: string[]) =>
    keys.filter((key) => values.has(key) || scores.has(key) || hashes.has(key))
      .length,
  zScore: async (key: string, member: string) => scores.get(key)?.get(member),
  zRank: async (key: string, member: string) =>
    [...(scores.get(key) ?? [])]
      .sort((a, b) => a[1] - b[1])
      .findIndex(([name]) => name === member),
  zRange: async (
    key: string,
    start: number,
    end: number,
    options?: { reverse?: boolean }
  ) => zRangeSorted(key, start, end, options),
  hGet: async (key: string, field: string) => hashes.get(key)?.get(field),
  hLen: async (key: string) => hashes.get(key)?.size ?? 0,
  hIncrBy: async (key: string, field: string, increment: number) =>
    hIncrBy(key, field, increment),
  expire: async () => 1,
  watch: async (...keys: string[]) => {
    activeTransactions++;
    let closed = false;
    const close = () => {
      if (!closed) activeTransactions--;
      closed = true;
    };
    const watched = keys.map((key): [string, number] => [
      key,
      revisions.get(key) ?? 0,
    ]);
    const commands: (() => unknown)[] = [];
    return {
      multi: async () => {},
      incrBy: async (key: string, increment: number) => {
        commands.push(() => incrBy(key, increment));
      },
      zIncrBy: async (key: string, member: string, increment: number) => {
        commands.push(() => zIncrBy(key, member, increment));
      },
      expire: async () => {
        commands.push(() => 1);
      },
      set: async (key: string, value: string) => {
        commands.push(() => set(key, value));
      },
      zAdd: async (key: string, member: { member: string; score: number }) => {
        commands.push(() => zAdd(key, member));
      },
      hSet: async (key: string, fieldValues: Record<string, string>) => {
        commands.push(() => hSet(key, fieldValues));
      },
      hIncrBy: async (key: string, field: string, increment: number) => {
        commands.push(() => hIncrBy(key, field, increment));
      },
      del: async (key: string) => {
        commands.push(() => {
          values.delete(key);
          bump(key);
          return 1;
        });
      },
      discard: async () => close(),
      exec: async () => {
        const hook = beforeExec;
        beforeExec = undefined;
        if (hook) await hook();
        close();
        if (
          watched.some(
            ([key, revision]) => (revisions.get(key) ?? 0) !== revision
          )
        )
          return [];
        return commands.map((command) => command());
      },
    };
  },
};
mock.module('@devvit/web/server', {
  namedExports: {
    redis,
    realtime,
    context: {
      get username() {
        return users.getStore() ?? 'alice';
      },
    },
    reddit: {},
  },
});
const { publish } = await import('../routes/publish');
const { curse } = await import('../routes/curse');
const { runs } = await import('../routes/runs');
const { leaderboard } = await import('../routes/leaderboard');
const { currency } = await import('../routes/currency');
const { createCandidate, markCandidateVerified, getCandidate } =
  await import('../services/VerificationService');
const { getCurrentLevelVersion } = await import('../services/LevelService');
const {
  levelVersionKey,
  versionLeaderboardKey,
  trapKillsKey,
  userContributionsKey,
  clearedVersionsKey,
  currencyKey,
  streaksLeaderboardKey,
} = await import('../core/redisKeys');
const {
  isPublishLevelResponse,
  isProposeCurseResponse,
  isPublishCurseResponse,
} = await import('../../shared/editorApi');
const { isSubmitRunResponse, isTrapKillResponse } = await import(
  '../../shared/runsApi'
);
const { isCursersLeaderboardResponse } = await import(
  '../../shared/leaderboardApi'
);
const { isCurrencyBalanceResponse } = await import('../../shared/currencyApi');
const { withTransaction } = await import('../core/transactions');

beforeEach(() => {
  values.clear();
  scores.clear();
  hashes.clear();
  revisions.clear();
  realtimeSent.length = 0;
  beforeExec = undefined;
  assert.equal(activeTransactions, 0, 'transactions should always be released');
});
const objects: DraftObject[] = [
  { id: 'spawn', type: 'spawn', x: 90, y: 420 },
  { id: 'ground', type: 'ground', x: 90, y: 480 },
  { id: 'finish', type: 'finish', x: 330, y: 480 },
];
const post = (body: unknown) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
async function ready(username: string) {
  const token = await createCandidate(username, objects);
  assert.equal(await markCandidateVerified(username, token, 1000), true);
  return token;
}
async function publishAs(username: string, token: string, title: string) {
  return users.run(username, async () => {
    const response = await publish.request(
      '/publish',
      post({ candidateToken: token, title, objects })
    );
    const body: unknown = await response.json();
    assert.ok(isPublishLevelResponse(body));
    return { response, body };
  });
}
async function proposeCurse(
  username: string,
  levelId: string,
  object: DraftObject
) {
  return users.run(username, async () => {
    const response = await curse.request('/propose', post({ levelId, object }));
    const body: unknown = await response.json();
    assert.ok(isProposeCurseResponse(body));
    return { response, body };
  });
}
async function publishCurse(username: string, candidateToken: string) {
  return users.run(username, async () => {
    const response = await curse.request('/publish', post({ candidateToken }));
    const body: unknown = await response.json();
    assert.ok(isPublishCurseResponse(body));
    return { response, body };
  });
}

await test('malformed JSON values return 400 for every game POST endpoint', async () => {
  for (const body of [null, false, 42, 'text', [], {}]) {
    assert.equal((await runs.request('/', post(body))).status, 400);
    assert.equal((await runs.request('/trap-kill', post(body))).status, 400);
    for (const path of ['/validate', '/verify', '/publish']) {
      assert.equal((await publish.request(path, post(body))).status, 400);
    }
    for (const path of ['/propose', '/publish']) {
      assert.equal((await curse.request(path, post(body))).status, 400);
    }
  }
});

await test('publishing a seed title preserves initialized and uninitialized seed IDs', async () => {
  for (const initialized of [false, true]) {
    values.clear();
    if (initialized) await getCurrentLevelVersion('meat-grinder');
    const original = values.get(levelVersionKey('meat-grinder', 1));
    const { body } = await publishAs(
      'alice',
      await ready('alice'),
      'Meat Grinder'
    );
    assert.equal(body.status, 'ok');
    if (body.status === 'ok') assert.equal(body.levelId, 'meat-grinder-2');
    assert.equal(values.get(levelVersionKey('meat-grinder', 1)), original);
  }
});

await test('simultaneous publishes with the same title create distinct intact levels', async () => {
  const a = await ready('alice');
  const b = await ready('bob');
  const results = await Promise.all([
    publishAs('alice', a, 'Same title'),
    publishAs('bob', b, 'Same title'),
  ]);
  const ids = new Set<string>();
  for (const { body } of results) {
    assert.equal(body.status, 'ok');
    if (body.status === 'ok') ids.add(body.levelId);
  }
  assert.equal(ids.size, 2);
  assert.equal(await getCandidate('alice'), undefined);
  assert.equal(await getCandidate('bob'), undefined);
  for (const id of ids) assert.ok(await getCurrentLevelVersion(id));
});

await test('a replaced candidate cannot be verified by an earlier run', async () => {
  const oldToken = await createCandidate('alice', objects);
  let newToken = '';
  beforeExec = async () => {
    newToken = await createCandidate('alice', objects);
  };
  assert.equal(await markCandidateVerified('alice', oldToken, 1000), false);
  const current = await getCandidate('alice');
  assert.equal(current?.token, newToken);
  assert.equal(current?.verified, false);
});

await test('publish cannot consume a newer candidate or write a partial level', async () => {
  const token = await ready('alice');
  let newToken = '';
  beforeExec = async () => {
    newToken = await createCandidate('alice', objects);
  };
  const { response } = await publishAs('alice', token, 'Stale');
  assert.equal(response.status, 409);
  assert.equal((await getCandidate('alice'))?.token, newToken);
  assert.equal(await getCurrentLevelVersion('stale'), undefined);
});

await test('concurrent run submissions retain the fastest personal best', async () => {
  const key = versionLeaderboardKey('meat-grinder', 1);
  const responses = await Promise.all(
    [1000, 2000, 1500].map((timeMs) =>
      runs.request('/', post({ levelId: 'meat-grinder', version: 1, timeMs }))
    )
  );
  for (const response of responses) assert.equal(response.status, 200);
  assert.equal(await redis.zScore(key, 'alice'), 1000);
});

await test('transaction exceptions release the transaction without committing', async () => {
  await assert.rejects(
    withTransaction(['key'], async (tx) => {
      await tx.set('key', 'value');
      throw new Error('failed before commit');
    }),
    /failed before commit/
  );
  assert.equal(activeTransactions, 0);
  assert.equal(values.has('key'), false);
});

await test('a transaction conflict reported as an error is retried', async () => {
  beforeExec = async () => {
    throw Object.assign(new Error('Transaction aborted'), { code: 10 });
  };
  const token = await createCandidate('alice', objects);
  assert.equal(await markCandidateVerified('alice', token, 1000), true);
  assert.equal((await getCandidate('alice'))?.verified, true);
});

await test('editor taps on both halves of a ground tile resolve to ground, not an upper row', async () => {
  // Import through URLs so the server project does not include client sources.
  const { boardGridConfig, normalizeBoardRow, EDITOR_BOARD_ROWS } =
    await import(
      new URL('../../client/game/editor/GridSystem.ts', import.meta.url).href
    );
  const { default: getTileXY } = await import(
    new URL(
      '../../../node_modules/phaser4-rex-plugins/plugins/utils/grid/quad/GetTileXY.js',
      import.meta.url
    ).href
  );
  const config = boardGridConfig();
  const grid = {
    x: config.x,
    y: config.y,
    width: config.cellWidth,
    height: config.cellHeight,
    mode: 0,
  };
  for (const y of [480, 495, 525, 539]) {
    const tile = getTileXY.call(grid, 90, y);
    assert.ok(tile.y >= 0 && tile.y < EDITOR_BOARD_ROWS);
    assert.equal(config.y + normalizeBoardRow(tile.y) * config.cellHeight, 480);
  }
  for (const y of [180, 240, 300, 360, 420]) {
    const tile = getTileXY.call(grid, 90, y);
    assert.equal(config.y + normalizeBoardRow(tile.y) * config.cellHeight, y);
  }
  assert.ok(
    getTileXY.call(grid, 90, 120).y < 0,
    'taps above the grid must be outside the board'
  );
});

await test('curse propose -> verify -> publish appends a new version with attribution', async () => {
  await getCurrentLevelVersion('meat-grinder');
  const { body: proposeBody } = await proposeCurse('bob', 'meat-grinder', {
    id: 'ignored-client-id',
    type: 'spike',
    x: 700,
    y: 480,
  });
  assert.equal(proposeBody.status, 'ok');
  if (proposeBody.status !== 'ok') return;
  assert.equal(proposeBody.parentVersion, 1);

  assert.equal(
    await markCandidateVerified('bob', proposeBody.candidateToken, 2000),
    true
  );
  const { body: publishBody } = await publishCurse(
    'bob',
    proposeBody.candidateToken
  );
  assert.equal(publishBody.status, 'ok');
  if (publishBody.status !== 'ok') return;
  assert.equal(publishBody.version, 2);

  const updated = await getCurrentLevelVersion('meat-grinder');
  const added = updated?.objects.find((o) => o.type === 'spike' && o.x === 700);
  assert.equal(added?.addedBy, 'bob');
  assert.equal(added?.addedInVersion, 2);
  assert.equal(added?.id, proposeBody.objectId);
  assert.notEqual(added?.id, 'ignored-client-id');
  assert.equal(await getCandidate('bob'), undefined);
});

await test('curse propose rejects a disallowed type and a hazard that blocks the finish', async () => {
  await getCurrentLevelVersion('meat-grinder');
  const { body: badType } = await proposeCurse('alice', 'meat-grinder', {
    id: 'x',
    type: 'ground',
    x: 700,
    y: 480,
  });
  assert.equal(badType.status, 'error');

  const finishLevel = await getCurrentLevelVersion('meat-grinder');
  const finish = finishLevel?.objects.find((o) => o.type === 'finish');
  assert.ok(finish);
  const { body: onFinish } = await proposeCurse('alice', 'meat-grinder', {
    id: 'y',
    type: 'spike',
    x: finish.x,
    y: finish.y,
  });
  assert.equal(onFinish.status, 'error');
  assert.equal(await getCandidate('alice'), undefined);
});

// Phase 6 (spec section 18): two players who both beat the same version
// propose/verify a curse concurrently. Only one publish may win the race —
// the loser must be told the level changed rather than silently dropped or
// silently overwriting the winner's object.
await test('simultaneous curses against the same parent version: only one publishes, the loser is told to re-verify', async () => {
  const base = await getCurrentLevelVersion('meat-grinder');
  const baseObjectCount = base?.objects.length ?? 0;
  const { body: aBody } = await proposeCurse('alice', 'meat-grinder', {
    id: 'a',
    type: 'spike',
    x: 700,
    y: 480,
  });
  const { body: bBody } = await proposeCurse('bob', 'meat-grinder', {
    id: 'b',
    type: 'saw',
    x: 760,
    y: 480,
  });
  assert.equal(aBody.status, 'ok');
  assert.equal(bBody.status, 'ok');
  if (aBody.status !== 'ok' || bBody.status !== 'ok') return;
  assert.equal(aBody.parentVersion, 1);
  assert.equal(bBody.parentVersion, 1);

  assert.equal(
    await markCandidateVerified('alice', aBody.candidateToken, 1000),
    true
  );
  assert.equal(
    await markCandidateVerified('bob', bBody.candidateToken, 900),
    true
  );

  const [aResult, bResult] = await Promise.all([
    publishCurse('alice', aBody.candidateToken),
    publishCurse('bob', bBody.candidateToken),
  ]);
  const outcomes = [aResult.body, bResult.body];
  const winners = outcomes.filter((o) => o.status === 'ok');
  const losers = outcomes.filter((o) => o.status === 'error');
  assert.equal(winners.length, 1);
  assert.equal(losers.length, 1);
  const winner = winners[0];
  const loser = losers[0];
  if (winner?.status === 'ok') assert.equal(winner.version, 2);
  if (loser?.status === 'error') assert.equal(loser.conflict, true);

  const current = await getCurrentLevelVersion('meat-grinder');
  assert.equal(current?.version, 2);
  assert.equal(current?.objects.length, baseObjectCount + 1);

  // The loser's object is preserved (spec section 18: "Your Spike has been
  // preserved") — re-proposing against the now-current version and
  // re-verifying must still succeed.
  const loserUsername = winner === aResult.body ? 'bob' : 'alice';
  const sawObject: DraftObject = { id: 'b2', type: 'saw', x: 760, y: 480 };
  const spikeObject: DraftObject = { id: 'a2', type: 'spike', x: 700, y: 480 };
  const loserObject = loserUsername === 'bob' ? sawObject : spikeObject;
  const { body: retryPropose } = await proposeCurse(
    loserUsername,
    'meat-grinder',
    loserObject
  );
  assert.equal(retryPropose.status, 'ok');
  if (retryPropose.status !== 'ok') return;
  assert.equal(retryPropose.parentVersion, 2);
  assert.equal(
    await markCandidateVerified(
      loserUsername,
      retryPropose.candidateToken,
      800
    ),
    true
  );
  const { body: retryPublish } = await publishCurse(
    loserUsername,
    retryPropose.candidateToken
  );
  assert.equal(retryPublish.status, 'ok');
  if (retryPublish.status !== 'ok') return;
  assert.equal(retryPublish.version, 3);

  const final = await getCurrentLevelVersion('meat-grinder');
  assert.equal(final?.version, 3);
  assert.equal(final?.objects.length, baseObjectCount + 2);
});

const { discovery } = await import('../routes/discovery');
const { difficultyFor } = await import('../services/DiscoveryService');
const { isDiscoveryResponse } = await import('../../shared/discoveryApi');
const {
  allLevelsByDateKey,
  levelAttemptsKey,
  levelClearsKey,
  levelDailyPlayersKey,
  levelDailyClearsKey,
  levelCurrentVersionKey,
} = await import('../core/redisKeys');

async function browse(sort = 'trending') {
  const response = await discovery.request(`/levels?sort=${sort}`);
  assert.equal(response.status, 200);
  const body: unknown = await response.json();
  assert.ok(isDiscoveryResponse(body));
  return body.levels;
}

await test('difficulty uses spec boundaries and leaves unplayed levels unrated', () => {
  assert.equal(difficultyFor(0, 0), 'UNRATED');
  for (const [clears, label] of [
    [51, 'EASY'],
    [50, 'NORMAL'],
    [25, 'NORMAL'],
    [24, 'HARD'],
    [10, 'HARD'],
    [9, 'CURSED'],
    [3, 'CURSED'],
    [2, 'NIGHTMARE'],
  ]) {
    if (typeof clears === 'number')
      assert.equal(difficultyFor(100, clears), label);
  }
});

await test('discovery includes seeds and atomically indexed new publishes', async () => {
  assert.equal((await browse()).length, 1);
  const result = await publishAs('bob', await ready('bob'), 'A new level');
  assert.equal(result.body.status, 'ok');
  const first = (await browse('new'))[0];
  assert.equal(first?.title, 'A new level');
  assert.equal(first?.creatorUsername, 'bob');
  assert.equal(first?.difficulty, 'UNRATED');
  assert.equal(first?.worldRecordMs, null);
  assert.equal(scores.get(allLevelsByDateKey())?.size, 1);
  const token = await ready('alice');
  beforeExec = async () => {
    await createCandidate('alice', objects);
  };
  assert.equal(
    (await publishAs('alice', token, 'Never published')).response.status,
    409
  );
  assert.equal(scores.get(allLevelsByDateKey())?.size, 1);
  assert.equal((await discovery.request('/levels?sort=invalid')).status, 400);
});

await test('run counters include repeat clears exactly once across WATCH retries and exclude invalid runs', async () => {
  await getCurrentLevelVersion('meat-grinder');
  const key = versionLeaderboardKey('meat-grinder', 1);
  beforeExec = async () => {
    zAdd(key, { member: 'bob', score: 500 });
  };
  for (const timeMs of [1000, 2000]) {
    assert.equal(
      (
        await runs.request(
          '/',
          post({ levelId: 'meat-grinder', version: 1, timeMs })
        )
      ).status,
      200
    );
  }
  assert.equal(values.get(levelAttemptsKey('meat-grinder')), '2');
  assert.equal(values.get(levelClearsKey('meat-grinder')), '2');
  assert.equal(
    (
      await runs.request(
        '/',
        post({ levelId: 'missing', version: 1, timeMs: 1000 })
      )
    ).status,
    404
  );
  assert.equal(
    (
      await runs.request(
        '/',
        post({ levelId: 'meat-grinder', version: 99, timeMs: 1000 })
      )
    ).status,
    404
  );
  assert.equal(values.get(levelAttemptsKey('missing')), undefined);
  assert.equal(values.get(levelAttemptsKey('meat-grinder')), '2');
});

await test('reported trap deaths affect completion and deadliest sorting', async () => {
  await getCurrentLevelVersion('meat-grinder');
  await runs.request(
    '/',
    post({ levelId: 'meat-grinder', version: 1, timeMs: 1000 })
  );
  const death = await runs.request(
    '/trap-kill',
    post({ levelId: 'meat-grinder', version: 1, objectId: 'spike-1' })
  );
  assert.equal(death.status, 200);
  const first = (await browse('deadliest'))[0];
  assert.equal(first?.levelId, 'meat-grinder');
  assert.equal(first?.attempts, 2);
  assert.equal(first?.clears, 1);
  assert.equal(first?.completionRate, 0.5);
  assert.equal(first?.difficulty, 'NORMAL');
  assert.equal(
    (
      await runs.request(
        '/trap-kill',
        post({ levelId: 'meat-grinder', version: 1, objectId: 'missing' })
      )
    ).status,
    404
  );
  assert.equal(values.get(levelAttemptsKey('meat-grinder')), '2');
});

await test('speedrun uses only current-version records and trending includes fresh mutations and today activity', async () => {
  const base = await getCurrentLevelVersion('meat-grinder');
  assert.ok(base);
  await runs.request(
    '/',
    post({ levelId: 'meat-grinder', version: 1, timeMs: 1000 })
  );
  const second = await publishAs('bob', await ready('bob'), 'Second Level');
  assert.equal(second.body.status, 'ok');
  const secondLevelId = second.body.status === 'ok' ? second.body.levelId : '';
  await users.run('bob', () =>
    runs.request(
      '/',
      post({ levelId: secondLevelId, version: 1, timeMs: 2000 })
    )
  );
  assert.equal((await browse('speedrun'))[0]?.levelId, 'meat-grinder');
  set(
    levelVersionKey('meat-grinder', 2),
    JSON.stringify({ ...base, version: 2, parentVersion: 1 })
  );
  set(levelCurrentVersionKey('meat-grinder'), '2');
  assert.equal((await browse('speedrun'))[0]?.levelId, secondLevelId);
  const trending = await browse();
  assert.equal(trending[0]?.levelId, 'meat-grinder');
  assert.equal(trending[0]?.trendingScore, 4);
  assert.equal(trending[0]?.creatorUsername, base.contributorUsername);
  assert.equal(trending[0]?.createdAt, base.createdAt);
  assert.equal(trending[0]?.worldRecordMs, null);
  const third = await publishAs('alice', await ready('alice'), 'Third Level');
  assert.equal(third.body.status, 'ok');
  const thirdLevelId = third.body.status === 'ok' ? third.body.levelId : '';
  const yesterday = Math.floor(Date.now() / 86400000) - 1;
  zAdd(levelDailyPlayersKey(thirdLevelId, yesterday), {
    member: 'old-player',
    score: 1000,
  });
  set(levelDailyClearsKey(thirdLevelId, yesterday), '1000');
  assert.equal(
    (await browse()).find((level) => level.levelId === thirdLevelId)
      ?.trendingScore,
    0
  );
});

await test('discovery wire guard rejects malformed cards', () => {
  assert.equal(isDiscoveryResponse({ levels: [null] }), false);
  assert.equal(
    isDiscoveryResponse({ levels: [{ levelId: 'fake', difficulty: 'EASY' }] }),
    false
  );
});

// Phase 7 (spec section 23): dying to a community-added trap must grow
// both the trap's own kill count and its contributor's running total.
await test('trap-kill attribution grows the trap and contributor counters', async () => {
  const base = await getCurrentLevelVersion('meat-grinder');
  const spikeId = base?.objects.find((o) => o.type === 'spike')?.id;
  assert.ok(spikeId);
  if (!spikeId) return;

  const first = await users.run('alice', () =>
    runs.request(
      '/trap-kill',
      post({ levelId: 'meat-grinder', version: 1, objectId: spikeId })
    )
  );
  assert.equal(first.status, 200);
  const firstBody: unknown = await first.json();
  assert.ok(isTrapKillResponse(firstBody));
  if (!isTrapKillResponse(firstBody)) return;
  assert.equal(firstBody.kills, 1);
  assert.equal(firstBody.addedBy, 'cursed_seed');
  assert.equal(firstBody.contributorTotalKills, 1);

  const second = await users.run('bob', () =>
    runs.request(
      '/trap-kill',
      post({ levelId: 'meat-grinder', version: 1, objectId: spikeId })
    )
  );
  const secondBody: unknown = await second.json();
  assert.ok(isTrapKillResponse(secondBody));
  if (!isTrapKillResponse(secondBody)) return;
  assert.equal(secondBody.kills, 2);
  assert.equal(secondBody.contributorTotalKills, 2);

  assert.equal(await redis.get(trapKillsKey(spikeId)), '2');
  assert.equal(await redis.get(userContributionsKey('cursed_seed')), '2');
});

await test('trap-kill attribution survives a curse that lands after the death, and rejects an unknown trap', async () => {
  await getCurrentLevelVersion('meat-grinder');
  const { body: proposeBody } = await proposeCurse('carol', 'meat-grinder', {
    id: 'ignored',
    type: 'saw',
    x: 700,
    y: 480,
  });
  assert.equal(proposeBody.status, 'ok');
  if (proposeBody.status !== 'ok') return;
  assert.equal(
    await markCandidateVerified('carol', proposeBody.candidateToken, 1500),
    true
  );
  const { body: publishBody } = await publishCurse(
    'carol',
    proposeBody.candidateToken
  );
  assert.equal(publishBody.status, 'ok');

  // Reported against the stale version 1 the player actually died on —
  // still attributes correctly since carol's saw is still present (at the
  // same id) in the new current version.
  const stale = await users.run('dave', () =>
    runs.request(
      '/trap-kill',
      post({
        levelId: 'meat-grinder',
        version: 1,
        objectId: proposeBody.objectId,
      })
    )
  );
  const staleBody: unknown = await stale.json();
  assert.ok(isTrapKillResponse(staleBody));
  if (!isTrapKillResponse(staleBody)) return;
  assert.equal(staleBody.addedBy, 'carol');
  assert.equal(staleBody.kills, 1);

  const unknown = await users.run('dave', () =>
    runs.request(
      '/trap-kill',
      post({ levelId: 'meat-grinder', version: 1, objectId: 'no-such-object' })
    )
  );
  assert.equal(unknown.status, 404);
});

// EditorToolbar/CurseToolbar look up DOM buttons by building ids from
// PLACEABLE_TYPES/CURSE_CATEGORY_TYPES at runtime (e.g.
// `requireButton(`editor-tool-${tool}`)`) — a typo or casing mismatch
// between one of those ids and the actual element in game.html isn't
// caught by tsc/eslint (it's just a string), only by that lookup throwing
// at scene creation. That's exactly what happened with
// `curse-category-powerUp` vs. an actual `curse-category-powerup` in
// game.html: CurseToolbar's constructor threw, aborting CurseScene.create()
// partway through, which read to the user as "the game just freezes" on
// clicking Curse This Level. This cross-checks every id these two toolbars
// construct against the real game.html so a future type/category addition
// that forgets (or mis-cases) its button fails a fast, plain test instead
// of only failing silently at runtime.
await test('every editor/curse toolbar button id these look up actually exists in game.html', async () => {
  const { readFileSync } = await import('node:fs');
  const html = readFileSync(
    new URL('../../client/game.html', import.meta.url),
    'utf8'
  );
  const ids = new Set(
    [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1])
  );
  const assertIdExists = (id: string) =>
    assert.ok(ids.has(id), `game.html is missing #${id}`);

  const { PLACEABLE_TYPES } = await import(
    new URL('../../client/game/editor/GridSystem.ts', import.meta.url).href
  );
  for (const tool of ['select', ...PLACEABLE_TYPES]) {
    assertIdExists(`editor-tool-${tool}`);
  }

  const { CURSE_CATEGORY_TYPES } = await import('../../shared/editorApi');
  for (const category of Object.keys(CURSE_CATEGORY_TYPES)) {
    assertIdExists(`curse-category-${category}`);
  }
  for (const types of Object.values(CURSE_CATEGORY_TYPES)) {
    for (const type of types) {
      assertIdExists(`curse-type-${type}`);
    }
  }
});

// Root cause of "click Curse This Level and the game just freezes" (a
// second, distinct bug from the toolbar-id one above): Phaser's DisplayList
// destroys every game object — nulling its `.scene` — from a SHUTDOWN
// listener registered during scene boot, which fires before GameScene's own
// `.once('shutdown', this.cleanup)` listener (registered later, in
// create()), since Phaser's event emitter runs listeners in registration
// order. Player.destroy() read `this.sprite.scene.events` during that
// window, throwing on undefined mid-teardown and aborting the scene
// transition to CurseScene silently. Confirmed live via a headless
// Playwright playtest (play a level to the finish, click the real
// #run-result-curse-btn) before and after the fix. There's no
// Phaser-runtime harness in this Node test suite to exercise the actual
// scene-shutdown ordering, so this is a source-pattern guard: Player must
// keep its own captured `scene` reference rather than reaching back through
// `sprite.scene`, which is exactly the pattern that broke.
await test('Player never reads back through sprite.scene (nulled mid scene-teardown)', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(
    new URL('../../client/game/entities/Player.ts', import.meta.url),
    'utf8'
  );
  assert.ok(
    !source.includes('sprite.scene'),
    'Player.ts must capture `scene` at construction and use `this.scene`, ' +
      'never `this.sprite.scene` — the latter is undefined by the time ' +
      'destroy()/die() run during GameScene shutdown'
  );
  assert.match(
    source,
    /private readonly scene: Phaser\.Scene;/,
    'Player must declare a captured `scene` field'
  );
});

await test('editor preserves supporting ground when placing, replacing, moving and undoing objects', async () => {
  const { EditorController } = await import(
    new URL('../../client/game/editor/EditorController.ts', import.meta.url).href
  );
  const floor: DraftObject = { id: 'floor', type: 'ground', x: 330, y: 480 };
  const otherFloor: DraftObject = { id: 'other-floor', type: 'ground', x: 390, y: 480 };
  const editor = new EditorController([floor, otherFloor]);
  editor.placeObject('spike', 330, 480);
  assert.equal(editor.getObjects().length, 3);
  editor.placeObject('finish', 330, 480);
  assert.equal(editor.getObjects().length, 3);
  assert.ok(editor.getObjects().some((o: DraftObject) => o.id === floor.id));
  editor.selectAt(330, 480);
  editor.moveSelectedTo(390, 480);
  assert.ok(editor.getObjects().some((o: DraftObject) => o.id === otherFloor.id));
  assert.ok(editor.getObjects().some((o: DraftObject) => o.type === 'finish' && o.x === 390));
  editor.undo();
  assert.ok(editor.getObjects().some((o: DraftObject) => o.type === 'finish' && o.x === 330));
  editor.redo();
  editor.placeObject('ground', 390, 480);
  assert.equal(editor.getObjects().length, 3);
  assert.ok(editor.getObjects().some((o: DraftObject) => o.type === 'finish'));
});

await test('curse preview contains the latest parent and exactly the objects that publish', async () => {
  const initial = await getCurrentLevelVersion('meat-grinder');
  assert.ok(initial);
  const first = await proposeCurse('alice', initial.levelId, {
    id: 'first', type: 'spike', x: 700, y: 480,
  });
  assert.ok(first.body.status === 'ok');
  const firstObjectId = first.body.objectId;
  await markCandidateVerified('alice', first.body.candidateToken, 2000);
  assert.equal((await publishCurse('alice', first.body.candidateToken)).body.status, 'ok');

  const second = await proposeCurse('bob', initial.levelId, {
    id: 'second', type: 'saw', x: 760, y: 480,
  });
  assert.ok(second.body.status === 'ok');
  const preview = second.body.previewLevel;
  assert.equal(preview.parentVersion, 2);
  assert.equal(preview.objects.length, initial.objects.length + 2);
  assert.ok(preview.objects.some((o) => o.id === firstObjectId));
  await markCandidateVerified('bob', second.body.candidateToken, 2500);
  assert.equal((await publishCurse('bob', second.body.candidateToken)).body.status, 'ok');
  const published = await getCurrentLevelVersion(initial.levelId);
  assert.deepEqual(published?.objects, preview.objects);
});

await test('parseDraftObjectsJson accepts a valid round-trip and rejects everything else', () => {
  const objects: DraftObject[] = [
    { id: 'spawn-1', type: 'spawn', x: 80, y: 480 },
    { id: 'spike-1', type: 'spike', x: 500, y: 480 },
  ];
  assert.deepEqual(
    parseDraftObjectsJson(JSON.stringify(objects)),
    objects
  );
  assert.equal(parseDraftObjectsJson('not json'), null);
  assert.equal(parseDraftObjectsJson('{"not": "an array"}'), null);
  assert.equal(
    parseDraftObjectsJson('[{"id": "x", "type": "spike"}]'),
    null,
    'an element missing x/y must be rejected'
  );
});

// Root cause of "I beat the level, click Curse, pick a type, then click
// where I want to place it and it glitches". #run-result and #death-panel
// fade out via `opacity: 0` + `pointer-events: none`, but their button rows
// (#run-result-actions / #death-panel-actions) opt themselves back in with
// `pointer-events: auto` — and a descendant's explicit `auto` beats an
// ancestor's `none`. So a "hidden" result overlay left an invisible but
// fully hit-testable ~289x52px strip of Retry/Curse buttons parked
// dead-centre of the screen, which is exactly where CurseScene's ground row
// sits. Taps there never reached the rexBoard tile (no curse placed) and
// instead fired the already-destroyed GameScene's restartRun(), throwing
// `Cannot read properties of undefined (reading 'setVelocity')` from
// Player.reset(). Confirmed live via a headless Playwright playtest
// (document.elementFromPoint over the faded overlay returned
// #run-result-retry-btn before the fix, CANVAS after). `visibility: hidden`
// is inherited and cannot be opted out of, so it takes the whole subtree
// out of hit testing; this guards both panels against the `pointer-events`
// -only regression coming back.
await test('faded-out DOM overlays are removed from hit testing, not just made invisible', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(
    new URL('../../client/game.css', import.meta.url),
    'utf8'
  );
  for (const selector of ['#run-result', '#death-panel']) {
    const rule = css.match(
      new RegExp(`\\${selector}\\.hidden\\s*\\{([^}]*)\\}`)
    );
    assert.ok(rule, `game.css is missing a ${selector}.hidden rule`);
    if (!rule) continue;
    assert.match(
      rule[1] ?? '',
      /visibility:\s*hidden/,
      `${selector}.hidden must set \`visibility: hidden\` — \`opacity: 0\` ` +
        'plus `pointer-events: none` is not enough, because its actions row ' +
        'sets `pointer-events: auto` and a descendant wins over an ancestor. ' +
        'Without it the invisible overlay swallows the taps meant for the ' +
        'canvas underneath (CurseScene tile placement).'
    );
  }
});

// Second, independent cause of "placing a curse glitches", this one
// specific to Moving Platform: it is the one type ObjectRegistry gives a
// *dynamic* Arcade body (movingPlatform needs `setDirectControl` to carry a
// standing player, which only exists on Body, not StaticBody). A dynamic
// body inherits the game's world gravity the instant it is created, and
// only LevelLoader turned that off — and only for the copy it loads into a
// live GameScene run. Every other caller (EditorScene's board, CurseScene's
// read-only base level and its pending preview) got a platform that
// immediately free-fell off the bottom of the screen. Confirmed live by
// sampling the preview sprite's y per frame after placement: 480 -> 728+
// and still accelerating before the fix, flat at 480 after.
await test('renderLevelObject disables gravity on the dynamic body it creates', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(
    new URL('../../client/game/objects/ObjectRegistry.ts', import.meta.url),
    'utf8'
  );
  assert.match(
    source,
    /setAllowGravity\(false\)/,
    'ObjectRegistry.renderLevelObject must disable gravity on the dynamic ' +
      'body it creates for DYNAMIC_BODY_TYPES — otherwise the object falls ' +
      'off screen in every scene that renders it outside a live run ' +
      '(EditorScene, CurseScene base level and pending preview)'
  );
});

await test('concurrent identical run submissions count a single clear', async () => {
  await getCurrentLevelVersion('meat-grinder');
  const responses = await Promise.all([1, 2].map(() =>
    runs.request('/', post({ levelId: 'meat-grinder', version: 1, timeMs: 1000 }))
  ));
  assert.ok(responses.every((response) => response.status === 200));
  assert.equal(values.get('level:meat-grinder:clears'), '1');
  assert.equal(values.get('level:meat-grinder:attempts'), '1');
});

await test('curse publish preserves a candidate replaced during commit', async () => {
  const proposal = await proposeCurse('alice', 'meat-grinder', {
    id: 'ignored', type: 'spike', x: 1500, y: 360,
  });
  assert.ok(proposal.body.status === 'ok');
  const token = proposal.body.candidateToken;
  await markCandidateVerified('alice', token, 1000);
  let replacement = '';
  beforeExec = async () => {
    replacement = await createCandidate('alice', objects);
  };
  const result = await publishCurse('alice', token);
  assert.equal(result.response.status, 409);
  assert.equal((await getCandidate('alice'))?.token, replacement);
  assert.equal((await getCurrentLevelVersion('meat-grinder'))?.version, 1);
});

await test('placement rejects duplicate and blank IDs through validation endpoint', async () => {
  for (const id of ['same', '', '   ']) {
    const response = await publish.request('/validate', post({
      objects: objects.map((object) => ({ ...object, id })),
    }));
    const body = await response.json();
    assert.equal(body.status, 'error');
    assert.ok(body.errors.includes('Object IDs must be nonempty and unique.'));
  }
});

await test('publishing the same imported draft assigns independent trap identities', async () => {
  const first = await publishAs('alice', await ready('alice'), 'First import');
  const second = await publishAs('bob', await ready('bob'), 'Second import');
  assert.ok(first.body.status === 'ok');
  assert.ok(second.body.status === 'ok');
  const a = await getCurrentLevelVersion(first.body.levelId);
  const b = await getCurrentLevelVersion(second.body.levelId);
  assert.ok(a && b);
  const ids = [...a.objects, ...b.objects].map((object) => object.id);
  assert.equal(new Set(ids).size, objects.length * 2);
  assert.ok(ids.every((id) => !objects.some((object) => object.id === id)));
  assert.deepEqual(a.objects.map(({ type, x, y }) => ({ type, x, y })),
    objects.map(({ type, x, y }) => ({ type, x, y })));
});


// Phase 11 (Clear Streaks + currency, spec sections 28/29 plus a new
// earn-only reward currency): a streak never resets (spec section 28
// explicitly forbids resetting on death, and there's no other reset
// trigger), so it's just a lifetime count of unique (level, version) pairs
// cleared — a replay of an already-cleared version must not grow it again,
// but currency (flat per non-duplicate clear) is awarded either way.
await test('clearing a version for the first time grows the streak and currency; a replay only grows currency', async () => {
  await getCurrentLevelVersion('meat-grinder');
  const first = await runs.request(
    '/',
    post({ levelId: 'meat-grinder', version: 1, timeMs: 5000 })
  );
  const firstBody: unknown = await first.json();
  assert.ok(isSubmitRunResponse(firstBody));
  if (!isSubmitRunResponse(firstBody)) return;
  assert.equal(firstBody.streak, 1);
  assert.equal(firstBody.isNewStreakIncrease, true);
  assert.equal(firstBody.currencyAwarded, 10);
  assert.equal(firstBody.currencyBalance, 10);
  assert.equal(await redis.hLen(clearedVersionsKey('alice')), 1);
  assert.equal(await redis.zScore(streaksLeaderboardKey(), 'alice'), 1);

  const replay = await runs.request(
    '/',
    post({ levelId: 'meat-grinder', version: 1, timeMs: 6000 })
  );
  const replayBody: unknown = await replay.json();
  assert.ok(isSubmitRunResponse(replayBody));
  if (!isSubmitRunResponse(replayBody)) return;
  assert.equal(replayBody.streak, 1, 'a replay must not grow the streak');
  assert.equal(replayBody.isNewStreakIncrease, false);
  assert.equal(replayBody.currencyAwarded, 10, 'currency is flat per clear');
  assert.equal(replayBody.currencyBalance, 20);
  assert.equal(await redis.get(currencyKey('alice')), '20');
});

await test('a new world record fires a Realtime event, a slower clear does not', async () => {
  await getCurrentLevelVersion('meat-grinder');
  await users.run('bob', () =>
    runs.request(
      '/',
      post({ levelId: 'meat-grinder', version: 1, timeMs: 5000 })
    )
  );
  assert.equal(realtimeSent.length, 1);
  assert.equal(realtimeSent[0]?.channel, 'level_meat_grinder_events');
  assert.deepEqual(realtimeSent[0]?.message, {
    type: 'newWorldRecord',
    levelId: 'meat-grinder',
    username: 'bob',
    timeMs: 5000,
  });

  await users.run('alice', () =>
    runs.request(
      '/',
      post({ levelId: 'meat-grinder', version: 1, timeMs: 6000 })
    )
  );
  assert.equal(realtimeSent.length, 1, 'a slower clear is not a new record');

  await users.run('alice', () =>
    runs.request(
      '/',
      post({ levelId: 'meat-grinder', version: 1, timeMs: 2000 })
    )
  );
  assert.equal(realtimeSent.length, 2);
  assert.equal(
    (realtimeSent[1]?.message as { username?: string }).username,
    'alice'
  );
});

await test('curse publish fires a versionPublished Realtime event on the level channel', async () => {
  await getCurrentLevelVersion('meat-grinder');
  const { body: proposeBody } = await proposeCurse('bob', 'meat-grinder', {
    id: 'ignored', type: 'spike', x: 700, y: 480,
  });
  assert.ok(proposeBody.status === 'ok');
  if (proposeBody.status !== 'ok') return;
  await markCandidateVerified('bob', proposeBody.candidateToken, 2000);
  await publishCurse('bob', proposeBody.candidateToken);

  const event = realtimeSent.find((e) => e.channel === 'level_meat_grinder_events');
  assert.ok(event);
  assert.deepEqual(event?.message, {
    type: 'versionPublished',
    levelId: 'meat-grinder',
    version: 2,
    authorUsername: 'bob',
    addedType: 'spike',
  });
});

await test('the global TOP CURSERS leaderboard ranks by trap kills, and currency reads back what runs.ts wrote', async () => {
  await getCurrentLevelVersion('meat-grinder');
  await runs.request(
    '/',
    post({ levelId: 'meat-grinder', version: 1, timeMs: 3000 })
  );

  const base = await getCurrentLevelVersion('meat-grinder');
  const spikeId = base?.objects.find((o) => o.type === 'spike')?.id;
  assert.ok(spikeId);
  if (!spikeId) return;
  // Two kills attributed to the seed author, one to bob, via separate
  // players dying to spikes placed by each.
  for (const killer of ['alice', 'alice']) {
    await users.run(killer, () =>
      runs.request(
        '/trap-kill',
        post({ levelId: 'meat-grinder', version: 1, objectId: spikeId })
      )
    );
  }
  const { body: proposeBody } = await proposeCurse('bob', 'meat-grinder', {
    id: 'ignored', type: 'spike', x: 700, y: 480,
  });
  assert.ok(proposeBody.status === 'ok');
  if (proposeBody.status !== 'ok') return;
  await markCandidateVerified('bob', proposeBody.candidateToken, 2000);
  await publishCurse('bob', proposeBody.candidateToken);
  await users.run('carol', () =>
    runs.request(
      '/trap-kill',
      post({ levelId: 'meat-grinder', version: 2, objectId: proposeBody.objectId })
    )
  );

  const leaderboardResponse = await leaderboard.request('/');
  assert.equal(leaderboardResponse.status, 200);
  const leaderboardBody: unknown = await leaderboardResponse.json();
  assert.ok(isCursersLeaderboardResponse(leaderboardBody));
  if (!isCursersLeaderboardResponse(leaderboardBody)) return;
  // cursed_seed (the spike's placeholder author) has 2 kills, bob's new
  // saw has 1 — highest kills first.
  assert.equal(leaderboardBody.topTen[0]?.username, 'cursed_seed');
  assert.equal(leaderboardBody.topTen[0]?.kills, 2);
  assert.equal(leaderboardBody.topTen[1]?.username, 'bob');
  assert.equal(leaderboardBody.topTen[1]?.kills, 1);

  const currencyResponse = await currency.request('/');
  const currencyBody: unknown = await currencyResponse.json();
  assert.ok(isCurrencyBalanceResponse(currencyBody));
  if (!isCurrencyBalanceResponse(currencyBody)) return;
  assert.equal(currencyBody.balance, 10);
});

// Root cause of "blank screen on Play": `@devvit/realtime`'s connectRealtime
// throws synchronously for any channel name outside [a-zA-Z0-9_], and
// levelRealtimeChannel was building one straight from a level id (slugified
// titles like "meat-grinder" contain hyphens, plus the old format's own
// colons) — GameScene called it unguarded in the middle of loading a level,
// so every single Play attempt threw before the level ever got built. This
// guards the sanitization rather than the specific old bug, so any future
// change to level id formats can't reintroduce it.
await test('levelRealtimeChannel always produces a channel connectRealtime accepts', async () => {
  const { levelRealtimeChannel } = await import('../../shared/realtimeApi');
  for (const levelId of ['meat-grinder', 'gap-gauntlet', 'a-b-c-123', 'x']) {
    assert.match(levelRealtimeChannel(levelId), /^[a-zA-Z0-9_]+$/);
  }
});

await test('editor move eligibility uses separate ground and surface slots', async () => {
  const { EditorController } = await import(
    new URL('../../client/game/editor/EditorController.ts', import.meta.url).href
  );
  const editor = new EditorController([
    { id: 'hazard', type: 'spike', x: 330, y: 480 },
    { id: 'floor', type: 'ground', x: 390, y: 480 },
    { id: 'occupied', type: 'finish', x: 450, y: 480 },
  ]);
  editor.selectAt(330, 480);
  assert.equal(editor.canMoveSelectedTo(390, 480), true);
  assert.equal(editor.canMoveSelectedTo(450, 480), false);
  editor.moveSelectedTo(390, 480);
  assert.equal(editor.getObjects().filter((o: DraftObject) => o.x === 390).length, 2);
  editor.undo();
  assert.equal(editor.getObjects().find((o: DraftObject) => o.id === 'hazard')?.x, 330);
});

await test('menu stats reads only its level counters and metadata without scanning discovery', async () => {
  const { getLevelStats } = await import('../services/DiscoveryService');
  const { levelAttemptsKey, levelMetaKey } = await import('../core/redisKeys');
  const scan = mock.method(redis, 'zRange', async () => {
    throw new Error('Menu stats must not scan sorted sets');
  });
  try {
    values.set(levelAttemptsKey('stats-fixture'), '123');
    values.set(levelMetaKey('stats-fixture'), JSON.stringify({
      title: 'Fixture', creatorUsername: 'builder', createdAt: 1,
    }));
    const expected = {
      title: 'Fixture', creatorUsername: 'builder', version: 1,
      attempts: 123, clears: 0, difficulty: 'NIGHTMARE',
    };
    assert.deepEqual(await getLevelStats('stats-fixture'), expected);
    const response = await discovery.request('/stats/stats-fixture');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), expected);
    assert.equal((await discovery.request('/stats/not-a-level')).status, 404);
    assert.equal(scan.mock.callCount(), 0);
  } finally {
    scan.mock.restore();
  }
});
