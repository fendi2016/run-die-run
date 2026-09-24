# Mobile production checks

Run `npm run check:production` for types, lint, server regressions, a production
build, and JavaScript transfer budgets. After building, run `npm run test:browser`
for browser fixtures (requires Playwright Chromium and a local listening port).
These commands do not upload or publish to Reddit.

## Implemented optimizations

- Painted art (ui/ backgrounds and logo, player frames, vfx sheets) is lossy
  WebP (quality 88, alpha 90), visually checked at 100% against the lossless
  originals; pixel-art tiles, hazards, markers and power-ups stay lossless.
  Frame dimensions are unchanged except the tap-to-start logo (1254 → 800 px,
  drawn at ≤260 CSS px). public/assets went from ~7.5 MB to 2.6 MB and the
  built client from 11 MB to 4.4 MB; the feed card's background is 221 KB
  (was 1.6 MB). Export new painted art the same way.
- Static solids, hazards, pickups, and finish sensors use four spatially indexed
  collision groups. Moving platforms retain their dynamic bodies and colliders
  so carry velocity and retry determinism are preserved.
- Rendering is limited to 60 FPS on high refresh displays. Physics constants
  and logical world height are unchanged.
- The post's level is fetched in parallel with Preloader assets, so no second
  loading screen appears between the bar and the level.
- `/api/discovery/levels` (Browse, and Next Level after every clear) is
  cached per sort for 15 s in each server instance, so the full catalog scan
  doesn't scale with player count.
- Background music (`assets/music/evening-mood.m4a`, 96 kbps AAC, 2.0 MB)
  streams through an `<audio>` element after the first tap instead of going
  through the Phaser loader, so it never delays the loading bar and isn't
  decoded to PCM in memory. AAC rather than the delivered Ogg Vorbis, which
  iOS webviews don't reliably play.
- Unused dependencies removed (phaser-runtime-editor, toolkit,
  command-history, nanoid, zod).
- Feed/menu statistics read a handful of plain Redis keys for one level. Discovery retains its
  global sorting and limits concurrent level reads to six workers.
- Client source maps are omitted. Browse remains dynamically imported.
- Loading progress fits narrow screens. Asset failures offer touch retry;
  level requests time out and abort on scene shutdown. Embedded storage failure
  falls back to the expanded menu.

## Baseline and limits

Initial JavaScript, including static imports, is approximately 5.3 KB gzip for
splash and 425 KB gzip for the expanded game. Budgets are 16 KiB and 550 KiB,
respectively. These are compressed file sizes, not measured network timings.

The browser fixtures cover mobile layout at 390 × 844, a 500-tile collision
world, hazards, collectible reset, movement retries, editor request lifecycle,
and asset failure recovery by touch. Local browser fixtures do not measure
Reddit network latency, real-device GPU frame time, thermal behavior, or memory
pressure. Check an iOS and Android Reddit playtest before publishing.

Discovery still sorts the full catalog; very large catalogs will need indexed
ranking/pagination. Bounding concurrency prevents request fan-out but does not
make total discovery work constant.
