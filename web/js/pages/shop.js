// The Shop tab, "Your packs", the Recruit Pack and the pack opening (PackTab / ShopGate / RecruitView in the app).
// Opening: drag across the top of the pack to tear it, the cards rise out, then reveal them one at a time
// (swipe or click the top card to turn it over, again for the next), and finally all of them in rows.
import { html, useState, useEffect, useRef } from '../vendor/preact-htm.js';
import { card, art, power, rarityColor, xpInto, xpNeed } from '../cards.js';
import { useStore, state, set, refresh, buyPack, buyShopCard, openPack, openRecruit, openScreen } from '../store.js';
import { Card, CardBack, Icon, Coin, Screen, Modal, PackImg, Bar, fmt, useNow, left, sleep } from '../ui.js';
import { Sound, Rip } from '../sound.js';
import { PowerCard } from './cards.js';

// prices match the server
export const PACKS = [
  { type: 'power', name: 'Power Pack', contents: '3 power cards', glow: '#B46BFF', cards: 3, price: 3000 },
  { type: 'cyber', name: 'Cyber Pack', contents: 'Fighter, Beast and Mech cards', glow: '#3FF0FF', cards: 3, price: 5000 },
  { type: 'magic', name: 'Magic Pack', contents: 'Arcanist, Spirit and Mystic cards', glow: '#B46BFF', cards: 3, price: 5000 },
  { type: 'omni', name: 'Omni Pack', contents: 'Any card from both sets', glow: '#E8B85A', cards: 3, price: 5000 },
  { type: 'overload', name: 'Overload Pack', contents: 'A guaranteed Rare or better + 7 more', glow: '#FFD77A', cards: 8, price: 12000 },
  { type: 'legends', name: 'Legends Pack', contents: 'A guaranteed Legendary + 4 more cards', glow: '#FFF3C4', cards: 5, price: 25000 },
];
const RECRUIT = { type: 'recruit', name: 'Recruit Pack', contents: 'one of the three starters', glow: '#3FF0FF', cards: 1 };
export const packInfo = t => t === 'recruit' ? RECRUIT : PACKS.find(p => p.type === t) || PACKS[1];
// A pack card's rarity: a character card or a power card ("pw:<id>").
export const packRarity = id => card(id)?.rarity ?? power(id)?.rarity ?? 'Common';

// Magic-class shop cards wait for chapter 1, like the magic packs.
const cardLock = (p, c) => ['Arcanist', 'Spirit', 'Mystic'].includes(c.cls) ? p.locked?.packs : null;
// Magic and Omni wait for chapter 1, Overload for chapter 2, Legends for chapter 3.
const packLock = (p, type) => ['cyber', 'power'].includes(type) ? null : p.locked?.[['overload', 'legends'].includes(type) ? type : 'packs'];

const BtnCoin = () => html`<${Icon} name="coin" size="15" style="color: #1A0D05; opacity: .75; flex: none;" />`;
const LockBand = ({ text }) => html`<div class="lockband"><${Icon} name="lock" size="12" /><span>${text}</span></div>`;

// ---- the Shop tab ----
export function ShopTab() {
  const s = useStore(), p = s.profile;
  if (!p) return null;
  const need = p.locked?.shop;
  if (need) return html`<div class="page shopgate">
    <div class="gatelock panel"><${Icon} name="lock" size="34" /></div>
    <span class="label">Shop</span>
    <h1 class="h1" style="text-align: center;">${need.replace('Reach player', 'Opens at player')}</h1>
    <p class="muted" style="text-align: center; margin: 0;">Daily cards and packs. Clear campaign levels and daily quests to level up.</p>
    <div class="col" style="gap: 6px; width: min(420px, 100%); margin-top: 6px;">
      <div class="row small" style="justify-content: space-between;"><span class="head">LV ${p.level}</span><span class="muted num">${fmt(xpInto(p))} / ${fmt(xpNeed(p))} XP</span></div>
      <${Bar} value=${xpInto(p)} max=${xpNeed(p)} style="height: 8px; border-radius: 4px;" />
    </div>
  </div>`;
  return html`<${Shop} p=${p} />`;
}

function Shop({ p }) {
  const [buying, setBuying] = useState(false);
  const [added, setAdded] = useState(null);
  const [zoomed, setZoomed] = useState(null);
  useNow(30000);
  useEffect(() => { set({ error: null }); if (p.shop && p.shop.next <= Date.now()) refresh(); }, []);   // a new day's shop
  const gold = p.gold, open = p.packsOpen || ['cyber'], sh = p.shop;

  const buyCard = async (slot, item) => {
    setBuying(true);
    if (await buyShopCard(slot, item.id)) Sound.play('rare');
    setBuying(false);
  };
  const buyPk = async pk => {
    setBuying(true);
    if (await buyPack(pk.type)) { setAdded(pk.type); setTimeout(() => setAdded(a => a === pk.type ? null : a), 2500); }
    setBuying(false);
  };
  const buyBtn = (item, slot, cls = '') => {
    const c = card(item.id);
    if (cardLock(p, c)) return html`<button class="btn sm wide lockedbtn ${cls}" disabled><${Icon} name="lock" size="12" />Locked</button>`;
    if (item.sold) return html`<span class="soldbtn ${cls}"><${Icon} name="check" size="12" />Bought</span>`;
    return html`<button class="btn gold sm wide ${cls}" disabled=${buying || gold < item.price} onClick=${() => buyCard(slot, item)}
      aria-label="Buy ${c.name} for ${item.price} gold"><${BtnCoin} />${fmt(item.price)}</button>`;
  };
  const rare = sh?.cards[0], rc = rare && card(rare.id);
  return html`<div class="page shop">
    <div class="shophead">
      <div class="col" style="gap: 4px;"><h1 class="h1">Shop</h1><span class="muted small">Daily cards and packs. Clear campaign levels and daily quests to earn gold.</span></div>
      <span class="chip shopgold"><${Coin} />${fmt(gold)}</span>
    </div>
    ${rc && html`
      <div class="row"><span class="label">Today in the shop</span>
        <span class="small muted" style="margin-left: auto;"><${Icon} name="clock" size="13" style="vertical-align: -2px;" /> New in <b class="head" style="color: var(--fg);">${left(sh.next)}</b></span></div>
      <div class="todayrow">
        <section class="featured panel" style="--tint: ${rarityColor(rc.rarity)};">
          <span class="label commonslabel" style="color: var(--tint); font-size: 11px;">Featured ${rc.rarity}</span>
          <div class="common">
            <button class="cbtn featcard ${rare.sold ? 'sold' : ''} ${cardLock(p, rc) ? 'locked' : ''}" onClick=${() => setZoomed(rc.id)} aria-label="Look at ${rc.name}">
              <span class="wideonly"><${Card} id=${rc.id} /></span>
              <span class="phoneonly ctile" style="--edge: ${rarityColor(rc.rarity)};"><img src=${art(rc.id)} alt="" /><span class="cname">${rc.name}</span></span>
              ${cardLock(p, rc) && html`<${LockBand} text=${cardLock(p, rc)} />`}</button>
            ${buyBtn(rare, 0)}
          </div>
        </section>
        <section class="commons panel">
          <span class="label commonslabel" style="color: var(--muted); font-size: 11px;">Commons</span>
          <div class="commonsrow">
            ${sh.cards.slice(1).map((item, i) => {
              const c = card(item.id); if (!c) return null;
              const lock = cardLock(p, c);
              return html`<div class="common">
                <button class="cbtn ${item.sold ? 'sold' : ''} ${lock ? 'locked' : ''}" onClick=${() => setZoomed(c.id)} aria-label="${c.name}, ${c.rarity}">
                  <span class="wideonly"><${Card} id=${c.id} /></span>
                  <span class="phoneonly ctile" style="--edge: ${rarityColor(c.rarity)};"><img src=${art(c.id)} alt="" /><span class="cname">${c.name}</span></span>
                  ${lock && html`<${LockBand} text=${lock} />`}
                </button>
                ${buyBtn(item, i + 1)}
              </div>`;
            })}
          </div>
        </section>
      </div>`}
    <span class="label" style="margin-top: 4px;">Packs</span>
    <div class="packgrid">
      ${PACKS.map(pk => {
        const lock = packLock(p, pk.type), onSale = open.includes(pk.type);
        return html`<div class="packtile ${lock ? 'locked' : ''}" style="--glow: ${pk.glow};" aria-label="${pk.name}, ${pk.cards} cards, ${pk.contents}">
          <div class="packart"><${PackImg} type=${pk.type} height="178" />${lock && html`<${LockBand} text=${lock} />`}</div>
          <span class="pkname">${pk.name}</span>
          <span class="pkdesc wideonly">${pk.type === 'power' ? pk.contents : `${pk.cards} cards · ${pk.contents.replace('A guaranteed ', 'a ').replace(' + 7 more', '').replace(' + 4 more cards', '')}`}</span>
          <span class="pkdesc phoneonly">${pk.cards} cards</span>
          ${lock ? html`<button class="btn sm wide lockedbtn" disabled><${Icon} name="lock" size="12" /><span class="wideonly">${lock}</span><span class="phoneonly">Locked</span></button>`
            : html`<button class="btn gold sm wide" disabled=${!onSale || buying || gold < pk.price} onClick=${() => buyPk(pk)}>
                ${onSale ? html`<${BtnCoin} />${fmt(pk.price)}` : 'Soon'}</button>`}
        </div>`;
      })}
    </div>
    ${state.error && html`<p class="err">${state.error}</p>`}
    ${added && html`<div class="packtoast" role="status"><${PackImg} type=${added} height="46" />
      <div class="col" style="gap: 2px;"><span class="head" style="font-size: 15px;">${packInfo(added).name} added</span><span class="tiny muted">Open it from the Play tab</span></div></div>`}
    ${zoomed && html`<${Modal} onClose=${() => setZoomed(null)} label=${card(zoomed).name}><div style="width: min(320px, 70vw); margin: 0 auto;"><${Card} id=${zoomed} /></div></${Modal}>`}
  </div>`;
}

// ---- "Your packs": swipe or step between them, Open one ----
export function PacksScreen({ close }) {
  const s = useStore();
  const list = s.profile?.unopened || [];
  const [page, setPage] = useState(0);
  const [opening, setOpening] = useState(null);   // pack type being opened
  const [drag, setDrag] = useState(0);
  const start = useRef(null);
  useEffect(() => { set({ error: null }); }, []);
  const i = Math.min(page, Math.max(list.length - 1, 0));
  useEffect(() => { if (page !== i) setPage(i); }, [list.length]);
  useEffect(() => {
    const k = e => { if (opening) return; if (e.key === 'ArrowRight') setPage(Math.min(i + 1, list.length - 1)); if (e.key === 'ArrowLeft') setPage(Math.max(i - 1, 0)); };
    addEventListener('keydown', k); return () => removeEventListener('keydown', k);
  }, [i, list.length, opening]);
  if (opening) return html`<${PackOpening} type=${opening} load=${async () => { const r = await openPack(opening); return r && { cards: r.cards, holo: r.holo || [] }; }}
    onDone=${() => { setOpening(null); if (!(state.profile?.unopened || []).length) close(); }} onCancel=${() => setOpening(null)} />`;
  const total = list.reduce((a, b) => a + b.n, 0);
  const SLOT = 270;
  const down = e => { start.current = e.clientX; e.currentTarget.setPointerCapture?.(e.pointerId); };
  const move = e => { if (start.current != null) setDrag(e.clientX - start.current); };
  const up = () => {
    if (start.current == null) return;
    if (drag < -SLOT / 3) setPage(Math.min(i + 1, list.length - 1)); else if (drag > SLOT / 3) setPage(Math.max(i - 1, 0));
    start.current = null; setDrag(0);
  };
  const cur = list[i] && packInfo(list[i].type);
  return html`<${Screen} close=${close} title="Your packs" right=${html`<span class="small muted">${total} to open</span>`} scroll=${false}>
    <div class="yourpacks">
      ${list.length > 0 && html`
        <div class="carousel" onPointerDown=${down} onPointerMove=${move} onPointerUp=${up} onPointerCancel=${up}>
          <div class="ctrack" style="transform: translateX(calc(50% - 120px - ${i * SLOT}px + ${drag}px)); transition: ${start.current == null ? 'transform .35s cubic-bezier(.2,.9,.3,1.1)' : 'none'};">
            ${list.map((pk, j) => html`<button class="cpack ${j === i ? 'on' : ''}" style="--glow: ${packInfo(pk.type).glow};" onClick=${() => setPage(j)} aria-label=${packInfo(pk.type).name} tabindex=${j === i ? 0 : -1}>
              <${PackImg} type=${pk.type} height="400" />
              ${pk.n > 1 && j === i && html`<span class="ncount">×${pk.n}</span>`}</button>`)}
          </div>
          ${i > 0 && html`<button class="carr l" onClick=${() => setPage(i - 1)} aria-label="Previous pack"><${Icon} name="left" /></button>`}
          ${i < list.length - 1 && html`<button class="carr r" onClick=${() => setPage(i + 1)} aria-label="Next pack"><${Icon} name="right" /></button>`}
        </div>
        <div class="dots">${list.map((_, j) => html`<span class=${j === i ? 'on' : ''}></span>`)}</div>
        <div class="col" style="gap: 4px; align-items: center;">
          <span class="pkbig" style="color: ${cur.glow};">${cur.name}</span>
          <span class="muted small">${list[i].type === 'power' ? cur.contents : `${cur.cards} cards · ${cur.contents}`}</span>
        </div>
        ${s.error && html`<p class="err" style="margin: 0;">${s.error}</p>`}
        <button class="btn gold big" style="width: 240px;" onClick=${() => { set({ error: null }); setOpening(list[i].type); }}>Open</button>`}
    </div>
  </${Screen}>`;
}

// ---- Recruit Pack: straight into the tear (you need the card to play); on an error, a page with Open to try again ----
export function RecruitView({ close, locked, eyebrow = 'Recruit Pack', title = 'Open your Recruit Pack', subtitle }) {
  const [opening, setOpening] = useState(true);
  const s = useStore();
  if (opening) return html`<${PackOpening} type="recruit" hideClose=${locked}
    load=${async () => { const id = await openRecruit(); return id && { cards: [id], holo: [] }; }}
    onDone=${close} onCancel=${() => locked ? setOpening(false) : close()} onFail=${() => setOpening(false)} />`;
  return html`<${Screen} close=${close} hideClose=${locked}>
    <div class="recruit">
      <div class="col" style="gap: 8px; align-items: center; text-align: center;">
        <span class="label">${eyebrow}</span><h1 class="h1">${title}</h1>${subtitle && html`<p class="muted" style="margin: 0;">${subtitle}</p>`}
      </div>
      <div class="cpack on" style="--glow: #3FF0FF;"><${PackImg} type="recruit" height="380" /></div>
      <div class="col" style="gap: 4px; align-items: center;"><span class="pkbig" style="color: var(--cyan);">Recruit Pack</span><span class="muted small">1 card · one of the three starters</span></div>
      ${s.error && html`<p class="err" style="margin: 0; text-align: center;">${s.error}</p>`}
      <button class="btn gold big" style="width: 240px;" onClick=${() => { set({ error: null }); setOpening(true); }}>Open</button>
    </div>
  </${Screen}>`;
}

// ---- the opening ----
// type: pack wrapper; load(): opens it on the server once torn → { cards, holo } or null (error is in state.error).
// Nothing is opened until the tear, so leaving before that keeps the pack.
const TEAR = 0.05;   // tear line, just under the crimped top of the pack art
const LEAK = '#FFE7A8';   // same light for every pack, so the tear never gives away what's inside
function zigzag(top) {
  const pts = [];
  for (let i = 0; i <= 18; i++) pts.push(`${(i / 18 * 100).toFixed(2)}% ${((TEAR + (i % 2 ? 0.008 : -0.008)) * 100).toFixed(2)}%`);
  return top ? `polygon(0 0, 100% 0, ${pts.reverse().join(', ')})` : `polygon(${pts.join(', ')}, 100% 100%, 0 100%)`;
}
const CLIP_TOP = zigzag(true), CLIP_BODY = zigzag(false);

function useViewport() {
  const z = () => parseFloat(document.documentElement.style.zoom) || 1;
  const get = () => ({ w: innerWidth / z(), h: innerHeight / z() });
  const [v, setV] = useState(get());
  useEffect(() => { const f = () => setV(get()); addEventListener('resize', f); return () => removeEventListener('resize', f); }, []);
  return v;
}

export function PackOpening({ type, count, load, onDone, onCancel, onFail, hideClose }) {
  const info = packInfo(type);
  const n = count || info.cards;
  const { w, h } = useViewport();
  const [cards, setCards] = useState(Array(n).fill('?'));
  const [holo, setHolo] = useState(new Set());
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState('pack');     // pack → torn → rising → dealt
  const [current, setCurrent] = useState(0);
  const [flipped, setFlipped] = useState(new Set());
  const [throwDir, setThrowDir] = useState({});
  const [dragX, setDragX] = useState(0);
  const [burst, setBurst] = useState(null);
  const [shake, setShake] = useState(false);
  const tearDrag = useRef(null), cardDrag = useRef(null), stage = useRef(null), cur = useRef(0), root = useRef(null), tearBtn = useRef(null);
  cur.current = current;

  const packW = Math.min(w * 0.7, 300, (h - 220) * 631 / 1050);
  const packH = packW * 1050 / 631;
  const rows = Math.ceil(n / 3);
  const smallW = Math.min((w - 48) / 3, 150, ((h - 200) / rows - 10) / 1.4);
  const bigW = Math.min(w * 0.7, 320, (h - 240) * 5 / 7);
  const torn = phase !== 'pack', dealt = phase === 'dealt';
  const finished = dealt && current >= n;
  const tearY = -packH / 2 + packH * TEAR;

  const tearOpen = async () => {
    if (torn) return;
    Rip.end(); Sound.play('tear');
    setPhase('torn'); setShake(true);
    setTimeout(() => setShake(false), 400);
    const got = load();
    setTimeout(() => setPhase(p => p === 'torn' ? 'rising' : p), 400);
    const r = await got;
    if (!r) { (onFail || onCancel)?.(); return; }
    setCards(r.cards); setHolo(new Set(r.holo || []));
    setTimeout(() => setPhase('dealt'), 1000);
  };

  // tear: drag across the top of the pack (mouse or finger)
  const tdown = e => {
    if (torn) return;
    const r = stage.current.getBoundingClientRect(), z = parseFloat(document.documentElement.style.zoom) || 1;
    const y = e.clientY / z - (r.top / z + r.height / z / 2);   // relative to the pack centre
    if (Math.abs(y - tearY) > 80) return;
    tearDrag.current = { x: e.clientX / z, last: progress };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const tmove = e => {
    const d = tearDrag.current;
    if (!d || d.key || torn) return;
    const z = parseFloat(document.documentElement.style.zoom) || 1;
    const p = Math.min(1, Math.abs(e.clientX / z - d.x) / (packW * 0.85));
    if (p <= progress) return;
    Rip.scratch((p - progress) * 40);
    setProgress(p);
    if (p >= 1) { tearDrag.current = null; tearOpen(); }
  };
  const tup = () => {
    if (!tearDrag.current || tearDrag.current.key || torn) return;
    tearDrag.current = null;
    Rip.end();
    if (progress > 0.7) tearOpen(); else setProgress(0);
  };

  // reveal: the first swipe turns the top card over, the next (or a short wait) throws it aside
  const swipe = (i, dir) => {
    if (!dealt || i !== cur.current || cards[i] === '?') return;
    setThrowDir(t => ({ ...t, [i]: dir }));
    if (!flipped.has(i)) {
      flip(i);
      const wait = { Epic: 2600, Legendary: 3400 }[packRarity(cards[i])] ?? 1600;
      setTimeout(() => { if (cur.current === i) setCurrent(i + 1); }, wait);
      return;
    }
    setCurrent(i + 1);
  };
  const flip = i => {
    setFlipped(f => new Set(f).add(i));
    Sound.play('flip');
    const r = packRarity(cards[i]);
    const flash = (color, ms) => setTimeout(() => {
      Sound.play(holo.has(i) || r === 'Legendary' ? 'legendary' : 'rare');
      setBurst(color); setTimeout(() => setBurst(null), ms);
    }, Sound.duration('flip') * 1000);
    if (holo.has(i)) flash('#8CC8FF', 1200);
    else if (r !== 'Common') flash(rarityColor(r), r === 'Legendary' ? 1200 : 500);
  };
  const cdown = (e, i) => { if (i !== current || !dealt) return; cardDrag.current = { x: e.clientX, moved: false }; e.currentTarget.setPointerCapture?.(e.pointerId); };
  const cmove = e => { const d = cardDrag.current; if (!d) return; const dx = e.clientX - d.x; if (Math.abs(dx) > 10) d.moved = true; setDragX(dx); };
  const cup = (e, i) => {
    const d = cardDrag.current; if (!d) return;
    cardDrag.current = null;
    const dx = e.clientX - d.x;
    if (Math.abs(dx) > 60) swipe(i, dx > 0 ? 1 : -1); else if (!d.moved) swipe(i, 1);
    setDragX(0);
  };
  // keyboard: focus starts on the pack; Enter/Space tears it (same rip, sounds and animation); after that the screen keeps focus
  useEffect(() => { (tearBtn.current || root.current)?.focus(); }, []);
  useEffect(() => { if (torn) root.current?.focus(); }, [torn]);
  const keyTear = () => {
    if (torn || tearDrag.current) return;
    tearDrag.current = { key: true };
    const t0 = performance.now(), from = progress;
    const step = () => {
      const p = Math.min(1, from + (performance.now() - t0) / 500);
      Rip.scratch(0.6); setProgress(p);
      if (p < 1) requestAnimationFrame(step); else { tearDrag.current = null; tearOpen(); }
    };
    requestAnimationFrame(step);
  };
  useEffect(() => {
    const k = e => {
      if (!torn && e.key === 'Escape' && !hideClose) { e.preventDefault(); onCancel?.(); return; }
      if (dealt && !finished && (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowRight')) { e.preventDefault(); swipe(cur.current, 1); }
    };
    addEventListener('keydown', k); return () => removeEventListener('keydown', k);
  });

  // where card i sits: in the pack, rising, stacked (top card follows the pointer), thrown aside, or in the final rows
  const slot = i => {
    const side = i - 1;
    if (!dealt) return { x: side * 8, y: phase === 'rising' ? tearY - smallW * 0.25 : 0, a: side * 5, s: smallW / bigW };
    if (finished) {
      const row = Math.floor(i / 3), inRow = Math.min(3, n - row * 3);
      return { x: (i % 3 - (inRow - 1) / 2) * (smallW + 10), y: (row - (rows - 1) / 2) * (smallW * 1.4 + 10), a: 0, s: smallW / bigW };
    }
    if (i < current) { const d = throwDir[i] ?? 1; return { x: d * w * 1.3, y: -40, a: d * 25, s: 1 }; }
    if (i === current) return { x: dragX, y: 0, a: dragX / 18, s: 1 };
    return { x: 0, y: (i - current) * 16, a: i % 2 ? -3 : 3, s: 1 - (i - current) * 0.05 };
  };
  const hintY = finished ? rows * (smallW * 1.4 + 10) / 2 + 40 : dealt ? bigW * 0.7 + 50 : packH / 2 + 36;
  const showHolo = dealt && current < n && flipped.has(current) && holo.has(current);

  const coarse = matchMedia('(pointer: coarse)').matches;
  return html`<div class="screen city opening" ref=${root} tabindex="-1" role="dialog" aria-modal="true" aria-label="Opening ${info.name}">
    ${!torn && !hideClose && html`<div class="screenhead"><button class="close" onClick=${onCancel} aria-label="Close"><${Icon} name="x" /></button></div>`}
    <div class="stage" ref=${stage} onPointerDown=${tdown} onPointerMove=${tmove} onPointerUp=${tup} onPointerCancel=${tup}>
      <div class="leak" style="width: ${packW * 0.9}px; height: ${packH * 0.35}px; background: ${LEAK}; transform: translate(-50%, calc(-50% + ${tearY}px)) scale(${torn ? 1.3 : 1}); opacity: ${dealt ? 0 : torn ? 0.9 : progress * 0.5};"></div>
      ${cards.map((id, i) => {
        const sl = slot(i);
        return html`<div class="ocard" key=${i} style="width: ${bigW}px; z-index: ${dealt && !finished ? n - i + 5 : 1}; transform: translate(-50%, -50%) translate(${sl.x}px, ${sl.y}px) rotate(${sl.a}deg) scale(${sl.s});
            transition: ${cardDrag.current && i === current ? 'none' : 'transform .55s cubic-bezier(.2,.9,.3,1.12)'}; pointer-events: ${dealt && i === current ? 'auto' : 'none'}; visibility: ${torn ? 'visible' : 'hidden'};"
            onPointerDown=${e => cdown(e, i)} onPointerMove=${cmove} onPointerUp=${e => cup(e, i)} onPointerCancel=${e => cup(e, i)}
            role=${dealt && i === current ? 'button' : null} tabindex=${dealt && i === current ? 0 : -1} aria-label=${dealt && i === current ? (flipped.has(i) ? 'Next card' : `Reveal card ${i + 1} of ${n}`) : null}>
          <${FlipCard} id=${id} flipped=${flipped.has(i) || finished} holo=${holo.has(i)} />
        </div>`;
      })}
      <div class="packpart body ${shake ? 'shake' : ''}" style="width: ${packW}px; height: ${packH}px; clip-path: ${CLIP_BODY}; transform: translate(-50%, -50%) translateY(${dealt ? h : 0}px); opacity: ${dealt ? 0 : 1};">
        <${PackImg} type=${type} height=${packH} /></div>
      ${!torn && progress > 0 && html`
        <div class="seam" style="width: ${packW * progress}px; left: calc(50% - ${packW / 2}px); top: calc(50% + ${tearY}px);"></div>
        <div class="spark" style="left: calc(50% - ${packW / 2 - packW * progress}px); top: calc(50% + ${tearY}px);"></div>`}
      ${!torn && html`<button class="tearbtn" ref=${tearBtn} style="width: ${packW}px; height: ${packH}px;" aria-label="Tear open the ${info.name}. Press Enter."
          onKeyDown=${e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); keyTear(); } }}></button>`}
      <div class="packpart top ${shake ? 'shake' : ''}" style="width: ${packW}px; height: ${packH}px; clip-path: ${CLIP_TOP}; transform-origin: 100% ${TEAR * 100}%;
          transform: translate(-50%, -50%) translate(${torn ? packW * 0.7 : 0}px, ${torn ? -packH * 0.7 : -progress * 6}px) rotate(${torn ? 50 : progress * 14}deg); opacity: ${torn ? 0 : 1};
          transition: ${torn ? 'transform .45s ease-in, opacity .45s ease-in' : 'none'};"><${PackImg} type=${type} height=${packH} /></div>
      ${phase === 'torn' && html`<div class="sparks" style="top: calc(50% + ${tearY}px);">${Array.from({ length: 16 }, (_, i) => {
        const a = i / 16 * 2 * Math.PI, d = 90 + (i * 37) % 70;
        return html`<i style="--x: ${Math.cos(a) * d}px; --y: ${Math.sin(a) * d * 0.6}px; background: ${i % 3 ? LEAK : '#fff'};"></i>`;
      })}</div>`}
      ${showHolo && html`<div class="holotext" style="top: calc(50% - ${bigW * 0.7 + 48}px);">HOLO!</div>`}
      <div class="hint" style="top: calc(50% + ${hintY}px);">
        ${!torn ? html`<span style="opacity: ${progress > 0 ? 0 : 1};">${coarse ? 'Swipe across the top to tear it open' : 'Drag across the top to tear it open, or press Enter'}</span>`
          : dealt && current < n ? html`<span>${flipped.has(current) ? 'Swipe for the next card' : `Swipe to reveal ${current + 1} of ${n}`}</span>`
          : finished ? html`<div class="col" style="gap: 14px; align-items: center;"><span>Added to your collection</span>
              <button class="btn gold" style="width: 200px; height: 50px;" onClick=${onDone}>Done</button></div>` : null}
      </div>
    </div>
    ${burst && html`<div class="burst" style="background: ${burst};"></div>`}
  </div>`;
}

// Card back that turns over to its face; Epic and Legendary glow and shake when revealed.
function FlipCard({ id, flipped, holo }) {
  const r = id === '?' ? 'Common' : packRarity(id);
  const glow = r !== 'Common' ? rarityColor(r) : 'transparent';
  return html`<div class="flip ${flipped ? 'on' : ''} ${flipped && (r === 'Epic' || r === 'Legendary') ? 'jolt' : ''}" style="--glow: ${glow};">
    <div class="fside fback"><${CardBack} /></div>
    <div class="fside ffront">${id === '?' ? html`<${CardBack} />` : card(id) ? html`<${Card} id=${id} fusion=${holo ? { o: true } : null} />` : html`<${PowerCard} pw=${power(id)} />`}</div>
  </div>`;
}
