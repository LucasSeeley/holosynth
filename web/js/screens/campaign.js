// The campaign: the chapter map (CampaignMapView) and a level's battle (CampaignBattleView).
import { html, useState, useEffect, useRef, useLayoutEffect } from '../vendor/preact-htm.js';
import { card as cardOf, art, classColor, packImg } from '../cards.js';
import { api, state as store, set, refresh, replaceScreen } from '../store.js';
import { Icon, Coin, Bar, fmt } from '../ui.js';
import { BattleBoard, ResultCard, apiOrNull, focusOnce } from './battle.js';
import { RecruitView } from '../pages/shop.js';

const VIOLET = '#B98CFF';
const GAP = 84, TOP = 70, BOTTOM = 420;   // between levels; above level 30; room under level 1 for the panel
const H = TOP + 29 * GAP + BOTTOM;
// back to the Play tab: this screen, and anything still under it
const closeAll = close => { close(); if (store.screens.length) set({ screens: [] }); };

// ---- map ----
// Each chapter is a winding path of its 30 levels, bottom to top. Cleared levels are gold, your next level glows
// (the only one you can pick), later levels are dim. Swipe or use the side arrows between chapters; future chapters
// come from the server locked, with no enemies.
export function CampaignMap({ close }) {
  const [map, setMap] = useState(null), [err, setErr] = useState(null);
  const [ch, setCh] = useState(0), [step, setStep] = useState(0);
  useEffect(() => {
    api('campaign/map').then(m => { const cur = current(m); setCh(cur ? cur.chapter : Math.max(0, m.chapters.length - 1)); setMap(m); })
      .catch(e => setErr(e.message));
  }, []);
  const go = d => { if (!map || ch + d < 0 || ch + d >= map.chapters.length) return; setStep(d); setCh(ch + d); };
  useEffect(() => {
    const k = e => { if (e.key === 'ArrowLeft') go(-1); if (e.key === 'ArrowRight') go(1); if (e.key === 'Escape') close(); };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  });
  // swipe between chapters (pointer: touch and mouse drag)
  const drag = useRef(null);
  const down = e => { drag.current = { x: e.clientX, y: e.clientY }; };
  const up = e => {
    const d = drag.current; drag.current = null;
    if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (Math.abs(dx) > Math.max(60, Math.abs(dy) * 1.5)) go(dx < 0 ? 1 : -1);
  };
  const battle = () => replaceScreen(CampaignBattle, {});

  if (!map) return html`<div class="screen cm" role="dialog" aria-modal="true" tabindex="-1" ref=${focusOnce} aria-label="Campaign map">
    <div class="screenhead"><button class="close" onClick=${close} aria-label="Back to Play"><${Icon} name="x" /></button></div>
    <div class="center grow col">${err ? html`<p class="err">${err}</p><button class="btn out" onClick=${close}>Back</button>` : html`<div class="spinner"></div>`}</div></div>`;
  const c = map.chapters[ch], cur = current(map);
  const done = Math.min(30, Math.max(0, map.cleared - ch * 30));
  return html`<div class="screen cm" role="dialog" aria-modal="true" tabindex="-1" ref=${focusOnce} aria-label="Campaign map">
    <header class="cm-head">
      <div class="row" style="gap: 10px;">
        <button class="close" onClick=${close} aria-label="Back to Play"><${Icon} name="x" /></button>
        <div class="col grow" style="gap: 2px; align-items: center; text-align: center;">
          <span class="label" style="font-size: 11px; letter-spacing: 2.5px; color: ${c.locked ? 'var(--muted)' : VIOLET};">${c.locked && html`<${Icon} name="lock" size="10" /> `}Chapter ${c.num}</span>
          <span class="head ellipsis" style="font-size: 21px; color: ${c.locked ? 'var(--muted)' : 'var(--fg)'};">${c.title}</span>
        </div>
        <span style="width: 44px;"></span>
      </div>
      <div class="row cm-prog"><${Bar} value=${done} max="30" style="flex: 1; height: 5px;" /><span class="head" style="font-size: 13px;">${done}<span class="muted"> / 30</span></span></div>
    </header>
    <div class="cm-stage" onPointerDown=${down} onPointerUp=${up} onPointerCancel=${() => { drag.current = null; }}>
      <${Path} key=${ch} map=${map} c=${c} index=${ch} step=${step} />
      <div class="cm-panel">
        ${c.locked ? html`<div class="cm-card lock"><span class="cm-ic"><${Icon} name="lock" size="17" /></span>
            <div class="col" style="gap: 2px;"><b class="head" style="font-size: 16px;">Locked</b><span class="small muted">${c.locked} to unlock</span></div></div>`
          : cur && cur.chapter === ch ? html`<${LevelPanel} c=${c} l=${c.levels[cur.index]} onBattle=${battle} />`
          : (ch + 1) * 30 <= map.cleared && html`<div class="cm-card done"><span class="cm-ic gold"><${Icon} name="check" size="18" /></span>
            <div class="col" style="gap: 2px;"><b class="head" style="font-size: 16px;">Chapter ${c.num} complete</b>
            <span class="small muted">${ch === map.chapters.length - 1 ? 'More chapters are on the way.' : 'All 30 levels cleared'}</span></div></div>`}
      </div>
      ${ch > 0 && html`<button class="cm-arrow l" onClick=${() => go(-1)} aria-label="Chapter ${ch}"><${Icon} name="left" size="18" /></button>`}
      ${ch < map.chapters.length - 1 && html`<button class="cm-arrow r" onClick=${() => go(1)} aria-label="Chapter ${ch + 2}"><${Icon} name="right" size="18" /></button>`}
    </div>
  </div>`;
}

// Your next level: its chapter and index in that chapter (null once every open level is cleared).
function current(m) {
  const c = Math.floor(m.cleared / 30), i = m.cleared % 30;
  return m.chapters[c]?.levels[i] ? { chapter: c, index: i } : null;
}

function Path({ map, c, index, step }) {
  const ref = useRef(null), [w, setW] = useState(0);
  const done = map.cleared - index * 30;   // levels of this chapter cleared (can be <0 or >30)
  // measure, then scroll to your next level before the first paint (no flash): about a third of the way down
  useLayoutEffect(() => {
    const el = ref.current;
    setW(el.clientWidth);
    const n = Math.min(30, Math.max(1, done + 1)), y = TOP + (30 - n) * GAP;
    el.scrollTop = Math.max(0, y - 0.35 * el.clientHeight);
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const width = Math.min(w, 620);
  const pt = n => ({ x: width / 2 + width * 0.29 * Math.sin((n - 1) * 0.95), y: TOP + (30 - n) * GAP });
  const pts = Array.from({ length: 30 }, (_, i) => pt(i + 1));
  const curve = list => list.reduce((d, b, i) => {
    if (!i) return `M${b.x},${b.y}`;
    const a = list[i - 1], my = (a.y + b.y) / 2;
    return `${d} C${a.x},${my} ${b.x},${my} ${b.x},${b.y}`;
  }, '');
  const split = Math.min(29, Math.max(0, done));   // the last node the gold line reaches
  return html`<div class="cm-path ${step > 0 ? 'in-r' : step < 0 ? 'in-l' : ''}" ref=${ref}>
    <div class="cm-canvas" style="width: ${width}px; height: ${H}px;">${w > 0 && html`
      <svg width=${width} height=${H} aria-hidden="true">
        <path d=${curve(pts.slice(split))} fill="none" stroke="rgba(142,138,168,.4)" stroke-width="3" stroke-linecap="round" stroke-dasharray="2 10" />
        ${split > 0 && html`<path d=${curve(pts.slice(0, split + 1))} fill="none" stroke="rgba(255,215,122,.12)" stroke-width="12" stroke-linecap="round" />
          <path d=${curve(pts.slice(0, split + 1))} fill="none" stroke="rgba(232,184,90,.85)" stroke-width="4" stroke-linecap="round" />`}
      </svg>
      ${c.levels.map(l => html`<${Node} l=${l} p=${pts[l.num - 1]} st=${l.num - 1 < done ? 'done' : l.num - 1 === done ? 'next' : 'locked'} />`)}`}
    </div>
  </div>`;
}

function Node({ l, p, st }) {
  const pos = `left: ${p.x}px; top: ${p.y}px;`;
  const nextTag = html`<span class="cm-tag next">Lv ${l.num} · Next</span>`;
  if (l.boss) {
    return html`<div class="cm-boss ${st}" style=${pos} role=${st === 'next' ? 'img' : null}
        aria-label="Level ${l.num}, boss, ${st === 'done' ? 'cleared' : st === 'next' ? 'next: ' + l.title : 'locked'}">
      <img src=${l.enemies[0] ? art(l.enemies[0]) : '/img/card_bg.webp'} alt="" draggable="false" />
      <span class="cm-tag boss"><${Icon} name="crown" size="9" />Boss</span>
      ${st === 'done' ? html`<span class="cm-check"><${Icon} name="check" size="11" /></span>`
        : l.pack && html`<img class="cm-pack" src=${packImg(l.pack)} alt="" />`}
      ${st === 'next' ? nextTag : html`<span class="cm-lv">LV ${l.num}</span>`}
    </div>`;
  }
  if (st === 'next') {
    return html`<div class="cm-next" style=${pos} aria-label="Level ${l.num}, next: ${l.title}" role="img">
      <span class="ring"></span><img src=${art(l.enemies[0])} alt="" draggable="false" />${nextTag}</div>`;
  }
  return html`<div class="cm-dot ${st}" style=${pos} aria-label="Level ${l.num}, ${st === 'done' ? 'cleared' : 'locked'}">${l.num}</div>`;
}

function LevelPanel({ c, l, onBattle }) {
  return html`<div class="cm-card level">
    <div class="row" style="align-items: flex-start;">
      <div class="col grow" style="gap: 3px;">
        <span class="label" style="font-size: 11px; letter-spacing: 2.5px; color: ${VIOLET};">Level ${l.num} · ${l.boss ? 'Boss' : 'Next'}</span>
        <span class="head ellipsis" style="font-size: 21px;">${l.title}</span>
      </div>
      ${l.lv > 0 && html`<span class="cm-fused">✦ Enemies fused ×${l.lv}</span>`}
    </div>
    <div class="cm-foes">${l.enemies.map(id => {
      const k = cardOf(id);
      return html`<div class="col" style="align-items: center; gap: 5px; flex: 1; min-width: 0;">
        <img class="avatar" src=${art(id)} alt="" style="width: 56px; height: 56px; border: 2px solid ${classColor(k?.cls)};" />
        <span class="small ellipsis" style="font-weight: 600; max-width: 100%;">${k?.name ?? id}</span></div>`;
    })}</div>
    <div class="row head" style="gap: 18px; justify-content: center; font-size: 14px; flex-wrap: wrap;">
      <span style="color: var(--gold-hi);">+${fmt(c.gold)} gold</span><span style="color: var(--online);">+${c.xp} XP</span>
      ${l.pack && html`<span class="row" style="gap: 6px;"><img src=${packImg(l.pack)} alt="" style="height: 28px;" />${l.pack[0].toUpperCase() + l.pack.slice(1)} Pack</span>`}
    </div>
    <button class="btn gold wide" style="height: 54px;" onClick=${onBattle}>Battle</button>
  </div>`;
}

// ---- a level's battle ----
// You always move first; the computer answers each move.
export function CampaignBattle({ close }) {
  const [run, setRun] = useState(null), [err, setErr] = useState(null), [settled, setSettled] = useState(true);
  const start = async () => {
    try { setRun(await api('campaign/start', {})); setErr(null); } catch (e) { setErr(e.message); setRun(null); }
  };
  useEffect(() => {
    // pick up a fight left open (page closed mid-battle), otherwise start the next level
    apiOrNull('campaign/current').then(cur => cur ? setRun(cur) : start()).catch(e => setErr(e.message));
  }, []);
  const onMove = async (from, move, to) => {
    setSettled(false);
    try {
      const next = await api('campaign/move', { from, move, to });
      setRun(next);
      if (next.profile) set({ profile: next.profile });
    } catch (e) {
      // out of step with the server (a reply that never arrived): load the real battle
      try { const fresh = await apiOrNull('campaign/current'); if (fresh) setRun(fresh); } catch {}
      setSettled(true); throw e;
    }
  };
  const onLeave = async () => { try { await api('campaign/leave', {}); } catch {} refresh(); close(); };
  if (!run) return html`<div class="screen city" role="dialog" aria-modal="true" tabindex="-1" ref=${focusOnce} aria-label="Campaign battle">
    <div class="center grow col" style="padding: 24px; text-align: center;">${err ? html`<p class="err">${err}</p><button class="btn out" onClick=${close}>Back</button>` : html`<div class="spinner"></div>`}</div></div>`;
  const r = run.result;
  return html`<div class="screen city" role="dialog" aria-modal="true" tabindex="-1" ref=${focusOnce} aria-label="Campaign battle">
    <${BattleBoard} state=${run.state} you=${0} eyebrow=${run.boss ? `Boss · Level ${run.level}` : `Level ${run.level}`} title=${run.title}
      foeName=${run.boss ? 'The boss' : 'The enemy'} leaveLabel="Quit" leaveQuestion="Quit this fight? You can try again any time."
      onMove=${onMove} onLeave=${onLeave} onSettled=${() => setSettled(true)} />
    ${r && settled && html`<${ResultCard} key=${run.level + ':' + r.won} won=${r.won}>
      ${r.won ? html`
        <p>${run.boss ? 'You beat the boss!' : `Level ${run.level} cleared`}</p>
        ${r.gold > 0 && html`<span class="chip" style="align-self: center;"><${Coin} />+${fmt(r.gold)} · +${r.xp || 0} XP</span>`}
        ${r.recruit ? html`
          <b class="head" style="font-size: 22px;">Recruit Pack earned</b>
          <img src="/img/pack_recruit.webp" alt="" style="width: 150px; align-self: center; filter: drop-shadow(0 0 18px rgba(63,240,255,.45));" />
          <p class="muted">Your next starter is inside.</p>
          <button class="btn gold big wide" onClick=${() => replaceScreen(RecruitView, { title: 'Your next starter is waiting' })}>Open</button>`
        : html`
          ${r.pack && html`<p>Boss reward: a free pack! Open it from the Play tab.</p>`}
          ${store.profile?.campaign.next && html`<button class="btn gold big wide" onClick=${start}>Next battle</button>`}
          <button class="btn out wide" onClick=${() => closeAll(close)}>Exit</button>`}`
      : html`
        <p class="muted">You go first every time. Try a different target order.</p>
        <button class="btn gold big wide" onClick=${start}>Try again</button>
        <button class="btn out wide" onClick=${() => closeAll(close)}>Exit</button>`}
    </${ResultCard}>`}
  </div>`;
}
