import { Scene, GameObjects } from 'phaser';
import type GridTable from 'phaser4-rex-plugins/templates/ui/gridtable/GridTable.js';
import type UIPlugin from 'phaser4-rex-plugins/templates/ui/ui-plugin.js';
import {
  isDiscoveryResponse,
  isLevelSummary,
  type DiscoverySort,
  type LevelSummary,
} from '../../../shared/discoveryApi';
import { withTimeout } from '../../net';

const SORTS: DiscoverySort[] = ['trending', 'deadliest', 'speedrun', 'new'];
const CARD_HEIGHT = 130;
const TABLE_TOP_Y = 104;
const TABLE_BOTTOM_MARGIN = 16;

export class DiscoveryScene extends Scene {
  // Injected at runtime by Phaser's PluginManager (mapping: 'rexUI' in
  // game.ts) — declared as a field, not read from `this` implicitly,
  // matching how EditorScene/CurseScene already declare `rexBoard`.
  private rexUI!: UIPlugin;

  private sort: DiscoverySort = 'trending';
  private levels: LevelSummary[] = [];
  private message = '';
  private request: AbortController | undefined;
  private content: GameObjects.Container | undefined;
  // rexUI's GridTable (spec section 26-27's level browser) replaces manual
  // prev/next pagination with a real scrollable list — same
  // phaser4-rex-plugins package the editor's grid math already depends on,
  // registered as the 'rexUI' scene plugin in game.ts.
  private table: GridTable | undefined;

  constructor() {
    super('DiscoveryScene');
  }

  create(): void {
    this.sort = 'trending';
    this.levels = [];
    this.content = undefined;
    this.table = undefined;
    this.cameras.main.setBackgroundColor(0x14141f);
    this.scale.on('resize', this.render, this);
    this.events.once('shutdown', () => {
      this.request?.abort();
      this.request = undefined;
      this.table?.destroy();
      this.table = undefined;
      this.scale.off('resize', this.render, this);
    });
    void this.loadLevels();
  }

  private async loadLevels(): Promise<void> {
    this.request?.abort();
    const request = new AbortController();
    this.request = request;
    this.levels = [];
    this.message = 'Loading levels...';
    this.render();
    try {
      const response = await fetch(`/api/discovery/levels?sort=${this.sort}`, {
        signal: withTimeout(request.signal, 15000),
      });
      const body: unknown = await response.json();
      if (!response.ok || !isDiscoveryResponse(body))
        throw new Error('Invalid discovery response');
      if (request.signal.aborted) return;
      this.levels = body.levels;
      this.message = this.levels.length === 0 ? 'No published levels yet.' : '';
    } catch {
      if (request.signal.aborted) return;
      this.message = 'Could not load levels. Tap RETRY.';
    }
    this.render();
  }

  private label(
    x: number,
    y: number,
    text: string,
    size: number,
    action?: () => void
  ): GameObjects.Text {
    const label = this.add
      .text(x, y, text, {
        fontFamily: 'Arial Black',
        fontSize: `${size}px`,
        color: action ? '#39ff88' : '#ffffff',
        stroke: '#000000',
        strokeThickness: 3,
      })
      .setOrigin(0.5);
    this.content?.add(label);
    if (action)
      label
        .setPadding(8, 10)
        .setInteractive({ useHandCursor: true })
        .on('pointerup', action);
    return label;
  }

  // One level card's content — built fresh per cell rather than reusing
  // (`reuseCellContainer`) since the level count here is small enough
  // (tens, not thousands) that recycling isn't worth the extra
  // update-in-place bookkeeping.
  private buildCard(level: LevelSummary, width: number): GameObjects.Container {
    const height = CARD_HEIGHT - 10;
    const card = this.add.container(0, 0);
    const background = this.add
      .rectangle(0, 0, width, height, 0x252537)
      .setOrigin(0)
      .setStrokeStyle(1, 0x39ff88)
      .setInteractive({ useHandCursor: true })
      .on('pointerup', () =>
        this.scene.start('GameScene', { levelId: level.levelId })
      );
    card.add(background);

    const addLine = (y: number, text: string, size: number): void => {
      const line = this.add
        .text(12, y, text, {
          fontFamily: 'Arial Black',
          fontSize: `${size}px`,
          color: '#ffffff',
          stroke: '#000000',
          strokeThickness: 3,
        })
        .setOrigin(0, 0.5);
      if (line.width > width - 24) line.setScale((width - 24) / line.width);
      card.add(line);
    };

    addLine(16, level.title, 18);
    addLine(40, `by u/${level.creatorUsername} · v${level.version}`, 13);
    const completion =
      level.attempts === 0
        ? '—'
        : `${(level.completionRate * 100).toFixed(1)}%`;
    addLine(65, `${level.difficulty} · Completion: ${completion}`, 13);
    addLine(86, `Attempts: ${level.attempts} · Clears: ${level.clears}`, 12);
    addLine(
      106,
      `Record: ${level.worldRecordMs === null ? '—' : `${(level.worldRecordMs / 1000).toFixed(3)}s`}`,
      12
    );
    return card;
  }

  private render(): void {
    this.content?.destroy();
    this.content = this.add.container();
    this.table?.destroy();
    this.table = undefined;

    const { width, height } = this.scale;
    const left = Math.max(12, (width - 640) / 2);
    const cardWidth = width - left * 2;
    this.label(left + 30, 26, 'BACK', 14, () => this.scene.start('MainMenu'));
    this.label(width / 2, 26, 'BROWSE', 22);
    this.label(
      width - left - 34,
      26,
      'RETRY',
      14,
      () => void this.loadLevels()
    );
    SORTS.forEach((sort, index) => {
      this.label(
        left + (cardWidth * (index + 0.5)) / SORTS.length,
        74,
        sort.toUpperCase(),
        Math.min(15, cardWidth / 25),
        () => {
          this.sort = sort;
          void this.loadLevels();
        }
      ).setColor(sort === this.sort ? '#39ff88' : '#ffffff');
    });

    if (this.message) this.label(width / 2, TABLE_TOP_Y + 12, this.message, 14);
    if (this.levels.length === 0) return;

    const tableHeight = Math.max(
      CARD_HEIGHT,
      height - TABLE_TOP_Y - TABLE_BOTTOM_MARGIN
    );
    this.table = this.rexUI.add.gridTable({
      x: width / 2,
      y: TABLE_TOP_Y + tableHeight / 2,
      width: cardWidth,
      height: tableHeight,
      scrollMode: 0,
      table: {
        cellHeight: CARD_HEIGHT,
        columns: 1,
      },
      items: this.levels,
      createCellContainerCallback: (cell) =>
        isLevelSummary(cell.item) ? this.buildCard(cell.item, cardWidth) : null,
    });
    this.table.layout();
  }
}
