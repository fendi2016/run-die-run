import { DEFAULT_LEVEL_ID } from '../../shared/constants';

// There's no level-discovery UI yet (spec section 38, Phase 9), so for now
// the only way to load a specific level is `?level=<id>` in the URL —
// enough to manually test the seeded levels without building a menu early.
export function getRequestedLevelId(): string {
  const params = new URLSearchParams(window.location.search);
  return params.get('level') || DEFAULT_LEVEL_ID;
}
