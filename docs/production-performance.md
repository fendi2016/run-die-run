# Mobile production checks

Run `npm run check:production` for types, lint, server regressions, a production
build, and JavaScript transfer budgets. After building, run `npm run test:browser`
for browser fixtures (requires Playwright Chromium and a local listening port).
These commands do not upload or publish to Reddit.

## Implemented optimizations

- Lossless WebP assets preserve dimensions, transparency, and image pixels.
  Asset bytes decreased from 7,549,191 to 6,139,626 (18.7%). New art should be
  exported with lossless WebP; spritesheet frame dimensions must stay unchanged.
- Static solids, hazards, pickups, and finish sensors use four spatially indexed
  collision groups. Moving platforms retain their dynamic bodies and colliders
  so carry velocity and retry determinism are preserved.
- Rendering is limited to 60 FPS on high refresh displays. Physics constants
  and logical world height are unchanged.
- Feed/menu statistics read two Redis keys for one level. Discovery retains its
  global sorting and limits concurrent level reads to six workers.
- Client source maps are omitted. Browse remains dynamically imported.
- Loading progress fits narrow screens. Asset failures offer touch retry;
  level requests time out and abort on scene shutdown. Embedded storage failure
  falls back to the expanded menu.

## Baseline and limits

Initial JavaScript, including static imports, is approximately 4.6 KB gzip for
splash and 418 KB gzip for the expanded game. Budgets are 16 KiB and 550 KiB,
respectively. These are compressed file sizes, not measured network timings.

The browser fixtures cover mobile layout at 390 × 844, a 500-tile collision
world, hazards, collectible reset, movement retries, editor request lifecycle,
and asset failure recovery by touch. Local browser fixtures do not measure
Reddit network latency, real-device GPU frame time, thermal behavior, or memory
pressure. Check an iOS and Android Reddit playtest before publishing.

Discovery still sorts the full catalog; very large catalogs will need indexed
ranking/pagination. Bounding concurrency prevents request fan-out but does not
make total discovery work constant.
