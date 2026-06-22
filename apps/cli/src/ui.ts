import chalk, { type ChalkInstance } from 'chalk';
import type { Provider } from '@agent-usage/shared';

export const palette = {
  primary: chalk.cyan,
  secondary: chalk.magenta,
  accent: chalk.yellow,
  success: chalk.green,
  warning: chalk.yellow,
  error: chalk.red,
  muted: chalk.gray,
  info: chalk.blue,
  bold: chalk.bold,
};

export function isInteractive(): boolean {
  return process.stdout.isTTY === true && !process.env.CI;
}

export function setColorEnabled(enabled: boolean): void {
  chalk.level = enabled ? 3 : 0;
}

export function providerColor(provider: Provider): ChalkInstance {
  const colors: Record<string, ChalkInstance> = {
    claude: chalk.hex('#D97757'),
    codex: chalk.hex('#10A37F'),
    gemini: chalk.hex('#4285F4'),
    opencode: chalk.hex('#06B6D4'),
    copilot: chalk.hex('#A855F7'),
    aider: chalk.hex('#EAB308'),
    cursor: chalk.hex('#F8FAFC'),
    goose: chalk.hex('#3B82F6'),
    qwen: chalk.hex('#8B5CF6'),
    kimi: chalk.hex('#F43F5E'),
    droid: chalk.hex('#F59E0B'),
    amp: chalk.hex('#22D3EE'),
    codebuff: chalk.hex('#34D399'),
    openclaw: chalk.hex('#FB7185'),
    hermes: chalk.hex('#A78BFA'),
    'pi-agent': chalk.hex('#2DD4BF'),
    kilo: chalk.hex('#FBBF24'),
    specstory: chalk.hex('#94A3B8'),
    crush: chalk.hex('#CBD5E1'),
  };
  return colors[provider] ?? palette.primary;
}

export function badge(text: string, color: ChalkInstance): string {
  return color(` ${text} `);
}

export function compactBadge(text: string, color: ChalkInstance): string {
  return chalk.inverse(color(text));
}

export function statusBadge(installed: boolean): string {
  return installed
    ? compactBadge('detected', palette.success)
    : compactBadge('missing', palette.muted);
}

export function supportBadge(level: string): string {
  switch (level) {
    case 'exact-usage':
      return compactBadge(level, palette.success);
    case 'partial-usage':
      return compactBadge(level, palette.warning);
    case 'prompt-history-only':
    case 'detected-only':
      return compactBadge(level, palette.info);
    default:
      return compactBadge(level, palette.muted);
  }
}

// --------------------------------------------------------------------------
// Logo: geometric block grid inspired by OpenCode's animated pixel identity.
// --------------------------------------------------------------------------

const LOGO_WIDTH = 9;
const LOGO_HEIGHT = 7;

/**
 * 1 = solid block, 0 = empty. Forms a stylised "A" with a rising chart bar
 * inside — representing Agent + Usage + Stats.
 */
const LOGO_SHAPE: number[][] = [
  [0, 0, 1, 1, 1, 1, 1, 0, 0],
  [0, 1, 1, 0, 0, 0, 1, 1, 0],
  [1, 1, 0, 0, 1, 0, 0, 1, 1],
  [1, 1, 1, 1, 1, 1, 1, 1, 1],
  [1, 1, 0, 0, 0, 0, 0, 1, 1],
  [1, 1, 0, 0, 0, 0, 0, 1, 1],
  [1, 1, 0, 0, 0, 0, 0, 1, 1],
];

const LOGO_GRADIENT = [
  chalk.hex('#22d3ee'),
  chalk.hex('#38bdf8'),
  chalk.hex('#60a5fa'),
  chalk.hex('#818cf8'),
  chalk.hex('#a78bfa'),
  chalk.hex('#c084fc'),
  chalk.hex('#e879f9'),
];

function logoGradientColor(x: number, _y: number, _frame?: number): ChalkInstance {
  return LOGO_GRADIENT[x % LOGO_GRADIENT.length] ?? palette.primary;
}

function renderLogoFrame(visibleMask?: boolean[][]): string[] {
  const lines: string[] = [];
  for (let y = 0; y < LOGO_HEIGHT; y++) {
    let row = '';
    for (let x = 0; x < LOGO_WIDTH; x++) {
      if (!LOGO_SHAPE[y]![x]) {
        row += '  ';
        continue;
      }
      if (visibleMask && !visibleMask[y]?.[x]) {
        row += palette.muted('░░');
        continue;
      }
      row += logoGradientColor(x, y)('██');
    }
    lines.push(row);
  }
  return lines;
}

function buildLogoGrid(version?: string): string[] {
  const title = palette.bold('AgentUsageStats');
  const tagline = palette.muted('Local-first AI usage analyzer');
  const versionLine = palette.muted(`v${version ?? '0.1.0'}`);

  const artLines = renderLogoFrame();
  const textLines = [title, tagline, '', versionLine];

  const grid: string[] = [];
  for (let i = 0; i < Math.max(artLines.length, textLines.length); i++) {
    const art = artLines[i] ?? ' '.repeat(LOGO_WIDTH * 2);
    const text = textLines[i] ?? '';
    grid.push(`${art}   ${text}`);
  }
  return grid;
}

export function logoBlock(version = '0.1.0'): string[] {
  const inner = buildLogoGrid(version);
  const width = Math.max(...inner.map((line) => stripAnsi(line).length)) + 4;
  const top = '╭' + '─'.repeat(width) + '╮';
  const bottom = '╰' + '─'.repeat(width) + '╯';

  return [
    top,
    ...inner.map((line) => {
      const pad = width - stripAnsi(line).length - 1;
      return '│ ' + line + ' '.repeat(Math.max(0, pad)) + '│';
    }),
    bottom,
  ];
}

export function printLogo(version?: string): void {
  console.log(logoBlock(version).join('\n'));
}

export async function printLogoAnimated(version?: string): Promise<void> {
  const lines = logoBlock(version);
  if (!isInteractive()) {
    console.log(lines.join('\n'));
    return;
  }

  // Build the full block with a diagonal wave reveal for the pixel art.
  const inner = buildLogoGrid(version);
  const width = Math.max(...inner.map((line) => stripAnsi(line).length)) + 4;
  const top = '╭' + '─'.repeat(width) + '╮';
  const bottom = '╰' + '─'.repeat(width) + '╯';

  // Generate frame by gradually revealing the logo blocks.
  const frameCount = LOGO_WIDTH + LOGO_HEIGHT + 2;
  for (let frame = 0; frame <= frameCount; frame++) {
    const mask: boolean[][] = Array.from({ length: LOGO_HEIGHT }, () =>
      Array.from({ length: LOGO_WIDTH }, () => false),
    );
    for (let y = 0; y < LOGO_HEIGHT; y++) {
      for (let x = 0; x < LOGO_WIDTH; x++) {
        if (x + y <= frame) {
          mask[y]![x] = true;
        }
      }
    }

    const artLines = renderLogoFrame(mask);
    const textLines = [
      palette.bold('AgentUsageStats'),
      palette.muted('Local-first AI usage analyzer'),
      '',
      palette.muted(`v${version ?? '0.1.0'}`),
    ];

    const frameLines: string[] = [top];
    for (let i = 0; i < inner.length; i++) {
      const art = artLines[i] ?? ' '.repeat(LOGO_WIDTH * 2);
      const text = textLines[i] ?? '';
      const combined = `${art}   ${text}`;
      const pad = width - stripAnsi(combined).length - 1;
      frameLines.push('│ ' + combined + ' '.repeat(Math.max(0, pad)) + '│');
    }
    frameLines.push(bottom);

    if (frame > 0) {
      // Move cursor up to overwrite the previous frame.
      process.stdout.write(`\x1b[${frameLines.length}A`);
    }
    process.stdout.write(frameLines.join('\n') + '\n');
    await delay(45);
  }

  // Finish with a quick color pulse on the blocks.
  for (let pulse = 0; pulse < 3; pulse++) {
    const shifted = LOGO_GRADIENT.slice(pulse % LOGO_GRADIENT.length).concat(
      LOGO_GRADIENT.slice(0, pulse % LOGO_GRADIENT.length),
    );
    const artLines: string[] = [];
    for (let y = 0; y < LOGO_HEIGHT; y++) {
      let row = '';
      for (let x = 0; x < LOGO_WIDTH; x++) {
        if (!LOGO_SHAPE[y]![x]) {
          row += '  ';
          continue;
        }
        row += (shifted[x % shifted.length] ?? palette.primary)('██');
      }
      artLines.push(row);
    }

    const textLines = [
      palette.bold('AgentUsageStats'),
      palette.muted('Local-first AI usage analyzer'),
      '',
      palette.muted(`v${version ?? '0.1.0'}`),
    ];

    const frameLines: string[] = [top];
    for (let i = 0; i < inner.length; i++) {
      const art = artLines[i] ?? ' '.repeat(LOGO_WIDTH * 2);
      const text = textLines[i] ?? '';
      const combined = `${art}   ${text}`;
      const pad = width - stripAnsi(combined).length - 1;
      frameLines.push('│ ' + combined + ' '.repeat(Math.max(0, pad)) + '│');
    }
    frameLines.push(bottom);

    process.stdout.write(`\x1b[${frameLines.length}A`);
    process.stdout.write(frameLines.join('\n') + '\n');
    await delay(60);
  }
}

export function maybePrintBanner(options: { json?: boolean }, version?: string): void {
  if (options.json || !isInteractive()) return;
  printLogo(version);
  console.log();
}

export async function maybePrintBannerAnimated(options: { json?: boolean }, version?: string): Promise<void> {
  if (options.json || !isInteractive()) {
    maybePrintBanner(options, version);
    return;
  }
  await printLogoAnimated(version);
  console.log();
}

export function printSection(title: string): void {
  console.log('\n' + palette.bold(title));
  console.log(palette.muted('─'.repeat(stripAnsi(title).length + 4)));
}

export function horizontalBar(
  value: number,
  max: number,
  width = 24,
  color: ChalkInstance = palette.primary,
): string {
  const ratio = max > 0 ? Math.min(value / max, 1) : 0;
  const filled = Math.max(0, Math.round(ratio * width));
  const empty = Math.max(0, width - filled);
  return color('█'.repeat(filled)) + palette.muted('░'.repeat(empty));
}

// --------------------------------------------------------------------------
// Table renderer with truncation, terminal width awareness and ANSI safety.
// --------------------------------------------------------------------------

export interface TableOptions {
  align?: Array<'left' | 'right' | 'center'>;
  maxWidths?: Array<number | undefined>;
  /** When a cell exceeds its max width, truncate from the start for path-like columns. */
  truncateStart?: boolean[];
  padding?: number;
}

export function truncateText(text: string, max: number, fromStart = false): string {
  const visible = stripAnsi(text);
  if (visible.length <= max) return text;
  if (max <= 3) return '…'.repeat(max);

  // Preserve ANSI codes that wrap the whole cell so styled text keeps its color after truncation.
  const leadingMatch = text.match(/^(\x1b\[[0-9;]*m)+/);
  const trailingMatch = text.match(/(\x1b\[[0-9;]*m)+$/);
  const leading = leadingMatch ? leadingMatch[0] : '';
  const trailing = trailingMatch ? trailingMatch[0] : '';
  const stripped = leading
    ? text.slice(leading.length, trailing ? -trailing.length : undefined)
    : visible;

  if (fromStart) {
    const keep = stripped.slice(-(max - 3));
    return leading + '…' + keep + trailing;
  }
  return leading + stripped.slice(0, max - 3) + '…' + trailing;
}

function visibleWidth(text: string): number {
  // Strip ANSI, then account for East Asian wide characters approximately.
  const stripped = stripAnsi(text);
  let width = 0;
  for (const char of stripped) {
    width += char.charCodeAt(0) > 255 ? 2 : 1;
  }
  return width;
}

function pad(text: string, width: number, dir: 'left' | 'right' | 'center'): string {
  const v = visibleWidth(text);
  const spaces = Math.max(0, width - v);
  if (dir === 'right') return ' '.repeat(spaces) + text;
  if (dir === 'left') return text + ' '.repeat(spaces);
  const left = Math.floor(spaces / 2);
  const right = spaces - left;
  return ' '.repeat(left) + text + ' '.repeat(right);
}

export function formatTable(
  headers: string[],
  rows: string[][],
  options: TableOptions = {},
): string[] {
  const align = options.align ?? [];
  const maxWidths = options.maxWidths ?? [];
  const truncateStart = options.truncateStart ?? [];
  const padding = options.padding ?? 1;

  const terminalWidth = process.stdout.columns ?? 120;

  // Compute natural widths.
  let widths: number[] = headers.map((h, i) => {
    const cellWidths = rows.map((r) => visibleWidth(r[i] ?? ''));
    return Math.max(visibleWidth(h), ...cellWidths);
  });

  // Apply explicit max widths and re-measure.
  widths = widths.map((w, i) => {
    const max = maxWidths[i];
    if (max && w > max) return max;
    return w;
  });

  // If the table would overflow the terminal, proportionally shrink columns
  // that have an explicit max width set. Columns without a max width keep their
  // natural size and rely on the caller to truncate if desired.
  const borderOverhead = 2 + (widths.length - 1) * 3 + 2; // rough border/padding
  const contentWidth = widths.reduce((a, b) => a + b, 0) + widths.length * padding * 2;
  const totalWidth = contentWidth + borderOverhead;
  if (totalWidth > terminalWidth) {
    const overflow = totalWidth - terminalWidth;
    const flexibleCols = widths
      .map((w, i) => ({ i, w, max: maxWidths[i] }))
      .filter((c): c is { i: number; w: number; max: number } => typeof c.max === 'number' && c.w > 8);
    if (flexibleCols.length > 0) {
      const totalFlexible = flexibleCols.reduce((a, c) => a + c.w, 0);
      for (const c of flexibleCols) {
        const share = (c.w / totalFlexible) * overflow;
        widths[c.i] = Math.max(8, Math.floor(c.w - share));
      }
    }
  }

  const padSpaces = ' '.repeat(padding);
  const separator = widths.map((w) => '─'.repeat(w + padding * 2)).join('┼');
  const top = widths.map((w) => '─'.repeat(w + padding * 2)).join('┬');
  const bottom = widths.map((w) => '─'.repeat(w + padding * 2)).join('┴');

  const headerRow =
    '│' +
    headers
      .map((h, i) => {
        const cell = truncateText(h, widths[i]!);
        return `${padSpaces}${palette.bold(pad(cell, widths[i]!, align[i] ?? 'left'))}${padSpaces}`;
      })
      .join('│') +
    '│';

  const dataRows = rows.map((row) => {
    const cells = row.map((cell, i) => {
      const max = widths[i] ?? visibleWidth(cell);
      const truncated =
        visibleWidth(cell) > max
          ? truncateText(cell, max, truncateStart[i])
          : cell;
      const aligned = pad(truncated, max, align[i] ?? 'left');
      return `${padSpaces}${aligned}${padSpaces}`;
    });
    return '│' + cells.join('│') + '│';
  });

  return ['┌' + top + '┐', headerRow, '├' + separator + '┤', ...dataRows, '└' + bottom + '┘'];
}

export function printTable(
  headers: string[],
  rows: string[][],
  align?: Array<'left' | 'right' | 'center'>,
  maxWidths?: Array<number | undefined>,
): void;
export function printTable(headers: string[], rows: string[][], options?: TableOptions): void;
export function printTable(
  headers: string[],
  rows: string[][],
  alignOrOptions?: Array<'left' | 'right' | 'center'> | TableOptions,
  maxWidths?: Array<number | undefined>,
): void {
  let options: TableOptions;
  if (Array.isArray(alignOrOptions)) {
    options = { align: alignOrOptions, maxWidths };
  } else {
    options = alignOrOptions ?? {};
  }
  console.log(formatTable(headers, rows, options).join('\n'));
}

export function infoBox(title: string, rows: Array<{ label: string; value: string }>): void {
  const labelWidth = Math.max(...rows.map((r) => visibleWidth(r.label)));
  const valueWidth = Math.max(...rows.map((r) => visibleWidth(r.value)), visibleWidth(title));
  const width = labelWidth + valueWidth + 5;

  console.log('┌' + '─'.repeat(width) + '┐');
  console.log('│ ' + pad(palette.bold(title), width - 1, 'left') + '│');
  console.log('├' + '─'.repeat(width) + '┤');
  for (const { label, value } of rows) {
    const line = `${pad(palette.muted(label), labelWidth, 'right')}: ${value}`;
    console.log('│ ' + pad(line, width - 1, 'left') + '│');
  }
  console.log('└' + '─'.repeat(width) + '┘');
}

// --------------------------------------------------------------------------
// GitHub-style contribution / activity calendar.
// --------------------------------------------------------------------------

export interface ActivityDay {
  date: string;
  value: number;
}

export interface ActivityCalendarOptions {
  title?: string;
  metric?: 'tokens' | 'cost' | 'sessions';
  weeks?: number;
  color?: ChalkInstance;
  emptyColor?: ChalkInstance;
}

const ACTIVITY_BOXES = ['░', '▒', '▓', '█'];

export function renderActivityCalendar(
  days: ActivityDay[],
  options: ActivityCalendarOptions = {},
): string[] {
  const metric = options.metric ?? 'tokens';
  const weeksToShow = options.weeks ?? 26;
  const color = options.color ?? palette.primary;
  const emptyColor = options.emptyColor ?? palette.muted;

  const today = new Date();
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const start = new Date(end);
  start.setDate(start.getDate() - weeksToShow * 7 + 1);
  // Align start to Sunday.
  while (start.getDay() !== 0) {
    start.setDate(start.getDate() - 1);
  }

  const valueByDate = new Map<string, number>();
  for (const d of days) {
    valueByDate.set(d.date, (valueByDate.get(d.date) ?? 0) + d.value);
  }

  const values = Array.from(valueByDate.values()).filter((v) => v > 0);
  const max = values.length > 0 ? Math.max(...values) : 1;
  const levels = [0, max * 0.25, max * 0.5, max * 0.75];

  const shortDays = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  // 7 rows (days) x N columns (weeks)
  const grid: string[][] = Array.from({ length: 7 }, () => []);
  const dateLabels: string[][] = Array.from({ length: 7 }, () => []);

  const cursor = new Date(start);
  while (cursor <= end) {
    const dateStr = cursor.toISOString().slice(0, 10);
    const value = valueByDate.get(dateStr) ?? 0;
    const day = cursor.getDay();
    const level = levels.findIndex((threshold) => value <= threshold);
    const intensity = level === -1 ? levels.length - 1 : level;
    const box = value === 0 ? emptyColor(ACTIVITY_BOXES[0]) : color(ACTIVITY_BOXES[intensity]);
    grid[day]!.push(box);
    dateLabels[day]!.push(`${dateStr}: ${formatActivityValue(value, metric)}`);
    cursor.setDate(cursor.getDate() + 1);
  }

  const monthLabels: string[] = [];
  let lastMonth = -1;
  const cursor2 = new Date(start);
  while (cursor2 <= end) {
    if (cursor2.getDay() === 0) {
      const month = cursor2.getMonth();
      if (month !== lastMonth) {
        monthLabels.push(cursor2.toLocaleString('en-US', { month: 'short' }));
        lastMonth = month;
      } else {
        monthLabels.push('   ');
      }
    }
    cursor2.setDate(cursor2.getDate() + 1);
  }

  const pad = '     ';
  const output: string[] = [];
  if (options.title) {
    output.push(palette.bold(options.title));
  }
  output.push(pad + monthLabels.join(' '));
  for (let d = 1; d < 7; d++) {
    const label = (shortDays[d] ?? ' ').padEnd(3);
    output.push(`${label}${grid[d]?.join(' ') ?? ''}`);
  }
  // Sunday at the bottom to match GitHub layout (Sun-Sat top to bottom)
  output.push(`${shortDays[0]!.padEnd(3)}${grid[0]?.join(' ') ?? ''}`);

  const legend = `Less ${emptyColor(ACTIVITY_BOXES[0])} ${color(ACTIVITY_BOXES[1])} ${color(ACTIVITY_BOXES[2])} ${color(ACTIVITY_BOXES[3])} More`;
  const referenceLine = output[1] ?? '';
  const referenceWidth = visibleWidth(referenceLine);
  const legendWidth = visibleWidth(legend);
  const legendPad = Math.max(0, referenceWidth - legendWidth);
  output.push('');
  output.push(' '.repeat(legendPad) + legend);
  return output;
}

export function printActivityCalendar(days: ActivityDay[], options?: ActivityCalendarOptions): void {
  console.log(renderActivityCalendar(days, options).join('\n'));
}

function formatActivityValue(value: number, metric: string): string {
  if (metric === 'cost') return `$${value.toFixed(2)}`;
  if (metric === 'sessions') return `${Math.round(value)} sessions`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M tokens`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K tokens`;
  return `${Math.round(value)} tokens`;
}

export class Spinner {
  private timer?: NodeJS.Timeout;
  private frame = 0;
  private active = false;
  private readonly frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

  constructor(
    private readonly label: string,
    private readonly color: ChalkInstance = palette.primary,
  ) {}

  start(): this {
    if (!process.stdout.isTTY) {
      console.log(`${this.label}...`);
      return this;
    }
    this.active = true;
    process.stdout.write('\x1b[?25l');
    this.render();
    this.timer = setInterval(() => {
      this.frame = (this.frame + 1) % this.frames.length;
      this.render();
    }, 80);
    return this;
  }

  stop(success = true, message?: string): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    if (!this.active && !process.stdout.isTTY) {
      console.log(`${this.label}: ${message ?? (success ? 'done' : 'failed')}`);
      return;
    }
    const icon = success ? palette.success('✓') : palette.error('✗');
    const text = message ?? (success ? 'done' : 'failed');
    process.stdout.write(`\r\x1b[K${icon} ${this.color(this.label)} ${palette.muted(text)}\n`);
    process.stdout.write('\x1b[?25h');
    this.active = false;
  }

  private render(): void {
    process.stdout.write(`\r\x1b[K${this.color(this.frames[this.frame])} ${this.color(this.label)}`);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}
