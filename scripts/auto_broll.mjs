// One-shot automatic b-roll for a project (spec: references/autofill.md). No npm deps; Claude/stock optional.
//   node auto_broll.mjs <timeline.json> [--density thua|vua|day|ratday] [--src preset,text,emoji,media,stock] [--claude] [--seed 1]
//                       [--dry] [--clear] [--out other.json]
// Mixes procedural catalog presets (matched per sentence, no template repeated within 3, palette from pack/brand), keyword hero
// text pops, emoji pops on highlighted/emotional words, the project's own media/ and (with "stock") Commons/Openverse photos.
// Layouts rotate (card / right / left / pip / full / person-behind) and never cover TL.face; full layouts last 1–1.5 s.
// Skips 0–1.5 s, the outro/title card and existing non-auto big scenes. Every inserted scene has _auto:true -> a re-run replaces
// only those (scenes you edited — _orig — are kept). Writes the timeline in place (timeline.json.bak first). Progress: "@@ p step".
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { search as stockSearch, fetchMedia, sentences } from './ai_broll.mjs';
import { spawnClaude } from './platform.mjs';

const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const has = k => args.includes(k);
const say = (p, s) => console.log(`@@ ${p.toFixed(2)} ${s}`);
const fold = s => String(s).toLowerCase().replace(/đ/g, 'd').normalize('NFD').replace(/[̀-ͯ]/g, '');
const r2 = v => Math.round(v * 100) / 100;

const DENS = { thua: 8, vua: 5, day: 3, ratday: 2, 'rat day': 2, 'rất dày': 2, 'thưa': 8, 'vừa': 5, 'dày': 3 };
const PACK_PAL = { slate: 'ocean', hypecam: 'ember', bubble: 'ember', basic: 'violet', course: 'forest', luxury: 'gold', neon: 'neon', keynote: 'mono',
  glow: 'sunset', podcast: 'violet', kinetic: 'candy', realestate: 'gold', review: 'ember', share: 'sunset', split: 'ocean', transform: 'violet',
  greenscreen: 'ocean', news: 'ocean', multicam: 'neon', qa: 'violet', topn: 'ember', cinema: 'mono', beatslide: 'neon', screencast: 'ocean' };
const SECOND = { ember: 'gold', neon: 'violet', ocean: 'violet', forest: 'ocean', gold: 'ember', violet: 'neon', mono: 'ember', sunset: 'violet', light: 'candy', candy: 'light' };
const PAL_HUE = { ember: 8, neon: 190, ocean: 200, forest: 150, gold: 42, violet: 260, sunset: 340 };
const NUM_TPL = ['counter_big', 'bar_chart', 'line_chart', 'pie', 'progress'];
const BG_TPL = new Set(['particles', 'blobs', 'wave_lines', 'hex_grid', 'grid_tunnel', 'starfield', 'equalizer']);
const GENERIC = ['sunburst', 'rings', 'icon_hero', 'spotlight', 'particles', 'glitch_text', 'starfield', 'quote_card', 'wave_lines'];
const STOP = new Set(('la va thi ma cua cac nhung mot cai nay do day kia roi da se dang co duoc bi cho voi de tu den o tren duoi trong ngoai ' +
  'ban chung ta toi minh em anh chi no ho nguoi ai gi sao nao the vay nhe a ah oi u um nhu khi neu vi nen cung con van chi can phai ' +
  'lam di len xuong ra vao bay gio hien nay luc sau truoc nua hay hoac rat qua lam nhieu it moi tung ca hon nhat ma thi dau').split(' '));
const EMOJI = [['tien', '💰'], ['doanh thu', '📈'], ['tang', '📈'], ['giam', '📉'], ['nhanh', '⚡'], ['thoi gian', '⏰'], ['phut', '⏱️'], ['gio', '⏰'],
  ['ai', '🤖'], ['robot', '🤖'], ['video', '🎬'], ['clip', '🎬'], ['edit', '✂️'], ['thanh cong', '🏆'], ['chuc', '🎉'], ['vui', '😄'], ['buon', '😢'],
  ['bat ngo', '😱'], ['soc', '😱'], ['yeu', '❤️'], ['thich', '😍'], ['hot', '🔥'], ['y tuong', '💡'], ['sai', '❌'], ['dung', '✅'], ['dien thoai', '📱'],
  ['may tinh', '💻'], ['nha', '🏠'], ['can ho', '🏢'], ['xe', '🚗'], ['hoc', '📚'], ['suc khoe', '💪'], ['cong cu', '🛠️'], ['tool', '🛠️'], ['de', '👌'],
  ['kho', '😓'], ['cam on', '🙏'], ['nhac', '🎵'], ['hinh anh', '🖼️'], ['anh', '📸'], ['chu', '🔤'], ['phong chu', '🔤'], ['keo tha', '🖱️'], ['tu dong', '⚙️'],
  ['hieu ung', '✨'], ['dep', '✨'], ['tuyet', '🤩'], ['wow', '🤩'], ['khach hang', '🤝'], ['ban hang', '🛒'], ['mien phi', '🎁'], ['qua', '🎁'],
  ['muc tieu', '🎯'], ['tien hoa', '🚀'], ['phat trien', '🚀'], ['xa', '🚀'], ['bi mat', '🤫'], ['canh bao', '⚠️'], ['nguy hiem', '⚠️'], ['nghi', '🤔'], ['hoi', '❓']];
const EMOTION = new Set(['tuyet', 'wow', 'bat ngo', 'soc', 'yeu', 'thich', 'vui', 'buon', 'thanh cong', 'chuc', 'hot', 'dep', 'tien hoa', 'tu dong', 'mien phi', 'bi mat', 'canh bao', 'nhanh chong', 'de dang']);

// ---------- inputs ----------
const tlPath = path.resolve(args[0] || '');
if (!args[0] || !fs.existsSync(tlPath)) { console.error('usage: node auto_broll.mjs <timeline.json> [--density vua] [--src preset,text,emoji,media] [--claude]'); process.exit(1); }
const DIR = path.dirname(tlPath);
const TL = JSON.parse(fs.readFileSync(tlPath, 'utf8'));
const density = DENS[fold(opt('--density', 'vua')).replace(/\s+/g, ' ')] ?? DENS[opt('--density', 'vua')] ?? 5;
const SRC = new Set(String(opt('--src', 'preset,text,emoji,media')).split(',').map(s => s.trim()).filter(Boolean));
const SEED = +opt('--seed', 1);
let rs = SEED * 9301 + 49297; const rnd = () => ((rs = (rs * 9301 + 49297) % 233280) / 233280);

const before = (TL.scenes || []).length;
const keepScene = s => !s._auto || s._orig;
TL.scenes = (TL.scenes || []).filter(keepScene);
const removed = before - TL.scenes.length;
function write(note) {
  const out = path.resolve(opt('--out', tlPath));
  if (!has('--dry')) {
    if (out === tlPath) fs.copyFileSync(tlPath, tlPath + '.bak');
    fs.writeFileSync(out, JSON.stringify(TL, null, 1));
  }
  console.log(JSON.stringify(note));
}
if (has('--clear')) { write({ removed, added: 0 }); process.exit(0); }

let caps = TL.captions;
if (typeof caps === 'string') caps = JSON.parse(fs.readFileSync(path.resolve(DIR, caps), 'utf8'));
if (!Array.isArray(caps) || !caps.length) { const f = path.join(DIR, 'work/captions.json'); caps = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : []; }
caps = caps.filter(c => !c.hidden && c.words?.length);
if (!caps.length) { console.error('LỖI: chưa có phụ đề — cần lời thoại để chọn b-roll'); process.exit(2); }
const WORDS = caps.flatMap(c => c.words.filter(w => w.w).map(w => ({ w: w.w, s: +w.s, e: +w.e, hl: !!w.hl, f: fold(w.w).replace(/[^a-z0-9%$]/g, '') })));
const DUR = TL.duration || caps.at(-1).t1;
const VERT = (TL.height || 720) > (TL.width || 1280);
const [DW, DH] = VERT ? [720, 1280] : [1280, 720];
const face = TL.face || (VERT ? { x: 360, y: 520 } : { x: 760, y: 300 });
const FR = { x: face.x, y: face.y, rx: Math.max(VERT ? 150 : 160, (face.w || 0) * .65), ry: Math.max(VERT ? 180 : 190, (face.h || 0) * .65) };
// person-behind needs real cutouts and the speaker drawn full-frame (not inside a slate card)
const CUT = !!((TL.clips || []).length ? TL.clips.some(c => c.cutouts) : TL.aroll?.cutouts) && !(TL.scenes || []).some(s => s.type === 'frame_grid' && !s._auto);
// keep clear of the slate badge / pack headers at the very top in vertical
const TOPMIN = VERT ? ((TL.scenes || []).some(s => s.type === 'frame_grid' && s.badge !== false) ? 200 : 100) : 60;
let cardFlip = 0;

// ---------- palette: pack default, brand accent wins ----------
function hueOf(hex) {
  const m = /^#?([\da-f]{6})$/i.exec(String(hex || '').trim()); if (!m) return null;
  const [r, g, b] = [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16) / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (d < .12) return null;
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}
let PAL = PACK_PAL[TL.pack] || 'ember';
const bh = hueOf(TL.brand?.accent) ?? hueOf(TL.brand?.primary);
if (bh != null) PAL = Object.entries(PAL_HUE).sort((a, b) => Math.min(Math.abs(a[1] - bh), 360 - Math.abs(a[1] - bh)) - Math.min(Math.abs(b[1] - bh), 360 - Math.abs(b[1] - bh)))[0][0];
const PAL2 = SECOND[PAL] || 'violet';

// ---------- blocked windows ----------
const BASE_RX = /(frame|grade|scrim|progress|dip|letterbox|backdrop|wave|cursor|facecam|grid_bg|waveform|^mood$|lowerthird|ticker|names)/;
const SMALL = new Set(['emoji_pop', 'sticker', 'stickers', 'pill', 'question_marks', 'flash_ring', 'light_leak', 'iris', 'ring', 'black']);
const OUTRO_RX = /(title_card|end_card|outro|endcard|follow_cta|_cta$|credits)/;
const blocks = [[0, 1.5, 'all']];
let outroAt = DUR - .6;
for (const s of TL.scenes) {
  if (s.hidden) continue;
  const t0 = +s.t0 || 0, t1 = +s.t1 || t0;
  if (OUTRO_RX.test(s.type) && t0 > DUR * .5) outroAt = Math.min(outroAt, t0);
  if (BASE_RX.test(s.type) || t1 - t0 > DUR * .6) continue;
  blocks.push([t0 - .2, t1 + .2, SMALL.has(s.type) ? 'small' : 'all']);
}
blocks.push([outroAt - .3, DUR + 1, 'all']);
const lastSpeech = WORDS.at(-1)?.e ?? DUR;
const END = Math.min(outroAt - .3, lastSpeech + .3, DUR - .6);
const blockedAt = (t0, t1, kind) => blocks.find(([a, b, k]) => t0 < b && t1 > a && (k === 'all' || kind === 'text' || kind === 'emoji'));

// ---------- geometry (never over the face) ----------
const hitsFace = ([x, y, w, h]) => {
  const cx = Math.max(x, Math.min(FR.x, x + w)), cy = Math.max(y, Math.min(FR.y, y + h));
  return ((cx - FR.x) / FR.rx) ** 2 + ((cy - FR.y) / FR.ry) ** 2 < 1;
};
function boxFor(lay) {
  const fit = (w, h) => [Math.round(w), Math.round(h)];
  if (VERT) {
    const top = FR.y - FR.ry - 30, botY = Math.max(FR.y + FR.ry + 30, 870);
    if (lay === 'card') {
      const cands = [];
      const hT = Math.min(360, top - TOPMIN); if (hT >= 180) { const [w, h] = fit(Math.min(640, hT * 16 / 9), hT); cands.push([(DW - w) / 2, Math.max(TOPMIN, top - h), w, h]); }
      const hB = Math.min(360, DH - 90 - botY); if (hB >= 180) { const [w, h] = fit(Math.min(640, hB * 16 / 9), hB); cands.push([(DW - w) / 2, botY, w, h]); }
      const ok = cands.filter(b => !hitsFace(b)).sort((a, b) => b[3] - a[3]);
      return ok.length > 1 && Math.abs(ok[0][3] - ok[1][3]) < 60 ? ok[cardFlip++ % 2] : ok[0];
    }
    if (lay === 'right' || lay === 'left') {
      const [w, h] = [330, 186], y = Math.max(TOPMIN, Math.min(top - h, 260));
      const b = [lay === 'right' ? DW - w - 28 : 28, y, w, h];
      if (!hitsFace(b)) return b;
      const b2 = [lay === 'right' ? DW - w - 28 : 28, botY, w, h];
      return hitsFace(b2) ? null : b2;
    }
    if (lay === 'pip') { const b = [FR.x > DW / 2 ? 28 : DW - 328, 70, 300, 169]; return hitsFace(b) ? null : b; }
    return null;
  }
  const B = { card: [190, 90, 900, 506], right: [660, 70, 580, 326], left: [40, 70, 580, 326], pip: [860, 60, 380, 214] }[lay];
  if (!B) return null;
  if (!hitsFace(B)) return B;
  if (lay === 'card') { const b = [FR.x > DW / 2 ? 40 : 660, 70, 580, 326]; return hitsFace(b) ? null : b; }
  if (lay === 'pip') { const b = [FR.x > DW / 2 ? 40 : 860, 60, 380, 214]; return hitsFace(b) ? null : b; }
  return null;
}
const LAYOUTS = ['card', 'right', 'full', 'pip', 'person', 'left'];
let layI = 0;
function nextLayout(allowFull = true) {
  for (let k = 0; k < LAYOUTS.length; k++) {
    const lay = LAYOUTS[(layI + k) % LAYOUTS.length];
    if (lay === 'full' && !allowFull) continue;
    if (lay === 'person' && !CUT) continue;
    if (lay === 'full' || lay === 'person' || boxFor(lay)) { layI += k + 1; return lay; }
  }
  layI++; return 'full';
}
const textY = () => {
  const top = FR.y - FR.ry - 70;
  return VERT ? (top >= 150 ? Math.round(Math.max(170, top - 30)) : Math.round(Math.min(DH - 260, FR.y + FR.ry + 120))) : Math.round(top >= 90 ? Math.max(100, top) : Math.min(DH - 150, FR.y + FR.ry + 70));
};
function emojiXY(size) {
  const right = FR.x + FR.rx + size * .55, left = FR.x - FR.rx - size * .55;
  const x = right + size / 2 < DW - 10 ? right : left - size / 2 > 10 ? left : FR.x + (FR.x > DW / 2 ? -1 : 1) * (FR.rx + size * .6);
  return [Math.round(Math.max(size / 2 + 10, Math.min(DW - size / 2 - 10, x))), Math.round(Math.max(size / 2 + 60, FR.y - FR.ry * .55))];
}

// ---------- language helpers ----------
const catalog = JSON.parse(fs.readFileSync(path.join(SKILL, 'assets/broll/catalog.json'), 'utf8'));
const tsv = {};
for (const l of fs.readFileSync(path.join(SKILL, 'assets/broll/keywords_vi_en.tsv'), 'utf8').split('\n')) if (l.includes('\t') && !l.startsWith('#')) { const [vi, en] = l.split('\t'); tsv[fold(vi)] = en.trim(); }
const wordsIn = (t0, t1) => WORDS.filter(w => w.s >= t0 - .05 && w.s < t1);
const emojiFor = ws => { const f = ' ' + ws.map(w => w.f).join(' ') + ' '; const hit = EMOJI.find(([k]) => f.includes(' ' + k + ' ')); return hit && { emoji: hit[1], key: hit[0] }; };
const emotional = ws => ws.some(w => w.hl) || (() => { const f = ' ' + ws.map(w => w.f).join(' ') + ' '; return [...EMOTION].some(k => f.includes(' ' + k + ' ')); })();
function numberIn(ws) {
  for (let i = 0; i < ws.length; i++) {
    const m = /^(\d+(?:[.,]\d+)?)(%|k)?$/.exec(ws[i].w.replace(/[^\d.,%k]/gi, ''));
    if (m && /\d/.test(ws[i].w)) {
      const unit = m[2] === '%' ? '%' : ws[i + 1] && !/\d/.test(ws[i + 1].w) && !STOP.has(ws[i + 1].f) ? ws[i + 1].w.toUpperCase() : '';
      return { num: parseFloat(m[1].replace(',', '.')), unit, at: ws[i].s, word: ws[i] };
    }
  }
  return null;
}
function keyword(ws, max = 3) {
  // longest run of content words (≤ max syllables), preferring a run that hits the b-roll catalog tags
  let best = null;
  for (let i = 0; i < ws.length; i++) for (let n = Math.min(max, ws.length - i); n >= 1; n--) {
    const run = ws.slice(i, i + n);
    if (run.some(w => STOP.has(w.f) || !w.f)) continue;
    const f = run.map(w => w.f).join(' '), score = n * 2 + (tsv[f] ? 3 : 0) + (run.some(w => w.hl) ? 4 : 0) + (catalog.some(e => e.pal === PAL && e.tags?.some(t => fold(t) === f)) ? 3 : 0);
    if (!best || score > best.score) best = { score, text: run.map(w => w.w).join(' ').toUpperCase(), f, at: run[0].s };
  }
  return best;
}
const ABSTRACT = new Set(['thanh cong', 'y tuong', 'muc tieu', 'ke hoach', 'chien luoc', 'dong luc', 'hanh trinh', 'tu duy', 'kien thuc', 'tuong lai', 'van de', 'giai phap', 'co hoi', 'rui ro', 'that bai', 'hanh phuc', 'kinh nghiem', 'phat trien', 'hieu qua', 'chat luong']);
const concrete = ws => { const f = ws.map(w => w.f); for (let i = 0; i < f.length; i++) for (let n = 3; n >= 1; n--) { const k = f.slice(i, i + n).join(' '); if (n <= f.length - i && tsv[k] && !STOP.has(k) && !ABSTRACT.has(k)) return { vi: k, en: tsv[k] }; } return null; };
function presets(text, pal, avoid, numeric) {
  const q = fold(text).split(/[^a-z0-9%]+/).filter(w => w.length > 1 && !STOP.has(w)), bi = q.slice(1).map((w, i) => q[i] + ' ' + w);
  const scored = [];
  for (const e of catalog) {
    if (e.pal !== pal || avoid.has(e.template)) continue;
    if (numeric && !(numeric === '%' ? ['pie', 'progress', 'counter_big', 'bar_chart'] : ['counter_big', 'bar_chart', 'line_chart']).includes(e.template)) continue;
    const hay = fold([...(e.tags || []), e.topic, e.text].join(' | '));
    let s = 0; for (const b of bi) if (hay.includes(b)) s += 3; for (const w of q) if (new RegExp(`(^|[^a-z])${w}([^a-z]|$)`).test(hay)) s += 1;
    if (BG_TPL.has(e.template)) s -= .5;
    if (s > 0 || numeric) scored.push([s + rnd() * .3, e]);
  }
  scored.sort((a, b) => b[0] - a[0]);
  const out = []; for (const [, e] of scored) { if (out.some(o => o.template === e.template)) continue; out.push(e); if (out.length >= 6) break; }
  return out;
}

// ---------- media of my own ----------
const MEDIA = [];
const mdir = path.join(DIR, 'media');
if (SRC.has('media') && fs.existsSync(mdir)) {
  for (const f of fs.readdirSync(mdir).sort()) {
    if (/^(sticker_|ai_)|_cut\.png$|^\./.test(f)) continue;
    if (/\.(jpe?g|png|webp)$/i.test(f)) MEDIA.push({ path: `media/${f}`, kind: 'image', name: f });
    else if (/\.(mp4|mov|webm)$/i.test(f)) {
      const fr = path.join(mdir, f.replace(/\.\w+$/, '') + '_frames');
      if (fs.existsSync(fr)) MEDIA.push({ kind: 'video', name: f, seq: { seq: `media/${path.basename(fr)}/%05d.jpg`, fps: 30, count: fs.readdirSync(fr).filter(x => x.endsWith('.jpg')).length } });
    }
  }
  const used = new Set((TL.scenes || []).map(s => typeof s.media === 'string' ? s.media : s.media?.seq).filter(Boolean));
  for (let i = MEDIA.length - 1; i >= 0; i--) if (used.has(MEDIA[i].path) || used.has(MEDIA[i].seq?.seq)) MEDIA.splice(i, 1);
}

// ---------- plan slots ----------
say(.05, 'Đọc lời thoại');
const sents = sentences(caps);
const slots = [];
let t = 1.5 + Math.min(.6, density * .1);
const TEXT_STY = TL.pack === 'slate' ? ['grad_teal', 'hl', 'grad_blue', 'yellow'] : ['yellow', 'fire', 'white', 'glow', 'ink'];
let kindI = 0, lastEmoji = -9, lastText = -9, stockN = 0;
const usedNum = new Set();
while (t < END - .8) {
  const snap = WORDS.filter(w => w.s >= t - .5 && w.s <= t + .8).sort((a, b) => Math.abs(a.s - t) - Math.abs(b.s - t))[0];
  const t0 = snap ? snap.s : t;
  const sent = sents.find(s => t0 >= s.t0 - .05 && t0 < s.t1) || sents.find(s => s.t0 > t0) || sents.at(-1);
  const ws = wordsIn(t0, Math.min(END, t0 + Math.max(2.2, density * .8)));
  const wsSent = sent ? wordsIn(sent.t0, sent.t1 + .05) : ws;
  let num = numberIn(ws); if (num && usedNum.has(num.at)) num = null;
  const emo = emojiFor(ws), conc = concrete(wsSent);
  let kind;
  if (num && SRC.has('preset')) kind = 'preset_num';
  else if (SRC.has('emoji') && emo && emotional(ws) && slots.length - lastEmoji >= (density <= 2 ? 3 : 2)) kind = 'emoji';
  else if (SRC.has('stock') && conc && stockN < 3 && slots.length % 3 === 2) kind = 'stock';
  else if (MEDIA.length && slots.length % 3 === 1) kind = 'media';
  else {
    const rot = ['preset', 'text', 'preset', 'preset', 'text'].filter(k => SRC.has(k));
    kind = rot.length ? rot[kindI++ % rot.length] : SRC.has('emoji') && emo ? 'emoji' : MEDIA.length ? 'media' : null;
    if (kind === 'text' && slots.length - lastText < 2 && SRC.has('preset')) kind = 'preset';
  }
  if (!kind) break;
  const cardDur = Math.min(3.4, Math.max(1.6, density * .7));
  let dur = { emoji: Math.min(1.4, density * .6), text: Math.min(1.8, Math.max(1.1, density * .45)) }[kind] ?? cardDur;
  let t1 = Math.min(END, t0 + dur);
  const b = blockedAt(t0, t1, kind.startsWith('preset') || kind === 'media' || kind === 'stock' ? 'card' : kind);
  if (b) { t = Math.max(t + .5, b[1] + .1); continue; }
  if (t1 - t0 < .9) break;
  if (kind === 'preset_num') usedNum.add(num.at);
  slots.push({ i: slots.length, kind, t0: r2(t0), t1: r2(t1), ws, wsSent, sent, num: kind === 'preset_num' ? num : null, emo, conc });
  if (kind === 'emoji') lastEmoji = slots.length - 1;
  if (kind === 'text') lastText = slots.length - 1;
  if (kind === 'stock') stockN++;
  t = t0 + density * (.85 + rnd() * .3);
  if (t < t1 + .15) t = t1 + .15;
}
say(.2, `${slots.length} chỗ chèn (mỗi ~${density} s)`);

// ---------- presets (offline match, or Claude) ----------
const recent = [];
const avoidSet = () => new Set(recent.slice(-3));
for (const s of slots.filter(s => s.kind.startsWith('preset'))) {
  const pal = s.i % 4 === 3 ? PAL2 : PAL;
  s.pal = pal;
  s.cands = presets((s.wsSent || s.ws).map(w => w.w).join(' '), pal, avoidSet(), s.kind === 'preset_num' && (s.num?.unit === '%' ? '%' : 'n'));
  if (!s.cands.length) s.cands = presets('', pal, avoidSet(), true).slice(0, 0);
  const pick = s.cands[0] || (() => { const tp = GENERIC.find(g => !avoidSet().has(g)) || 'sunburst'; return { template: tp, pal, id: null, text: '' }; })();
  s.preset = pick; recent.push(pick.template);
  const kw = keyword(s.ws) || keyword(s.wsSent || []);
  s.text = kw?.text;
}
let claudeNote = '';
if (has('--claude') && slots.length) {
  say(.3, 'Hỏi Claude chọn b-roll + chữ (20–60 giây)');
  try {
    const req = slots.map(s => ({ i: s.i, kind: s.kind.startsWith('preset') ? 'preset' : s.kind, t0: s.t0, t1: s.t1, sentence: s.sent?.text || s.ws.map(w => w.w).join(' '),
      ...(s.kind.startsWith('preset') ? { presets: [...new Map([...(s.cands || []), ...presets(s.sent?.text || '', s.pal, new Set(), false)].map(e => [e.id, e])).values()].slice(0, 8).map(e => ({ id: e.id, template: e.template, text: e.text })) } : {}) }));
    const prompt = `Bạn là editor video ngắn tiếng Việt. Video dọc/ngang có các chỗ chèn b-roll (JSON). Với MỖI chỗ:
- nếu kind = "preset": chọn "id" đúng một id trong "presets" của chính chỗ đó (minh hoạ đúng ý câu, không lặp template với 3 chỗ trước), và "text" = chữ ngắn IN HOA tiếng Việt có dấu, ≤ 18 ký tự, tóm ý câu;
- nếu kind = "text": "text" = 1–3 từ khoá IN HOA đắt nhất của câu (≤ 18 ký tự);
- nếu kind = "emoji": "emoji" = 1 emoji hợp cảm xúc câu.
Trả về DUY NHẤT một mảng JSON, không giải thích: [{"i":0,"id":"...","text":"..."},{"i":1,"text":"..."},{"i":2,"emoji":"🔥"}]

${JSON.stringify(req)}`;
    const out = await new Promise((ok, bad) => {
      const p = spawnClaude(['-p', '--output-format', 'json', '--model', opt('--model', 'sonnet')], { stdio: ['pipe', 'pipe', 'pipe'] }); p.stdin.on('error', () => {}); p.stdin.end(prompt);
      let o = '', e = ''; const tm = setTimeout(() => { p.kill(); bad(new Error('Claude quá 150 giây')); }, 150000);
      p.stdout.on('data', d => (o += d)); p.stderr.on('data', d => (e += d));
      p.on('error', () => { clearTimeout(tm); bad(new Error('Không tìm thấy Claude Code CLI (lệnh "claude")')); });
      p.on('close', c => { clearTimeout(tm); c ? bad(new Error(`claude -p lỗi (mã ${c}): ${(e || o).slice(-200)}`)) : ok(o); });
    });
    let txt = out; try { txt = JSON.parse(out).result ?? out; } catch {}
    const m = String(txt).match(/\[[\s\S]*\]/); if (!m) throw new Error('Claude không trả về JSON');
    let n = 0;
    for (const x of JSON.parse(m[0])) {
      const s = slots[x.i]; if (!s) continue;
      if (s.kind.startsWith('preset') && x.id) { const e = catalog.find(c => c.id === x.id); if (e && e.pal === s.pal) { s.preset = e; n++; } }
      if (x.text && typeof x.text === 'string') s.text = x.text.slice(0, 22).toUpperCase();
      if (s.kind === 'emoji' && x.emoji && [...x.emoji].length <= 3) s.emo = { emoji: x.emoji };
    }
    // keep the "no template within 3" rule even if Claude repeated one
    for (let i = 0, rec = []; i < slots.length; i++) {
      const s = slots[i]; if (!s.kind.startsWith('preset')) continue;
      if (rec.slice(-3).includes(s.preset.template)) s.preset = (s.cands || []).find(e => !rec.slice(-3).includes(e.template)) || s.preset;
      rec.push(s.preset.template);
    }
    claudeNote = `Claude chọn ${n} preset`;
  } catch (e) { claudeNote = `Claude lỗi → dùng luật offline (${e.message})`; console.log(claudeNote); }
}

// ---------- stock photos (Commons/Openverse, no key) ----------
for (const s of slots.filter(s => s.kind === 'stock')) {
  try {
    say(.5, `Tìm ảnh stock: ${s.conc.en}`);
    const r = await stockSearch(s.conc.vi, { kind: 'photo', src: 'commons,openverse', n: 4, en: s.conc.en });
    const it = r.items.find(x => (x.w || 1000) >= 640) || r.items[0];
    if (!it) throw new Error('không có kết quả');
    const m = await fetchMedia(it.url, DIR, { kind: 'photo', name: s.conc.en.split(' ')[0], vertical: VERT, meta: { author: it.author, license: it.license, provider: it.provider, page: it.page, title: it.title } });
    s.media = { path: m.path, credit: `${it.author || ''} · ${it.license || ''} · ${it.provider}` };
  } catch (e) { console.log(`stock "${s.conc.en}" bỏ qua: ${e.message}`); s.kind = SRC.has('preset') ? 'preset' : 'text'; if (s.kind === 'preset') { s.pal = PAL; s.preset = presets(s.sent?.text || '', PAL, avoidSet(), false)[0] || { template: 'sunburst', pal: PAL }; s.text = keyword(s.ws)?.text; } }
}

// ---------- build scenes ----------
say(.75, 'Đặt b-roll lên timeline');
const added = [];
let styI = 0, mediaI = 0;
const fitSize = (txt, size, w = DW - 80) => Math.max(34, Math.min(size, Math.floor(w / (Math.max(1, [...String(txt)].length) * .62))));
for (const s of slots) {
  const base = { t0: s.t0, t1: s.t1, _auto: true, note: 'tự động' };
  if (s.kind === 'text') {
    const kw = s.text ? { text: s.text } : keyword(s.ws) || keyword(s.wsSent || []);
    if (!kw) continue;
    const size = fitSize(kw.text, VERT ? 84 : 92);
    added.push({ ...base, type: 'text', hideCaptions: false,
      lines: [{ text: kw.text, t: s.t0, style: TEXT_STY[styI++ % TEXT_STY.length], size, x: DW / 2, y: textY(), anim: ['pop', 'blur_zoom', 'slide_l', 'drop', 'tumble'][styI % 5] }] });
    continue;
  }
  if (s.kind === 'emoji') {
    const size = VERT ? 150 : 130, [x, y] = emojiXY(size);
    added.push({ ...base, type: 'emoji_pop', src: s.emo.emoji, x, y, size });
    continue;
  }
  if (s.kind === 'media' || s.kind === 'stock') {
    const m = s.kind === 'media' ? MEDIA[mediaI++ % MEDIA.length] : s.media;
    if (!m) continue;
    const media = m.seq ? { ...m.seq, t0: s.t0 } : m.path;
    let lay = nextLayout(true);
    if (lay === 'person') lay = 'full';
    const box = lay === 'full' ? null : boxFor(lay);
    if (lay === 'full' || !box) added.push({ ...base, t1: r2(Math.min(s.t1, s.t0 + 1.4)), type: 'photo', mode: 'full', media, kb: .1, ...(m.credit ? { credit: m.credit } : {}) });
    else added.push({ ...base, type: 'photo', mode: 'card', media, card: { x: box[0], y: box[1], w: box[2], h: box[3], r: 20 }, ...(m.credit ? { credit: m.credit } : {}) });
    continue;
  }
  // presets
  const e = s.preset, num = s.num;
  const params = Object.fromEntries(Object.entries(e).filter(([k]) => !['id', 'topic', 'tags', 'score'].includes(k)));
  if (s.text) params.text = String(s.text).slice(0, 22);
  if (num) {
    params.num = num.num; if (num.unit) params.unit = num.unit;
    const near = WORDS.filter(w => Math.abs(w.s - num.at) < 1.6 && !/\d/.test(w.w));
    params.text = (keyword(near, 2)?.text || params.text || '').slice(0, 22);
  }
  params.pal = s.pal || PAL;
  const em = emojiFor(s.wsSent || s.ws); if (em) params.icon = em.emoji;
  let lay = nextLayout(true);
  if (lay === 'person' && !CUT) lay = 'card';
  const t1 = lay === 'full' ? r2(Math.min(s.t1, s.t0 + 1.5)) : s.t1;
  if (lay === 'person') {
    delete params.text; delete params.sub; // the speaker stands in front: a pure animated background reads better
    added.push({ ...base, t1: r2(Math.min(s.t1, s.t0 + 2.5)), type: 'broll', ...params, template: BG_TPL.has(params.template) ? params.template : ['particles', 'grid_tunnel', 'hex_grid', 'starfield'][s.i % 4], layout: 'full', person: true, ...(VERT ? { fit: 'cover' } : {}) });
    continue;
  }
  const box = lay === 'full' ? [0, 0, DW, DH] : boxFor(lay);
  if (!box) continue;
  if (VERT) added.push({ ...base, t1, type: 'media_card', card: { x: box[0], y: box[1], w: box[2], h: box[3], r: lay === 'full' ? 0 : 18 }, screen: { broll: { ...(e.id ? { id: e.id } : {}), ...params } } });
  else added.push({ ...base, t1, type: 'broll', ...params, layout: lay === 'full' ? 'full' : 'card', ...(lay === 'full' ? {} : { x: box[0], y: box[1], w: box[2], h: box[3] }) });
}
TL.scenes.push(...added);
say(.95, 'Lưu');
const kinds = {}; for (const s of added) kinds[s.type] = (kinds[s.type] || 0) + 1;
write({ removed, added: added.length, kinds, density, palette: [PAL, PAL2], layouts: added.map(s => s.layout || (s.card ? (s.card.w >= DW * .95 ? 'full' : 'card') : s.mode || s.type)), claude: claudeNote || undefined,
  templates: added.map(s => s.template || s.screen?.broll?.template).filter(Boolean) });
