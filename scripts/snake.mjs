// Draws the GitHub contribution grid as an SVG, with a snake that crawls
// through every column and grows by one segment for each active day it eats.
//
// Usage (GitHub Actions):  GITHUB_TOKEN=... GITHUB_USER=Yazid-006 node scripts/snake.mjs dist/snake-papier.svg
// Usage (local preview):   SNAKE_DATA=calendar.json node scripts/snake.mjs snake.svg
//   where calendar.json is { "total": 123, "days": [{ "date": "2026-01-31", "level": 0..4 }, ...] }

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const OUT = process.argv[2] ?? 'dist/snake.svg';

const THEME = {
  card: '#f8f4ec',
  border: '#d9d0bf',
  text: '#5f594e',
  muted: '#968e7f',
  levels: ['#e6dfd0', '#b7cbb8', '#7aa18a', '#3d7a5f', '#1f5c45'],
  snake: '#1c1b18',
};

const CELL = 11;      // cell size
const GAP = 3;        // space between cells
const PITCH = CELL + GAP;
const LEFT = 40;      // room for weekday labels
const TOP = 34;       // room for month labels
const START_LENGTH = 3;
const STEP = 0.08;    // seconds per move
const MONO = `ui-monospace,'Cascadia Code','SF Mono',Consolas,'Liberation Mono',monospace`;

/* ------------------------------------------------------------ data */

const LEVEL = { NONE: 0, FIRST_QUARTILE: 1, SECOND_QUARTILE: 2, THIRD_QUARTILE: 3, FOURTH_QUARTILE: 4 };

async function loadCalendar() {
  if (process.env.SNAKE_DATA) return JSON.parse(readFileSync(process.env.SNAKE_DATA, 'utf8'));

  const user = process.env.GITHUB_USER;
  const token = process.env.GITHUB_TOKEN;
  if (!user || !token) throw new Error('GITHUB_USER and GITHUB_TOKEN are required');

  const query = `query($login: String!) {
    user(login: $login) {
      contributionsCollection {
        contributionCalendar {
          totalContributions
          weeks { contributionDays { date contributionLevel } }
        }
      }
    }
  }`;
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { login: user } }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) throw new Error(`GitHub API error: ${JSON.stringify(json.errors ?? json)}`);

  const cal = json.data.user.contributionsCollection.contributionCalendar;
  return {
    total: cal.totalContributions,
    days: cal.weeks.flatMap(w => w.contributionDays.map(d => ({ date: d.date, level: LEVEL[d.contributionLevel] ?? 0 }))),
  };
}

/* ------------------------------------------------------------ layout */

function buildGrid(days) {
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const first = new Date(sorted[0].date + 'T00:00:00Z');
  const offset = first.getUTCDay(); // GitHub weeks start on Sunday
  return sorted.map((d, i) => {
    const date = new Date(d.date + 'T00:00:00Z');
    return { ...d, date, x: Math.floor((i + offset) / 7), y: date.getUTCDay() };
  });
}

// Column by column, down then up: every cell is visited once and the snake never crosses itself.
function buildPath(columns, finalLength) {
  const path = [];
  for (let k = START_LENGTH + 1; k >= 1; k--) path.push([-k, 0]);
  for (let x = 0; x < columns; x++) {
    for (let r = 0; r < 7; r++) path.push([x, x % 2 === 0 ? r : 6 - r]);
  }
  const lastY = path[path.length - 1][1];
  for (let k = 1; k <= finalLength + 2; k++) path.push([columns - 1 + k, lastY]);
  return path;
}

/* ------------------------------------------------------------ svg */

const px = x => LEFT + x * PITCH;
const py = y => TOP + y * PITCH;
const pct = (step, total) => `${((step / total) * 100).toFixed(3)}%`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function render({ total, days }) {
  const cells = buildGrid(days);
  const columns = cells[cells.length - 1].x + 1;
  const active = cells.filter(c => c.level > 0);
  const finalLength = START_LENGTH + active.length;
  const path = buildPath(columns, finalLength);
  const steps = path.length - 1;
  const duration = (steps * STEP).toFixed(2);

  const indexOf = new Map(path.map(([x, y], i) => [`${x},${y}`, i]));
  const eatenAt = c => indexOf.get(`${c.x},${c.y}`);

  // length of the snake after each step
  const eatSteps = active.map(eatenAt).sort((a, b) => a - b);
  const appearsAt = i => (i < START_LENGTH ? 0 : eatSteps[i - START_LENGTH]); // step at which segment i exists

  const W = LEFT + columns * PITCH + 16;
  const H = TOP + 7 * PITCH + 40;
  const css = [];
  const out = [];

  // labels
  let lastLabel = -3;
  cells.forEach((c, i) => {
    if (c.y !== 0 && i !== 0) return;
    const prev = cells.find(p => p.x === c.x - 1);
    if (prev && prev.date.getUTCMonth() === c.date.getUTCMonth()) return;
    if (c.x - lastLabel < 3) return;
    lastLabel = c.x;
    out.push(`<text x="${px(c.x)}" y="${TOP - 10}" class="t">${MONTHS[c.date.getUTCMonth()]}</text>`);
  });
  [['Mon', 1], ['Wed', 3], ['Fri', 5]].forEach(([d, y]) =>
    out.push(`<text x="${LEFT - 8}" y="${py(y) + CELL - 2}" text-anchor="end" class="t">${d}</text>`));

  // empty grid
  cells.forEach(c => out.push(`<rect x="${px(c.x)}" y="${py(c.y)}" width="${CELL}" height="${CELL}" rx="2.5" fill="${THEME.levels[0]}"/>`));

  // active days, each one disappears when the head reaches it
  active.forEach((c, n) => {
    const at = eatenAt(c);
    css.push(`@keyframes e${n}{0%,${pct(at, steps)}{opacity:1}${pct(at + 0.01, steps)},100%{opacity:0}}`);
    out.push(`<rect x="${px(c.x)}" y="${py(c.y)}" width="${CELL}" height="${CELL}" rx="2.5" fill="${THEME.levels[c.level]}" style="animation:e${n} ${duration}s linear infinite"/>`);
  });

  // movement, shared by every segment; each segment simply runs it later
  css.push(`@keyframes m{${path.map(([x, y], i) => `${pct(i, steps)}{transform:translate(${x * PITCH}px,${y * PITCH}px)}`).join('')}}`);

  // snake: segment 0 is the head
  const body = [];
  for (let i = finalLength - 1; i >= 0; i--) {
    const showFrom = Math.max(0, appearsAt(i) - i); // in this segment's own timeline
    css.push(`@keyframes s${i}{0%,${pct(showFrom, steps)}{opacity:0}${pct(showFrom + 0.01, steps)},100%{opacity:1}}`);
    const fade = (1 - (i / Math.max(finalLength, 2)) * 0.55).toFixed(2);
    const inset = i === 0 ? 0 : 1;
    body.push(`<rect class="sn" x="${LEFT + inset}" y="${TOP + inset}" width="${CELL - 2 * inset}" height="${CELL - 2 * inset}" rx="${i === 0 ? 3 : 2.5}" fill="${THEME.snake}" fill-opacity="${fade}" style="animation:m ${duration}s steps(1,end) ${(i * STEP).toFixed(2)}s infinite backwards,s${i} ${duration}s linear ${(i * STEP).toFixed(2)}s infinite backwards"/>`);
  }

  const legendX = W - 16 - 5 * PITCH - 36;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${total} contributions in the last year">
<style>.t{font:11px ${MONO};fill:${THEME.muted}} .f{font:12px ${MONO};fill:${THEME.text}}
${css.join('\n')}
@media (prefers-reduced-motion: reduce){rect{animation:none!important}.sn{display:none}}</style>
<rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="12" fill="${THEME.card}" stroke="${THEME.border}"/>
<clipPath id="grid"><rect x="${LEFT}" y="${TOP}" width="${columns * PITCH - GAP}" height="${7 * PITCH - GAP}"/></clipPath>
${out.join('\n')}
<g clip-path="url(#grid)">
${body.join('\n')}
</g>
<text x="${LEFT}" y="${H - 14}" class="f">${total} contributions in the last year</text>
<text x="${legendX - 8}" y="${H - 14}" text-anchor="end" class="t">Less</text>
${THEME.levels.map((c, i) => `<rect x="${legendX + i * PITCH}" y="${H - 24}" width="${CELL}" height="${CELL}" rx="2.5" fill="${c}"/>`).join('')}
<text x="${legendX + 5 * PITCH - GAP + 8}" y="${H - 14}" class="t">More</text>
</svg>
`;
}

const calendar = await loadCalendar();
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, render(calendar));
console.log(`wrote ${OUT}: ${calendar.total} contributions, ${calendar.days.filter(d => d.level > 0).length} active days`);
