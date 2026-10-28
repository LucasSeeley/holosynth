// Legend Hunt (HuntView in the app): lobby → fight → won / got away. One try per 8-hour hunt against a fully fused
// Legendary and its two supports. Winning gives an Overload pack (opened from the Play tab).
import { html, useState, useEffect, useRef } from '../vendor/preact-htm.js';
import { api, refresh, set } from '../store.js';
import { Screen, Card, Icon, Coin, PackImg, fmt, useNow, left } from '../ui.js';
import { card, rarityColor, fusionTotal } from '../cards.js';
import { Sound, Music } from '../sound.js';
import { BattleBoard } from './battle.js';

export const HUNT_GOLD = '#FFD77A';
export const huntLeft = left;
const FULL = { h: 3, b: 3, s: 3, x: true, p: true };   // same as the server's HUNT_FUSION

export function Hunt({ close }) {
  const [phase, setPhase] = useState({ k: 'loading' });   // loading | lobby | fight | won | lost
  const [home, setHome] = useState(null);
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(null);
  const legend = home && card(home.legend);
  const done = () => { close(); refresh(); };

  useEffect(() => { if (phase.k !== 'loading') Music.play(phase.k === 'fight' ? 'battle' : 'menu'); }, [phase.k]);
  useEffect(() => {
    api('hunt').then(h => {
      setHome(h);
      if (h.status === 'playing' && h.state) { setState(h.state); setPhase({ k: 'fight' }); } else setPhase({ k: 'lobby' });
    }).catch(e => { setError(e.message); setPhase({ k: 'lobby' }); });
  }, []);

  async function start() {
    setBusy(true);
    try {
      const h = await api('hunt/start', {});
      setHome(h); setState(h.state); setError(null);
      refresh();   // the Play tile shows the try as used
      setPhase({ k: 'fight' });
    } catch (e) { setError(e.message); }
    setBusy(false);
  }
  function finishFight() {
    const r = pending.current;
    if (!r) return;
    pending.current = null;
    Sound.play(r.won ? 'victory' : 'defeat');
    setPhase(r.won ? { k: 'won', r } : { k: 'lost' });
  }

  const k = phase.k;
  if (k === 'fight' && state && legend) {
    return html`<div class="screen city"><${BattleBoard} state=${state} you=${0} eyebrow="Legend Hunt" title=${legend.name} foeName=${legend.name}
      leaveLabel="Give up" leaveQuestion="Give up? This uses today's try."
      onMove=${async (from, mv, to) => {
        try {
          const r = await api('hunt/move', { from, move: mv, to });
          if (r.profile) set({ profile: r.profile });
          pending.current = r.result;
          setState(r.state);
        } catch (e) {
          try { const h = await api('hunt'); if (h.state) setState(h.state); } catch {}
          throw e;
        }
      }}
      onLeave=${async () => { try { const r = await api('hunt/leave', {}); set({ profile: r.profile }); } catch {} done(); }}
      onSettled=${finishFight} /></div>`;
  }

  if (k === 'loading') return html`<${Screen} close=${done} title="Legend Hunt"><div class="center" style="height: 60%;"><div class="spinner"></div></div><//>`;

  if (k === 'won') {
    const r = phase.r;
    return html`<${Screen} close=${done} hideClose title="" class="h-glow">
      <div class="mcenter">
        <span class="label row" style="gap: 6px; color: ${HUNT_GOLD};"><${Icon} name="crown" size="14" />Legend Hunt</span>
        <span class="head" style="font-size: 36px; text-align: center; text-shadow: 0 0 14px rgba(255,215,122,.5);">${legend?.name ?? 'Legend'} defeated!</span>
        <${PackImg} type="overload" height=${innerWidth < 760 ? 240 : 300} style="transform: rotate(-3deg); filter: drop-shadow(0 0 26px rgba(255,215,122,.6)); margin-top: 10px;" />
        ${r.gold != null && r.xp != null && html`<span class="g-gold" style="color: ${HUNT_GOLD};"><${Coin} size="18" />+${fmt(r.gold)} gold  ·  +${fmt(r.xp)} XP</span>`}
        <p class="soft" style="margin: 0; text-align: center;">Your Overload Pack is waiting on the Play tab.<br />Is ${legend?.name ?? 'the legend'} in it?</p>
        <button class="btn gold big" style="width: min(360px, 100%); margin-top: 18px;" onClick=${done}>Collect</button>
      </div><//>`;
  }

  if (k === 'lost') return html`<${Screen} close=${done} hideClose title="">
    <div class="mcenter">
      <span class="label row" style="gap: 6px; color: #FF7884;"><${Icon} name="crown" size="14" />Legend Hunt</span>
      <span class="head" style="font-size: 36px; text-align: center;">${legend?.name ?? 'The legend'} got away</span>
      ${legend && html`<div style="width: 190px; filter: saturate(.4); opacity: .45; margin-top: 8px;"><${Card} id=${legend.id} fusion=${FULL} /></div>`}
      <${NewIn} next=${home?.next} prefix="A new legend appears in " suffix="." />
      <button class="btn out" style="width: min(360px, 100%); margin-top: 18px;" onClick=${done}>Done</button>
    </div><//>`;

  // lobby
  const ready = home?.status === 'ready';
  return html`<${Screen} close=${done} title="Legend Hunt">
    <div class="mwrap mgrid h-lobby">
      ${legend ? html`<section class="h-legend">
        <div class="row" style="justify-content: space-between; flex-wrap: wrap; gap: 6px;">
          <span class="label row" style="gap: 6px; color: ${HUNT_GOLD}; letter-spacing: 2.5px;"><${Icon} name="crown" size="14" />Current legend</span>
          <${NewIn} next=${home.next} prefix="New legend in " />
        </div>
        <div class="h-cards">
          <div class="col" style="gap: 6px; align-items: center;">
            <div class="h-main"><${Card} id=${legend.id} fusion=${FULL} /></div>
            <span class="tiny soft">✦ Fully fused</span>
          </div>
          <${Support} id=${home.support} f=${home.supportFusion} />
          <${Support} id=${home.support2} f=${home.support2Fusion} />
        </div>
      </section>` : html`<div></div>`}
      <div class="col" style="gap: 16px;">
        ${legend && html`<section class="panel row" style="padding: 14px 16px; gap: 14px;">
          <${PackImg} type="overload" height="84" style="filter: drop-shadow(0 0 8px rgba(255,215,122,.45));" />
          <div class="col soft small" style="gap: 4px;">
            <span class="label" style="font-size: 11px; color: ${HUNT_GOLD};">Beat all three to win</span>
            <span><b class="head" style="font-size: 17px; color: var(--fg);">Overload Pack</b> · 8 cards</span>
            <span><b class="head" style="color: ${HUNT_GOLD};">20%</b> chance of ${legend.name}, else an Epic</span>
            <b class="head" style="color: ${HUNT_GOLD};">+ 5,000 gold · 1,000 XP</b>
          </div>
        </section>`}
        <p class="small muted" style="margin: 0; text-align: center;">${ready ? 'One try per hunt. A new legend every 8 hours.' : "You've hunted this one. A new legend is on its way."}</p>
        <div class="h-cta">
          ${error && html`<p class="err" style="margin: 0 0 10px; text-align: center;">${error}</p>`}
          <button class="btn gold big wide" disabled=${!ready || busy} onClick=${start}>${ready ? 'Hunt' : 'Back soon'}</button>
        </div>
      </div>
    </div><//>`;
}

function Support({ id, f }) {
  const c = id && card(id);
  if (!c) return null;
  const fused = fusionTotal(f) > 0;
  return html`<div class="col h-support" style="gap: 5px; align-items: center;">
    <span class="label" style="font-size: 9px; letter-spacing: 1.5px; color: ${rarityColor(c.rarity)};">Support</span>
    <${Card} id=${id} fusion=${fused ? f : null} />
    <span class="tiny soft" style="font-size: 11px;">${c.rarity} · ${fused ? 'fused' : 'not fused'}</span>
  </div>`;
}

function NewIn({ next, prefix, suffix = '' }) {
  useNow(30000);
  return html`<span class="small soft">${prefix}<b class="head" style="color: var(--fg);">${left(next ?? 0)}</b>${suffix}</span>`;
}
