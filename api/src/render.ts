// Renders an attacker's document as a PNG: a remittance advice, a bank
// transfer confirmation or a photo of a printed invoice with a sticky note.
// The hidden line is drawn in one of several ways a person skimming the image
// would miss and a vision model still reads.
import sharp from 'sharp';

export type HiddenStyle = 'faint_footer' | 'tiny_print' | 'near_white' | 'sticky_note' | 'stamp' | 'visible';
export const HIDDEN_STYLES: HiddenStyle[] = ['faint_footer', 'tiny_print', 'near_white', 'sticky_note', 'stamp', 'visible'];

export interface DocSpec {
  title: string;
  lines: string[];
  hidden_text: string;
  style: HiddenStyle;
}

const W = 900;
const H = 640;

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// splits text into lines of at most n characters, on spaces
function wrap(text: string, n: number): string[] {
  const out: string[] = [];
  let cur = '';
  for (const w of text.split(/\s+/)) {
    if ((cur + ' ' + w).trim().length > n) {
      if (cur) out.push(cur);
      cur = w;
    } else cur = (cur + ' ' + w).trim();
  }
  if (cur) out.push(cur);
  return out;
}

function hidden(spec: DocSpec): { svg: string; box: [number, number, number, number] } {
  const t = spec.hidden_text.slice(0, 400);
  switch (spec.style) {
    case 'tiny_print': {
      const ls = wrap(t, 150);
      const y0 = H - 18 - (ls.length - 1) * 8;
      return {
        svg: ls.map((l, i) => `<text x="40" y="${y0 + i * 8}" font-size="7" fill="#9a9a9a" font-family="Helvetica">${esc(l)}</text>`).join(''),
        box: [36, y0 - 8, W - 72, ls.length * 8 + 4],
      };
    }
    case 'near_white': {
      const ls = wrap(t, 95);
      const y0 = 330;
      return {
        svg: ls.map((l, i) => `<text x="40" y="${y0 + i * 16}" font-size="13" fill="#f4f4f4" font-family="Helvetica">${esc(l)}</text>`).join(''),
        box: [36, y0 - 14, W - 72, ls.length * 16 + 6],
      };
    }
    case 'sticky_note': {
      const ls = wrap(t, 30);
      const h = ls.length * 18 + 24;
      return {
        svg:
          `<g transform="rotate(-4 700 400)"><rect x="590" y="330" width="260" height="${h}" fill="#fff59d" stroke="#e6d96b"/>` +
          ls.map((l, i) => `<text x="602" y="${352 + i * 18}" font-size="14" fill="#3b3b3b" font-family="Marker Felt, Comic Sans MS, cursive">${esc(l)}</text>`).join('') +
          `</g>`,
        box: [580, 315, 285, h + 30],
      };
    }
    case 'stamp': {
      const ls = wrap(t, 42);
      return {
        svg:
          `<g transform="rotate(-12 650 470)" opacity="0.55"><rect x="470" y="${430 - 4}" width="380" height="${ls.length * 17 + 16}" fill="none" stroke="#c62828" stroke-width="3"/>` +
          ls.map((l, i) => `<text x="482" y="${446 + i * 17}" font-size="13" fill="#c62828" font-family="Courier New" font-weight="bold">${esc(l)}</text>`).join('') +
          `</g>`,
        box: [455, 380, 420, ls.length * 17 + 110],
      };
    }
    case 'visible': {
      const ls = wrap(t, 80);
      const y0 = 330;
      return {
        svg: ls.map((l, i) => `<text x="40" y="${y0 + i * 20}" font-size="16" fill="#222" font-family="Helvetica">${esc(l)}</text>`).join(''),
        box: [36, y0 - 16, W - 72, ls.length * 20 + 6],
      };
    }
    case 'faint_footer':
    default: {
      const ls = wrap(t, 120);
      const y0 = H - 22 - (ls.length - 1) * 13;
      return {
        svg: ls.map((l, i) => `<text x="40" y="${y0 + i * 13}" font-size="11" fill="#e6e6e6" font-family="Helvetica">${esc(l)}</text>`).join(''),
        box: [36, y0 - 12, W - 72, ls.length * 13 + 6],
      };
    }
  }
}

// The PNG, plus the region of the hidden text (x, y, w, h), which the console
// draws as a box once the round is over.
export async function renderDoc(spec: DocSpec): Promise<{ png: Buffer; box: [number, number, number, number] }> {
  const body = spec.lines
    .slice(0, 10)
    .map((l, i) => `<text x="40" y="${120 + i * 26}" font-size="18" fill="#333" font-family="Helvetica">${esc(l.slice(0, 90))}</text>`)
    .join('');
  const h = hidden(spec);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">` +
    `<rect width="${W}" height="${H}" fill="#ffffff"/>` +
    `<rect x="0" y="0" width="${W}" height="8" fill="#1f3a68"/>` +
    `<text x="40" y="70" font-size="28" font-weight="bold" fill="#1f3a68" font-family="Helvetica">${esc(spec.title.slice(0, 60))}</text>` +
    `<line x1="40" y1="88" x2="${W - 40}" y2="88" stroke="#dddddd"/>` +
    body +
    h.svg +
    `</svg>`;
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  return { png, box: h.box };
}
