/**
 * The terminal's scrollback as HTML, for the touch history view
 * (components/Terminal/hooks/history-layer.ts): tmux's `capture-pane -e`
 * rows, coloured as xterm draws them, so the history scrolls natively on
 * the device instead of a round trip to tmux per row.
 */

export interface HistoryPalette {
  foreground: string;
  background: string;
  /** The 16 ANSI colours, black to brightWhite */
  ansi: string[];
  /** xterm's drawBoldTextInBrightColors (on unless turned off) */
  boldBright: boolean;
  /**
   * The terminal gets true colour from tmux; else tmux sends the nearest of
   * the 256 colours, and so does the history
   */
  rgb: boolean;
}

const ANSI_KEYS = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "brightBlack",
  "brightRed",
  "brightGreen",
  "brightYellow",
  "brightBlue",
  "brightMagenta",
  "brightCyan",
  "brightWhite",
] as const;

// xterm's defaults, for a theme that leaves a colour out
const DEFAULT_ANSI = [
  "#2e3436",
  "#cc0000",
  "#4e9a06",
  "#c4a000",
  "#3465a4",
  "#75507b",
  "#06989a",
  "#d3d7cf",
  "#555753",
  "#ef2929",
  "#8ae234",
  "#fce94f",
  "#729fcf",
  "#ad7fa8",
  "#34e2e2",
  "#eeeeec",
];

export function historyPalette(
  theme: Partial<Record<string, string | undefined>> | undefined,
  boldBright = true,
  rgb = false
): HistoryPalette {
  return {
    foreground: theme?.foreground ?? "#ffffff",
    background: theme?.background ?? "#000000",
    ansi: ANSI_KEYS.map((k, i) => theme?.[k] ?? DEFAULT_ANSI[i]),
    boldBright,
    rgb,
  };
}

const hex2 = (n: number) => n.toString(16).padStart(2, "0");

/** Colours 16–255 of the xterm palette: the 6×6×6 cube, then greys */
export function color256(n: number): string {
  if (n >= 232) {
    const v = 8 + (n - 232) * 10;
    return `#${hex2(v)}${hex2(v)}${hex2(v)}`;
  }
  const i = n - 16;
  const level = (c: number) => (c === 0 ? 0 : 55 + c * 40);
  return `#${hex2(level(Math.floor(i / 36)))}${hex2(level(Math.floor(i / 6) % 6))}${hex2(level(i % 6))}`;
}

/** tmux's colour_find_rgb: the 256 colour it sends for an RGB one */
export function nearest256(r: number, g: number, b: number): number {
  const q2c = [0x00, 0x5f, 0x87, 0xaf, 0xd7, 0xff];
  const cube = (v: number) =>
    v < 48 ? 0 : v < 114 ? 1 : Math.trunc((v - 35) / 40);
  const [qr, qg, qb] = [cube(r), cube(g), cube(b)];
  const [cr, cg, cb] = [q2c[qr], q2c[qg], q2c[qb]];
  const idx = 16 + 36 * qr + 6 * qg + qb;
  if (cr === r && cg === g && cb === b) return idx;
  const avg = Math.trunc((r + g + b) / 3);
  const greyIdx = avg > 238 ? 23 : Math.trunc((avg - 3) / 10);
  const grey = 8 + 10 * greyIdx;
  const dist = (R: number, G: number, B: number) =>
    (R - r) ** 2 + (G - g) ** 2 + (B - b) ** 2;
  return dist(grey, grey, grey) < dist(cr, cg, cb) ? 232 + greyIdx : idx;
}

// A colour: an index into the 256 palette, or RGB
type Color = number | [number, number, number] | null;

interface Style {
  fg: Color;
  bg: Color;
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  inverse: boolean;
  hidden: boolean;
  strike: boolean;
}

const plain = (): Style => ({
  fg: null,
  bg: null,
  bold: false,
  dim: false,
  italic: false,
  underline: false,
  inverse: false,
  hidden: false,
  strike: false,
});

/** Applies one SGR sequence's parameters ("1;38;5;141") to a style */
export function applySgr(style: Style, params: string): void {
  // Colon sub-parameters (38:2::r:g:b) read like semicolons
  const p = (params === "" ? "0" : params)
    .replace(/:/g, ";")
    .split(";")
    .map((s) => (s === "" ? 0 : Number(s)));
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === 0) Object.assign(style, plain());
    else if (c === 1) style.bold = true;
    else if (c === 2) style.dim = true;
    else if (c === 3) style.italic = true;
    else if (c === 4 || c === 21) style.underline = true;
    else if (c === 7) style.inverse = true;
    else if (c === 8) style.hidden = true;
    else if (c === 9) style.strike = true;
    else if (c === 22) style.bold = style.dim = false;
    else if (c === 23) style.italic = false;
    else if (c === 24) style.underline = false;
    else if (c === 27) style.inverse = false;
    else if (c === 28) style.hidden = false;
    else if (c === 29) style.strike = false;
    else if (c >= 30 && c <= 37) style.fg = c - 30;
    else if (c === 39) style.fg = null;
    else if (c >= 40 && c <= 47) style.bg = c - 40;
    else if (c === 49) style.bg = null;
    else if (c >= 90 && c <= 97) style.fg = c - 90 + 8;
    else if (c >= 100 && c <= 107) style.bg = c - 100 + 8;
    else if (c === 38 || c === 48) {
      let color: Color = null;
      if (p[i + 1] === 5) {
        color = p[i + 2] ?? 0;
        i += 2;
      } else if (p[i + 1] === 2) {
        // 38;2;r;g;b, or with a colour space id (38:2::r:g:b)
        const rgb = p.length - i >= 6 && params.includes(":") ? i + 3 : i + 2;
        color = [
          (p[rgb] ?? 0) & 255,
          (p[rgb + 1] ?? 0) & 255,
          (p[rgb + 2] ?? 0) & 255,
        ];
        i = rgb + 2;
      }
      if (c === 38) style.fg = color;
      else style.bg = color;
    }
  }
}

function resolve(color: Color, palette: HistoryPalette): string | null {
  if (color === null) return null;
  if (Array.isArray(color)) {
    if (!palette.rgb) return color256(nearest256(...color));
    return `#${color.map(hex2).join("")}`;
  }
  return color < 16 ? palette.ansi[color] : color256(color);
}

/** A colour at half strength, as xterm draws dim text */
function halfAlpha(color: string): string {
  const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(color);
  return m ? `#${m[1]}80` : color;
}

function css(style: Style, palette: HistoryPalette): string {
  let fgColor = style.fg;
  if (
    style.bold &&
    palette.boldBright &&
    typeof fgColor === "number" &&
    fgColor < 8
  )
    fgColor += 8;
  let fg = resolve(fgColor, palette);
  let bg = resolve(style.bg, palette);
  if (style.inverse) {
    [fg, bg] = [bg ?? palette.background, fg ?? palette.foreground];
  }
  const out: string[] = [];
  if (style.dim) fg = halfAlpha(fg ?? palette.foreground);
  if (style.hidden) fg = "transparent";
  if (fg) out.push(`color:${fg}`);
  if (bg) out.push(`background:${bg}`);
  if (style.bold) out.push("font-weight:var(--bold)");
  if (style.italic) out.push("font-style:italic");
  const lines = [style.underline && "underline", style.strike && "line-through"]
    .filter(Boolean)
    .join(" ");
  if (lines) out.push(`text-decoration:${lines}`);
  return out.join(";");
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"
  );

/**
 * One row of `capture-pane -e` output as HTML spans. SGR state carries from
 * the rows before (tmux only repeats what changed), so pass the same style
 * object for every row, top to bottom.
 */
export function rowToHtml(
  row: string,
  style: Style,
  palette: HistoryPalette
): string {
  let html = "";
  let text = "";
  let open = css(style, palette);
  const flush = () => {
    if (!text) return;
    html += open
      ? `<span style="${open}">${escapeHtml(text)}</span>`
      : escapeHtml(text);
    text = "";
  };
  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (ch !== "\x1b") {
      text += ch;
      continue;
    }
    const next = row[i + 1];
    if (next === "[") {
      // CSI: parameters, then a final byte
      let j = i + 2;
      while (j < row.length && !/[@-~]/.test(row[j])) j++;
      if (row[j] === "m") {
        flush();
        applySgr(style, row.slice(i + 2, j));
        open = css(style, palette);
      }
      i = j;
    } else if (next === "]") {
      // OSC (hyperlinks): up to BEL or ST
      let j = i + 2;
      while (
        j < row.length &&
        row[j] !== "\x07" &&
        !(row[j] === "\x1b" && row[j + 1] === "\\")
      )
        j++;
      i = row[j] === "\x07" ? j : j + 1;
    } else {
      i++;
    }
  }
  flush();
  return html;
}

export function newHistoryStyle(): Style {
  return plain();
}

/** Rows as HTML, each in its own element of the layer */
export function rowsToHtml(rows: string[], palette: HistoryPalette): string[] {
  const style = plain();
  return rows.map((row) => rowToHtml(row, style, palette));
}

// ---- fetching ---------------------------------------------------------------

/** What a history fetch prints first, then the rows */
export interface HistoryHeader {
  /** The pane's history rows when it ran (the visible rows not counted) */
  historySize: number;
  /** A full-screen app (vim, less): no history worth showing */
  alternate: boolean;
  /** The app reads the mouse itself: wheel events are its own */
  mouseApp: boolean;
  /** Rows tmux's copy mode is scrolled up, or 0 */
  scrolled: number;
  /** The first row printed, from the top of the screen (negative: history) */
  start: number;
  /** tmux sends this terminal true colour */
  rgb: boolean;
}

const HEADER = /^agentos-history (\d+) (\d) (\d) (\d*) (-?\d+) ?(\d?)\n/;

/**
 * Rows of the history count from its oldest row when the view opened (0).
 * `last`: the screen and the history above it, from the nearest row that's
 * a multiple of `block` at least `last` rows up. `from`–`to`: those rows,
 * wherever newer output has moved them since.
 */
export type HistoryRange =
  | { last: number; block: number }
  | { from: number; to: number };

/**
 * The shell command (run over the terminal's socket, AGENT_OS_TTY naming
 * its tmux client) that prints a header and rows of this terminal's pane.
 */
export function historyCommand(range: HistoryRange): string {
  const pane =
    // This terminal's pane, and whether tmux sends it true colour
    "read -r P R <<< \"$(tmux list-clients -F '#{client_tty} #{pane_id} #{?#{m:*RGB*,#{client_termfeatures}},1,0}' 2>/dev/null | awk -v t=\"$AGENT_OS_TTY\" '$1 == t { print $2, $3 }')\"; " +
    '[ -n "$P" ] || exit 0; ' +
    "I=$(tmux display -t \"$P\" -p '#{history_size} #{alternate_on} #{mouse_any_flag} #{?pane_in_mode,#{scroll_position},0} #{pane_height}') || exit 0; " +
    "set -- $I; ";
  const header = 'echo "agentos-history $1 $2 $3 $4 $S $R"; ';
  if ("last" in range) {
    const n = Math.max(1, Math.floor(range.last));
    const block = Math.max(1, Math.floor(range.block));
    return (
      pane +
      `A=$(( ($1 + $5 - ${n}) / ${block} * ${block} )); ` +
      "if [ $A -lt 0 ]; then A=0; fi; " +
      "S=$(( A - $1 )); " +
      header +
      'tmux capture-pane -t "$P" -p -e -N -S "$S" -E $(( $5 - 1 ))'
    );
  }
  // Each row of history that came since moves the rest up a row
  const from = Math.max(0, Math.floor(range.from));
  const to = Math.floor(range.to);
  return (
    pane +
    `S=$(( ${from} - $1 )); E=$(( ${to} - $1 )); ` +
    header +
    'if [ "$S" -le "$E" ]; then tmux capture-pane -t "$P" -p -e -N -S "$S" -E "$E"; fi'
  );
}

/** The header and rows a history command printed; null without one */
export function parseHistory(
  output: string
): { header: HistoryHeader; rows: string[] } | null {
  const m = HEADER.exec(output);
  if (!m) return null;
  const body = output.slice(m[0].length);
  const rows = body === "" ? [] : body.replace(/\n$/, "").split("\n");
  return {
    header: {
      historySize: Number(m[1]),
      alternate: m[2] === "1",
      mouseApp: m[3] === "1",
      scrolled: Number(m[4]) || 0,
      start: Number(m[5]),
      rgb: m[6] === "1",
    },
    rows,
  };
}

// ---- momentum ---------------------------------------------------------------

// Momentum decays per millisecond, like iOS scroll views (frame-rate
// independent, so a 120Hz screen coasts as far as a 60Hz one)
export const DECELERATION = 0.997;
// px/ms: below this a flick doesn't coast, and coasting stops
export const MIN_VELOCITY = 0.05;

/** Distance and velocity after coasting dt ms from velocity v (px/ms) */
export function coast(v: number, dt: number): { distance: number; v: number } {
  const decay = Math.pow(DECELERATION, dt);
  return { distance: (v * (decay - 1)) / Math.log(DECELERATION), v: v * decay };
}
