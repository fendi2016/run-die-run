import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';

let mods: string[] = [];

mock.module('@devvit/web/server', {
  namedExports: {
    context: { username: 'alice', subredditName: 'sketchygame' },
    reddit: {
      getModerators: () => ({
        all: async () => mods.map((username) => ({ username })),
      }),
    },
  },
});

const { seedEditor } = await import('../routes/seedEditor');
const { SEED_LEVELS } = await import('../core/seedLevels');
const { isSeedLevelsResponse, seedLevelCode, snapSeedObjectsToGrid } = await import(
  '../../shared/seedEditorApi'
);
const { GROUND_TOP_Y } = await import('../../shared/constants');

async function levels(): Promise<unknown[]> {
  const body: unknown = await (await seedEditor.request('/')).json();
  assert.ok(isSeedLevelsResponse(body));
  return body.levels;
}

beforeEach(() => {
  mods = [];
});

await test('only moderators get the built-in levels', async () => {
  assert.deepEqual(await levels(), []);
  mods = ['Alice'];
  assert.equal((await levels()).length, Object.keys(SEED_LEVELS).length);
});

await test('copied code collapses ground runs and keeps object ids', () => {
  const code = seedLevelCode(
    'meat-grinder',
    [
      { id: 'g1', type: 'ground', x: 30, y: GROUND_TOP_Y },
      { id: 'g2', type: 'ground', x: 90, y: GROUND_TOP_Y },
      { id: 'g3', type: 'ground', x: 270, y: GROUND_TOP_Y },
      { id: 'candle-1', type: 'candle', x: 90, y: GROUND_TOP_Y },
      { id: 'ghost-1', type: 'ghost', x: 270, y: GROUND_TOP_Y - 120 },
    ],
    9831
  );
  assert.equal(
    code,
    [
      '// meat-grinder',
      'level(',
      "  'meat-grinder',",
      '  [',
      '    ...groundStrip(0, 120),',
      '    ...groundStrip(240, 60),',
      "    placed('candle-1', 'candle', 90, GROUND_TOP_Y),",
      "    placed('ghost-1', 'ghost', 270, GROUND_TOP_Y - 120),",
      '  ],',
      '  9831',
      ')',
    ].join('\n')
  );
});

await test('opening a built-in level snaps hazards to cells but leaves ground', () => {
  const snapped = snapSeedObjectsToGrid([
    { id: 'g', type: 'ground', x: 850, y: GROUND_TOP_Y },
    { id: 'c', type: 'candle', x: 400, y: GROUND_TOP_Y },
    { id: 'f', type: 'ghost', x: 2400, y: GROUND_TOP_Y - 130 },
  ]);
  assert.deepEqual(
    snapped.map(({ x, y }) => [x, y]),
    [
      [850, GROUND_TOP_Y],
      [390, GROUND_TOP_Y],
      [2430, GROUND_TOP_Y - 120],
    ]
  );
});
