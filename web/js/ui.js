// Shared pieces: icons, the card face (port of CardView), buttons, screens, timers.
import { html, useState, useEffect, useRef } from './vendor/preact-htm.js';
import { card as cardOf, art, classIcon, classColor, rarityColor, maxHP, dmg, fusionTotal, passiveOf, packImg } from './cards.js';
import { closeScreen } from './store.js';
export { html };

// ---- icons (stand-ins for the app's SF Symbols), 24×24 ----
const P = {
  bolt: '<path fill="currentColor" d="M13 2 4 14h6l-1 8 9-12h-6z"/>',
  bag: '<path fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" d="M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2"/>',
  grid: '<path fill="currentColor" d="M3 3h5v5H3zM9.5 3h5v5h-5zM16 3h5v5h-5zM3 9.5h5v5H3zM9.5 9.5h5v5h-5zM16 9.5h5v5h-5zM3 16h5v5H3zM9.5 16h5v5h-5zM16 16h5v5h-5z"/>',
  people: '<circle cx="9" cy="8" r="3.5" fill="currentColor"/><path fill="currentColor" d="M2 20c0-3.9 3.1-7 7-7s7 3.1 7 7z"/><circle cx="17" cy="9" r="2.6" fill="currentColor" opacity=".7"/><path fill="currentColor" opacity=".7" d="M17.5 13.2c2.6.3 4.5 2.6 4.5 5.3V20h-4.4c0-2.6-1-4.9-2.6-6.5.8-.3 1.6-.4 2.5-.3z"/>',
  person: '<circle cx="12" cy="8" r="4" fill="currentColor"/><path fill="currentColor" d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8z"/>',
  x: '<path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>',
  lock: '<path d="M7 11V8a5 5 0 0 1 10 0v3" fill="none" stroke="currentColor" stroke-width="2.6"/><rect x="4" y="11" width="16" height="10" rx="2.5" fill="currentColor"/>',
  coin: '<circle cx="12" cy="12" r="9" fill="currentColor"/><circle cx="12" cy="12" r="5.5" fill="none" stroke="#1A0D05" stroke-width="1.6" opacity=".55"/>',
  right: '<path d="m9 5 7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>',
  left: '<path d="m15 5-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>',
  down: '<path d="m5 9 7 7 7-7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>',
  scroll: '<path fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" d="M6 4h11a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H8M6 4a2 2 0 0 0-2 2v2h4V6a2 2 0 0 0-2-2zM8 20a2 2 0 0 1-2-2v-2h9v2a2 2 0 0 0 2 2M10 9h6M10 12h6"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="m4 7 8 6 8-6" fill="none" stroke="currentColor" stroke-width="2"/>',
  plus: '<path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>',
  minus: '<path d="M5 12h14" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>',
  search: '<circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="m20 20-4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  clock: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7v5l3 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  swords: '<path d="M4 4l9 9M20 4l-9 9M6 17l-2 2 1 1 2-2M18 17l2 2-1 1-2-2M8 15l1 1M16 15l-1 1" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  shield: '<path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5z" fill="currentColor"/>',
  shieldo: '<path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5z" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  crown: '<path fill="currentColor" d="M3 7l4.5 4L12 4l4.5 7L21 7l-2 12H5z"/>',
  star: '<path fill="currentColor" d="m12 2 3 6.6 7.2.8-5.4 4.9 1.5 7.1L12 17.8l-6.3 3.6 1.5-7.1L1.8 9.4 9 8.6z"/>',
  trophy: '<path fill="currentColor" d="M7 3h10v2h4v3a5 5 0 0 1-5 5h-.3A5 5 0 0 1 13 15.9V18h3v3H8v-3h3v-2.1A5 5 0 0 1 8.3 13H8a5 5 0 0 1-5-5V5h4zm0 4H5v1a3 3 0 0 0 2 2.8zm10 0v3.8A3 3 0 0 0 19 8V7z"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
  recharge: '<path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
  heart: '<path fill="currentColor" d="M12 21s-8-5.2-8-11a4.5 4.5 0 0 1 8-2.9A4.5 4.5 0 0 1 20 10c0 5.8-8 11-8 11z"/>',
  wrench: '<path fill="currentColor" d="M21 7.5a5.5 5.5 0 0 1-7.3 5.2L6.4 20a2 2 0 0 1-2.8-2.8l7.3-7.3A5.5 5.5 0 0 1 17.5 3l-3 3 .8 2.7 2.7.8z"/>',
  flame: '<path fill="currentColor" d="M12 2c1 4 6 6 6 12a6 6 0 0 1-12 0c0-3 1.5-4.5 3-6 0 2 1 3 2 3 0-4-1-6 1-9z"/>',
  cross: '<path fill="currentColor" d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z"/>',
  rings: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="4.5" fill="currentColor"/>',
  swap: '<path d="M4 8h14l-3-3M20 16H6l3 3" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
  emp: '<circle cx="12" cy="12" r="2.5" fill="currentColor"/><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  swarm: '<g fill="currentColor"><circle cx="6" cy="7" r="2"/><circle cx="13" cy="5" r="1.6"/><circle cx="18" cy="9" r="2"/><circle cx="9" cy="13" r="2.2"/><circle cx="16" cy="15" r="1.7"/><circle cx="6" cy="18" r="1.6"/><circle cx="12" cy="19" r="1.8"/></g>',
  logout: '<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M9 8l-4 4 4 4M5 12h10" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  music: '<path fill="currentColor" d="M9 18a3 3 0 1 1-2-2.8V5l12-2v12a3 3 0 1 1-2-2.8V6.4l-8 1.4z"/>',
  speaker: '<path fill="currentColor" d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  info: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 11v6M12 7.5v.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
  adduser: '<circle cx="9" cy="8" r="3.5" fill="currentColor"/><path fill="currentColor" d="M2 20c0-3.9 3.1-7 7-7s7 3.1 7 7z"/><path d="M19 8v6M16 11h6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  diamond: '<path fill="currentColor" d="M12 2 22 12 12 22 2 12z"/>',
  sparkle: '<path fill="currentColor" d="M12 2c.6 4.6 3.4 7.4 8 8-4.6.6-7.4 3.4-8 8-.6-4.6-3.4-7.4-8-8 4.6-.6 7.4-3.4 8-8z"/>',
  tree: '<circle cx="12" cy="9" r="6" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 15v7M9 22h6" stroke="currentColor" stroke-width="1.8"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/>',
  map: '<path d="m3 6 6-2 6 2 6-2v14l-6 2-6-2-6 2z M9 4v14 M15 6v14" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  pencil: '<path fill="currentColor" d="M4 17.5V20h2.5L17 9.5 14.5 7zM19.7 6.8a1 1 0 0 0 0-1.4l-1.1-1.1a1 1 0 0 0-1.4 0L16 5.5 18.5 8z"/>',
  fuse: '<path fill="currentColor" d="M12 2 9 9H2l5.5 4.5L5 21l7-4.5 7 4.5-2.5-7.5L22 9h-7z"/>',
};
export const Icon = ({ name, size = 20, style = '', label }) =>
  html`<svg width=${size} height=${size} viewBox="0 0 24 24" style=${style} aria-hidden=${label ? null : 'true'} role=${label ? 'img' : null} aria-label=${label} dangerouslySetInnerHTML=${{ __html: P[name] || '' }}></svg>`;
export const Coin = ({ size = 16 }) => html`<${Icon} name="coin" size=${size} style="color: var(--brass); flex: none;" />`;
export const fmt = n => Number(n || 0).toLocaleString('en-US');

// ---- card face: same layout as the app's CardView ----
// fusion: { h, b, s, x, o, p } or null; hpNow / cooldown for battles; count / isNew pills; onClick makes it a button.
export function Card({ id, fusion, hpNow, cooldown = 0, count, isNew, selected, dim, onClick, label, class: cls = '', style = '' }) {
  const c = cardOf(id);
  if (!c) return html`<div class="card ${cls}" style=${style}><div class="cardback"></div></div>`;
  const total = fusionTotal(fusion), fused = total > 0, edge = fused ? 'var(--gold-text)' : rarityColor(c.rarity);
  const face = `linear-gradient(135deg, color-mix(in srgb, ${c.color} 38%, #12111D), color-mix(in srgb, ${c.color} 12%, #0A0912))`;
  const synth = c.cls === 'Synth';   // one of a kind: second special and passive always on, never fused
  const mhp = maxHP(c, fusion), pas = fusion?.p || synth ? passiveOf(c) : null, col = classColor(c.cls);
  const row = (name, d, cd, ready, heal, boosted) => html`<div class="mv">
      <span class="n">${name}</span>
      ${cd != null && html`<span class="cd" style="background: color-mix(in srgb, ${col} ${ready ? 28 : 60}%, transparent);">${cd}</span>`}
      <span class="d ${heal ? 'heal' : boosted ? 'gold' : ''}" style=${boosted ? 'font-weight:700' : ''}>${heal ? `+${d} HP` : d}</span></div>`;
  const body = html`<div class="face" style="--edge: ${edge}; --face: ${face};">
      <div class="top"><img src=${classIcon(c.cls)} alt=${c.cls} /><span class="nm">${c.name}</span>
        ${fused && html`<span class="crest" title="Fused ${total} times">✦ ${total}</span>`}
        <span class="hp">${hpNow != null ? `${hpNow}/${mhp}` : mhp} HP</span></div>
      <img class="art" src=${art(c.id)} alt="" loading="lazy" draggable="false" />
      <div class="moves">
        ${row(c.basic.name, dmg(c, 'basic', fusion), null, true, false, (fusion?.b || 0) > 0)}
        ${row(c.special.name, dmg(c, 'special', fusion), cooldown > 0 ? cooldown : c.special.cd, cooldown === 0, c.special.heal, (fusion?.s || 0) > 0)}
        ${(fusion?.x || synth) && c.special2 && html`<div class=${synth ? '' : 'gold'}>${row(c.special2.name, dmg(c, 'special2', fusion), c.special2.cd, true, false, !synth)}</div>`}
      </div>
      ${pas && html`<div class="pas" title=${pas.text}><${Icon} name="diamond" size="9" /><span class="pn">${pas.name}</span><span class="pv">${pas.short}</span></div>`}
      <div class="quip">${c.quip}</div>
      ${(fusion?.o || c.cls === 'Synth') && html`<div class="foil"></div>`}
    </div>
    ${count > 1 && html`<span class="pill count">×${count}</span>`}
    ${isNew && html`<span class="pill new">NEW</span>`}`;
  const k = `card ${fused ? 'fused' : ''} ${selected ? 'sel' : ''} ${dim ? 'dim' : ''} ${cls}`;
  return onClick
    ? html`<button type="button" class="cardbtn ${k}" style=${style} onClick=${onClick} aria-label=${label || `${c.name}, ${c.rarity} ${c.cls}`} aria-pressed=${selected ? 'true' : null}>${body}</button>`
    : html`<div class=${k} style=${style}>${body}</div>`;
}
export const CardBack = ({ style = '' }) => html`<div class="cardback" style=${style}></div>`;

// picture + name, for teams
export function Tile({ id, sub, fused }) {
  const c = cardOf(id);
  if (!c) return html`<div class="tile"><div class="empty"><${Icon} name="lock" size="16" /></div>${sub && html`<span class="small muted">${sub}</span>`}</div>`;
  return html`<div class="tile" style="--edge: ${fused ? 'var(--gold-text)' : classColor(c.cls) + '80'}">
    <img src=${art(id)} alt="" loading="lazy" /><span class="head" style="font-size: 13px;">${c.name}${fused ? ' ✦' : ''}</span></div>`;
}
export const Avatar = ({ id, size = 40, ring = true }) => {
  const c = cardOf(id);
  return html`<img class="avatar" src=${art(id)} alt="" width=${size} height=${size} style="width: ${size}px; height: ${size}px; border: ${ring && c ? `1.5px solid ${classColor(c.cls)}` : 0};" />`;
};
export const PackImg = ({ type, height = 60, style = '' }) => html`<img src=${packImg(type)} alt="" style="height: ${height}px; width: auto; ${style}" draggable="false" />`;
export const Bar = ({ value, max, style = '' }) => html`<div class="bar" style=${style}><i style="width: ${Math.max(0, Math.min(100, 100 * value / Math.max(max, 1)))}%"></i></div>`;
export const LockLine = ({ text }) => html`<span class="lockline"><${Icon} name="lock" size="12" />${text}</span>`;

// A full-screen view: city backdrop, a close button, optional title. `close` comes from openScreen.
export function Screen({ close, title, eyebrow, right, children, scroll = true, hideClose, class: cls = '' }) {
  const ref = useRef();
  useEffect(() => { if (!ref.current?.contains(document.activeElement)) ref.current?.focus({ preventScroll: true }); }, []);   // keyboard focus moves in
  useEffect(() => {
    const k = e => { if (e.key === 'Escape' && close && !hideClose) close(); };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [close, hideClose]);
  return html`<div class="screen city ${cls}" role="dialog" aria-modal="true" aria-label=${title || eyebrow} tabindex="-1" ref=${ref}>
    ${(title || eyebrow || !hideClose) && html`<div class="screenhead">
      ${!hideClose && html`<button class="close" onClick=${() => (close || closeScreen)()} aria-label="Close"><${Icon} name="x" /></button>`}
      <div class="col grow" style="gap: 2px;">
        ${eyebrow && html`<span class="label">${eyebrow}</span>`}
        ${title && html`<span class="h2">${title}</span>`}
      </div>
      ${right}
    </div>`}
    ${scroll ? html`<div class="scroll">${children}</div>` : children}
  </div>`;
}

export function Modal({ onClose, children, label }) {
  useEffect(() => {
    const k = e => { if (e.key === 'Escape') onClose?.(); };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [onClose]);
  return html`<div class="modal" role="dialog" aria-modal="true" aria-label=${label} onClick=${e => { if (e.target === e.currentTarget) onClose?.(); }}>
    <div class="box panel">${children}</div></div>`;
}

// ---- time ----
// Re-render every `ms` (countdowns).
export function useNow(ms = 1000) {
  const [t, setT] = useState(Date.now());
  useEffect(() => { const i = setInterval(() => setT(Date.now()), ms); return () => clearInterval(i); }, [ms]);
  return t;
}
// "4h 12m" / "12m" until a time (ms since 1970)
export function left(until) {
  const m = Math.max(0, Math.floor((until - Date.now()) / 60000));
  if (m >= 1440) return `${Math.floor(m / 1440)}d ${Math.floor(m % 1440 / 60)}h`;
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}
// "07:50:09"
export function clock(until) {
  const s = Math.max(0, Math.floor((until - Date.now()) / 1000));
  const p = n => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}:${p(Math.floor(s % 3600 / 60))}:${p(s % 60)}`;
}
export const sleep = ms => new Promise(r => setTimeout(r, ms));
// Keeps a value from the last render (for comparing changes in effects).
export function usePrevious(v) { const r = useRef(); useEffect(() => { r.current = v; }); return r.current; }
