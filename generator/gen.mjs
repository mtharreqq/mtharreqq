// Builds the GitHub profile SVGs (see README.md here) in Requixite's style: Geist (subset,
// embedded), the site's chat bubbles, light + dark.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import subsetFont from "subset-font";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");
const sharp = require("sharp");

const SRC = new URL("./source/", import.meta.url).pathname;
const OUT = process.argv[2] ?? new URL("../assets/", import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });

const FONT = fs.readFileSync(`${SRC}geist-latin.woff2`);
const AVATAR = (await sharp(`${SRC}avatar.png`).resize(96, 96).png().toBuffer()).toString("base64");

const THEMES = {
  light: { bub: "#f5f5f5", text: "#0a0a0a", meBg: "#0a0a0a", meText: "#fafafa", dot: "#a3a3a3", border: "#e5e5e5",
    muted: "#737373", card: "#ffffff", line: "#f0f0f0", sk: "#ececec", icBorder: "#ebebeb", badgeBg: "#f0fdf4", badgeText: "#166534", green: "#22c55e", shadow: 0 },
  dark: { bub: "#262626", text: "#fafafa", meBg: "#fafafa", meText: "#0a0a0a", dot: "#8a8a8a", border: "#3a3a3a",
    muted: "#a3a3a3", card: "#171717", line: "#262626", sk: "#2a2a2a", icBorder: "#2e2e2e", badgeBg: "#052e16", badgeText: "#86efac", green: "#22c55e", shadow: 0 },
};
const FAMILY = `Geist, 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', system-ui, sans-serif`;
const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

// ---- text measuring in a real browser, with the real font ----
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
const page = await browser.newPage();
await page.setContent(`<style>@font-face{font-family:Geist;font-weight:100 900;src:url(data:font/woff2;base64,${FONT.toString("base64")})}</style><span style="font-family:Geist">x</span>`);
await page.evaluate(() => document.fonts.ready);
const measure = (text, size, weight = 400) =>
  page.evaluate(
    ([t, s, w, f]) => {
      const c = document.createElement("canvas").getContext("2d");
      c.font = `${w} ${s}px ${f}`;
      return c.measureText(t).width;
    },
    [text, size, weight, FAMILY],
  );

async function fontFace(texts) {
  const chars = [...new Set(texts.join(""))].join("");
  const sub = await subsetFont(FONT, chars, { targetFormat: "woff2", variationAxes: { wght: { min: 400, max: 600 } } });
  return `@font-face{font-family:Geist;font-weight:400 600;src:url(data:font/woff2;base64,${sub.toString("base64")}) format("woff2")}`;
}

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Bubble shape: 20px corners, the tail corner 6px (site: rounded-[20px] rounded-bl-md).
function bubblePath(x, y, w, h, tail) {
  const R = Math.min(20, h / 2), r = 6;
  const tl = R, tr = R, br = tail === "br" ? r : R, bl = tail === "bl" ? r : R;
  return `M${x + tl},${y}H${x + w - tr}A${tr},${tr} 0 0 1 ${x + w},${y + tr}V${y + h - br}A${br},${br} 0 0 1 ${x + w - br},${y + h}H${x + bl}A${bl},${bl} 0 0 1 ${x},${y + h - bl}V${y + tl}A${tl},${tl} 0 0 1 ${x + tl},${y}Z`;
}

const avatar = (x, y, cls = "", style = "") =>
  `<g class="${cls}" style="${style}"><clipPath id="av${x}${y}"><circle cx="${x + 20}" cy="${y + 20}" r="20"/></clipPath><image href="data:image/png;base64,${AVATAR}" x="${x}" y="${y}" width="40" height="40" clip-path="url(#av${x}${y})"/></g>`;

const baseCss = (t) => `
  text{font-family:${FAMILY};fill:${t.text}}
  .me text{fill:${t.meText}}
  .a{opacity:0;transform-box:fill-box;transform-origin:0% 100%;animation:pop .4s ${EASE} both}
  .me.a{transform-origin:100% 100%}
  @keyframes pop{from{opacity:0;transform:translateY(8px) scale(.94)}to{opacity:1;transform:none}}
  @keyframes hide{to{opacity:0;visibility:hidden}}
  .dots circle{fill:${t.dot};animation:dot 1s ease-in-out infinite;transform-box:fill-box}
  .dots circle:nth-child(2){animation-delay:.15s}.dots circle:nth-child(3){animation-delay:.3s}
  @keyframes dot{0%,60%,100%{transform:translateY(0);opacity:.55}30%{transform:translateY(-3px);opacity:1}}
  @media (prefers-reduced-motion:reduce){.a{animation:none!important;opacity:1}.typing{display:none}}`;

// Line-wrap a message to fit maxW.
async function wrap(text, size, weight, maxW) {
  const words = text.split(" "), lines = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (cur && (await measure(next, size, weight)) > maxW) { lines.push(cur); cur = w; } else cur = next;
  }
  lines.push(cur);
  return lines;
}

// A message: {text, size, weight, side:'me'|'you'}
async function bubble(msg, maxW) {
  const size = msg.size ?? 17, weight = msg.weight ?? 400;
  const padX = size > 20 ? 18 : 15, padY = size > 20 ? 11 : 10, lh = Math.round(size * 1.38);
  const lines = await wrap(msg.text, size, weight, maxW - padX * 2);
  const tw = Math.max(...(await Promise.all(lines.map((l) => measure(l, size, weight)))));
  return { ...msg, size, weight, padX, padY, lh, lines, w: Math.ceil(tw + padX * 2), h: lines.length * lh + padY * 2 };
}

function drawBubble(b, x, y, t, tail) {
  const fill = b.side === "me" ? t.meBg : t.bub;
  const tx = b.lines
    .map((l, i) => `<text x="${x + b.padX}" y="${y + b.padY + i * b.lh + b.lh / 2}" dominant-baseline="central" font-size="${b.size}" font-weight="${b.weight}"${b.size > 20 ? ' letter-spacing="-0.3"' : ""}>${esc(l)}</text>`)
    .join("");
  return `<path d="${bubblePath(x, y, b.w, b.h, tail)}" fill="${fill}"/>${tx}`;
}

const typingBubble = (x, y, t) =>
  `<path d="${bubblePath(x, y, 62, 40, "bl")}" fill="${t.bub}"/><g class="dots"><circle cx="${x + 19}" cy="${y + 20}" r="3.5"/><circle cx="${x + 31}" cy="${y + 20}" r="3.5"/><circle cx="${x + 43}" cy="${y + 20}" r="3.5"/></g>`;

// ---------------- hello: three bubbles, typing first ----------------
const W = 600, BX = 52, MAXW = W - BX - 30;
// Every gap between messages is GAP. Each image keeps GAP/2 above and below,
// so two images meet at GAP (README sets align="top" so GitHub adds nothing).
const GAP = 8;
const LOGOS = {};
for (const [k, f] of [["telkomsigma", "logos/telkomsigma.png"], ["rantai", "logos/rantai.png"], ["telkomuniversity", "logos/telkomuniversity.png"]])
  LOGOS[k] = (await sharp(`${SRC}${f}`).resize(72, 72, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer()).toString("base64");

async function hero(theme) {
  const t = THEMES[theme];
  const mine = await Promise.all([
    bubble({ text: "Hi, I’m MTharreq 👋", size: 28, weight: 600 }, MAXW),
    bubble({ text: "Product engineer & designer in Bandung" }, MAXW),
    bubble({ text: "I fix vibecoded apps so they stop looking vibecoded" }, MAXW),
  ]);
  const T = { av: 0.1, b: [0.1, 0.28, 0.46] };
  let y = 4, out = "";
  mine.forEach((b, i) => { out += `<g class="a" style="animation-delay:${T.b[i]}s">${drawBubble(b, BX, y, t, "bl")}</g>`; y += b.h + GAP; });
  y -= GAP;
  out += avatar(0, y - 40, "a", `animation-delay:${T.av}s`);
  return svg(W, y + GAP / 2, `${await fontFace(mine.flatMap((b) => b.lines))}${baseCss(t)}`, out,
    "Hi, I’m MTharreq. Product engineer and designer in Bandung. I fix vibecoded apps so they stop looking vibecoded.");
}

// ---------------- now: a bubble, then a "generated" card ----------------
const SPARK = (x, y, s, fill) => `<path transform="translate(${x} ${y}) scale(${s / 24})" fill="${fill}" d="M12 1.5l2.1 6.6 6.9 2.4-6.9 2.4L12 19.5l-2.1-6.6L3 10.5l6.9-2.4z"/>`;

// "Updated Nov 2026": the month this was built, so it moves with every rebuild.
const TITLE = "Experience";
const UPDATED = `Updated ${new Date().toLocaleString("en-US", { month: "short", year: "numeric" })}`;

async function now(theme) {
  const t = THEMES[theme];
  const T0 = 0.85; // after the hello finishes
  const at = (s) => (T0 + s).toFixed(2);
  const intro = await bubble({ text: "Here’s what I’m up to right now:" }, MAXW);
  const rows = [
    { icon: "telkomsigma", title: "Frontend Developer · Telkomsigma", sub: "Enterprise apps with Next.js, React, and Vue", meta: "2025 — now" },
    { icon: "rantai", title: "Product Developer · RantAI", sub: "Redesigned and rebuilt rantai.dev, with its own CMS", meta: "2025 — now" },
    { icon: "telkomuniversity", title: "Computer Engineering · Telkom University", sub: "GPA 3.93 · three UI/UX competition wins", meta: "2020 — 2024" },
  ];
  const badge = "Open to work";

  let y = GAP / 2, out = "";
  // intro bubble
  out += `<g class="a" style="animation-delay:${at(0)}s">${drawBubble(intro, BX, y, t, "bl")}</g>`;
  y += intro.h + GAP;
  // card
  const CX = BX, CW = W - BX - 2, HH = 50, RH = 62;
  const CH = HH + rows.length * RH;
  const cy = y;
  let card = `<path d="${bubblePath(CX + 0.5, cy + 0.5, CW - 1, CH - 1, "bl").replace(/A20,20/g, "A18,18")}" fill="${t.card}" stroke="${t.border}"${t.shadow ? ' filter="url(#sh)"' : ""}/>`;
  // header
  card += `<text x="${CX + 16}" y="${cy + HH / 2}" dominant-baseline="central" font-size="15" font-weight="600">${TITLE}</text>`;
  const nowW = await measure(TITLE, 15, 600);
  card += `<text x="${CX + 16 + nowW + 10}" y="${cy + HH / 2}" dominant-baseline="central" font-size="13" style="fill:${t.muted}">${esc(UPDATED)}</text>`;
  const bw = Math.ceil((await measure(badge, 12, 500)) + 20), bx = CX + CW - 14 - bw;
  card += `<g class="f" style="animation-delay:${at(1.0)}s"><rect x="${bx}" y="${cy + HH / 2 - 12}" width="${bw}" height="24" rx="12" fill="${t.badgeBg}"/><text x="${bx + bw / 2}" y="${cy + HH / 2}" dominant-baseline="central" text-anchor="middle" font-size="12" font-weight="500" style="fill:${t.badgeText}">${esc(badge)}</text></g>`;
  card += `<line x1="${CX + 1}" x2="${CX + CW - 1}" y1="${cy + HH}" y2="${cy + HH}" stroke="${t.line}"/>`;

  for (const [i, r] of rows.entries()) {
    const ry = cy + HH + i * RH, mid = ry + RH / 2, d = at(0.5 + i * 0.15);
    if (i) card += `<line x1="${CX + 1}" x2="${CX + CW - 1}" y1="${ry}" y2="${ry}" stroke="${t.line}"/>`;
    // skeleton
    card += `<g class="sk" style="animation:pulse .8s ease-in-out ${at(0.25)}s infinite, hide .15s ${d}s forwards"><rect x="${CX + 16}" y="${mid - 18}" width="36" height="36" rx="10" fill="${t.sk}"/><rect x="${CX + 64}" y="${mid - 11}" width="${CW * 0.42}" height="10" rx="5" fill="${t.sk}"/><rect x="${CX + 64}" y="${mid + 5}" width="${CW * 0.6}" height="8" rx="4" fill="${t.sk}"/></g>`;
    // content
    let ic = `<rect x="${CX + 16.5}" y="${mid - 17.5}" width="35" height="35" rx="10" fill="${theme === "dark" ? "#ffffff" : t.card}" stroke="${t.icBorder}"/>`;
    ic += r.icon === "spark"
      ? SPARK(CX + 23, mid - 11, 22, "#f5b400")
      : `<image href="data:image/png;base64,${LOGOS[r.icon]}" x="${CX + 22}" y="${mid - 12}" width="24" height="24"/>`;
    card += `<g class="f" style="animation-delay:${d}s">${ic}
      <text x="${CX + 64}" y="${mid - 9}" dominant-baseline="central" font-size="15" font-weight="500">${esc(r.title)}</text>
      <text x="${CX + 64}" y="${mid + 11}" dominant-baseline="central" font-size="13" style="fill:${t.muted}">${esc(r.sub)}</text>
      <text x="${CX + CW - 16}" y="${mid}" dominant-baseline="central" text-anchor="end" font-size="13" style="fill:${t.muted}">${esc(r.meta)}</text></g>`;
  }
  out += `<g class="card" style="animation-delay:${at(0.25)}s">${card}</g>`;
  y = cy + CH + GAP / 2;

  // an avatar beside the last message group
  out += avatar(0, cy + CH - 40, "a", `animation-delay:${at(0)}s`);

  const css = `${await fontFace([intro.text, badge, TITLE, UPDATED, ...rows.flatMap((r) => [r.title, r.sub, r.meta])])}${baseCss(t)}
  .f{opacity:0;animation:fade .35s ${EASE} both}
  @keyframes fade{from{opacity:0;filter:blur(2px)}to{opacity:1;filter:none}}
  .card{opacity:0;transform-box:fill-box;transform-origin:50% 0;animation:grow .4s ${EASE} both}
  @keyframes grow{from{opacity:0;transform:translateY(6px) scale(.98)}to{opacity:1;transform:none}}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.45}}
  @media (prefers-reduced-motion:reduce){.f,.card{animation:none!important;opacity:1}.sk{display:none}}`;
  const defs = t.shadow ? `<defs><filter id="sh" x="-5%" y="-5%" width="110%" height="120%"><feDropShadow dx="0" dy="4" stdDeviation="6" flood-opacity="${t.shadow}"/></filter></defs>` : "";
  return svg(W, y, css, defs + out,
    "What I’m up to: Frontend Developer at Telkomsigma (2025–now). Product Developer at RantAI, rebuilt rantai.dev and its CMS. Computer Engineering, Telkom University, GPA 3.93. Open to work.");
}

// ---------------- talk: closing bubble ----------------
async function closing(theme) {
  const t = THEMES[theme];
  const b = await bubble({ text: "Got an app that needs some love, or a job for me? Let’s chat 👇" }, MAXW);
  const out = `<g class="a" style="animation-delay:1.85s">${drawBubble(b, BX, GAP / 2, t, "bl")}${avatar(0, GAP / 2 + b.h - 40)}</g>`;
  return svg(W, GAP / 2 + b.h + GAP, `${await fontFace(b.lines)}${baseCss(t)}`, out, "Got an app that needs some love, or a job for me? Let’s chat.");
}

// ---------------- pills ----------------
const ICONS = {
  globe: `<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></g>`,
  mail: `<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></g>`,
  x: `<path fill="currentColor" d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z"/>`,
  linkedin: `<path fill="currentColor" d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.064 2.064 0 1 1 0-4.128 2.064 2.064 0 0 1 0 4.128zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>`,
  spark: `<path fill="currentColor" d="M12 1.5l2.1 6.6 6.9 2.4-6.9 2.4L12 19.5l-2.1-6.6L3 10.5l6.9-2.4z"/>`,
  file: `<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M16 13H8M16 17H8M10 9H8"/></g>`,
};
// A button. With a label: icon + text pill. With only a title: a round icon button.
async function pill(theme, label, icon, primary, title = label, delay = 0, inset = 0) {
  const t = THEMES[theme];
  const size = 15, H = 40, padX = 16, ic = 16, gap = 8;
  const W = inset + (label ? Math.ceil(padX + ic + gap + (await measure(label, size, 500)) + padX) : H);
  const bg = primary ? t.meBg : "none", fg = primary ? t.meText : t.text, stroke = primary ? t.meBg : t.border;
  const ix = label ? padX : (H - ic) / 2;
  const body = `<g class="a" style="animation-delay:${delay}s"><g transform="translate(${inset} 0)"><rect x="0.5" y="0.5" width="${W - inset - 1}" height="${H - 1}" rx="${(H - 1) / 2}" fill="${bg}" stroke="${stroke}"/>
<svg x="${ix}" y="${(H - ic) / 2}" width="${ic}" height="${ic}" viewBox="0 0 24 24" color="${fg}">${ICONS[icon]}</svg>${label ? `
<text x="${padX + ic + gap}" y="${H / 2}" dominant-baseline="central" font-size="${size}" font-weight="500" style="fill:${fg}">${esc(label)}</text>` : ""}</g></g>`;
  return svg(W, H, `${label ? await fontFace([label]) : ""}${baseCss(t)}`, body, title);
}

function svg(w, h, css, body, title) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${Math.ceil(h)}" viewBox="0 0 ${w} ${Math.ceil(h)}" role="img" aria-label="${esc(title)}"><title>${esc(title)}</title><style>${css}</style>${body}</svg>\n`;
}

const PILLS = [
  ["site", "requixite.my.id", "globe", true, "requixite.my.id", 2.1, BX], // inset lines it up with the bubbles
  ["email", "", "mail", false, "Email", 2.15],
  ["x", "", "x", false, "X @tooreeq", 2.2],
  ["linkedin", "", "linkedin", false, "LinkedIn", 2.25],
  ["cv", "", "file", false, "CV (PDF)", 2.3],
];
for (const theme of ["light", "dark"]) {
  fs.writeFileSync(path.join(OUT, `hello-${theme}.svg`), await hero(theme));
  fs.writeFileSync(path.join(OUT, `now-${theme}.svg`), await now(theme));
  fs.writeFileSync(path.join(OUT, `talk-${theme}.svg`), await closing(theme));
  for (const [name, label, icon, primary, title, delay, inset] of PILLS)
    fs.writeFileSync(path.join(OUT, `${name}-${theme}.svg`), await pill(theme, label, icon, primary, title, delay, inset));
}
await browser.close();
for (const f of fs.readdirSync(OUT)) console.log(f, fs.statSync(path.join(OUT, f)).size);
