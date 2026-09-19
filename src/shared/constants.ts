// Fixed logical game resolution. Every gameplay position, distance, and speed is
// authored in these units so mobile and desktop players see the same level
// regardless of device aspect ratio (spec section 5).
export const LOGICAL_WIDTH = 960;
export const LOGICAL_HEIGHT = 540;

// Grid unit shared by level data and the (future) level editor, so placed
// objects always land on the same cell boundaries a level's data describes.
export const GRID_CELL_SIZE = 60;

// World-layout baseline shared by level authoring (server seed data) and
// gameplay (client fall-through-a-gap detection), so both agree on where
// "the ground" sits without either hardcoding the other's assumptions.
export const GROUND_TOP_Y = 480;
export const FALL_DEATH_Y = GROUND_TOP_Y + 400;

// The level loaded when no level is explicitly requested (spec section 38,
// Phase 3: one hardcoded default while there's no discovery UI yet).
export const DEFAULT_LEVEL_ID = 'meat-grinder';

// Editor grid bounds (spec section 12). A soft cap, not a hard "this is too
// long" validator — spec section 38's phase notes call for enforcing
// "levels should be short" (rule 15) softly via the editor's own grid size
// rather than a dedicated length validator. Row 0 is the ground surface;
// higher rows are elevated cells above it (see client GridSystem).
export const EDITOR_MAX_COLUMNS = 90;
export const EDITOR_MAX_ROWS = 6;
export const EDITOR_MAX_OBJECTS = 250;
export const EDITOR_SPAWN_BUFFER_CELLS = 2;

// The placeholder "creator" of the hand-authored seed levels (spec section
// 38, Phase 3) — not a real Reddit account. Shared so the client's death
// attribution UI (spec section 23) can recognize it and skip showing a
// fake "Killed by u/cursed_seed's Spike" attribution for these
// not-yet-community-created levels.
export const SEED_AUTHOR = 'cursed_seed';
