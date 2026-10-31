// Expeditions (ExpeditionsView) and the Collector (CollectorView): send spare cards on timed missions, and turn in
// spare copies for today's requests. Both pay gold and Pass XP; the server fixes the rewards.
import { html, useState, useEffect } from '../vendor/preact-htm.js';
import { useStore, api, set, refresh, openScreen } from '../store.js';
import { Icon, Coin, Card, Avatar, PackImg, Modal, Screen, fmt, useNow, left } from '../ui.js';
import { card, classIcon, sortCards } from '../cards.js';
import { Sound } from '../sound.js';

// Same as the server's expReward: more cards and rarer ones pay more, plus 5% per card of the mission's class.
const EXP_COUNT = [0.4, 0.7, 1], EXP_RARITY = { Common: 0, Rare: 0.1, Epic: 0.2, Legendary: 0.3 };
const expMult = (m, ids) => EXP_COUNT[ids.length - 1] + ids.reduce((s, id) => s + EXP_RARITY[card(id).rarity] + (card(id).cls === m.cls ? 0.05 : 0), 0);
export const expReward = (m, ids) => { const k = expMult(m, ids); return { gold: Math.round(m.gold * k / 10) * 10, xp: Math.round(m.xp * k / 10) * 10 }; };
// Spare copies: all but your best one (every fused copy stays too).
export const spareOf = (p, id) => (p.collection[id] || 0) - Math.max(1, p.fused.filter(f => f.card === id).length);

const Reward = ({ gold, xp, pack }) => html`<span class="xreward">
  <span class="row" style="gap: 4px;"><${Coin} size="14" />${fmt(gold)}</span><span class="xp">+${fmt(xp)} Pass XP</span>${pack && html`<span class="pk">+ pack</span>`}</span>`;
const byRarity = ids => sortCards(ids.map(card), 2).map(c => c.id);   // 2: the Rarity sort, best first
const packName = t => t[0].toUpperCase() + t.slice(1) + ' Pack';

function RewardPop({ title, r, onClose }) {
  return html`<${Modal} onClose=${onClose} label=${title}>
    <div class="xpop">
      <span class="label">${title}</span>
      <div class="row" style="gap: 26px; justify-content: center; align-items: flex-end;">
        <div class="col" style="align-items: center; gap: 6px;"><${Coin} size="40" /><b class="head" style="font-size: 24px;">${fmt(r.gold)}</b></div>
        <div class="col" style="align-items: center; gap: 6px; color: var(--cyan);"><b class="head" style="font-size: 28px; line-height: 40px;">XP</b><b class="head" style="font-size: 24px;">+${fmt(r.xp)}</b></div>
        ${r.pack && html`<div class="col" style="align-items: center; gap: 6px;"><${PackImg} type=${r.pack} height="64" /><b class="small">${packName(r.pack)}</b></div>`}
      </div>
      <button class="btn gold big wide" autofocus onClick=${onClose}>Nice</button>
    </div>
  </${Modal}>`;
}

// ---- Expeditions ----
export function Expeditions({ close }) {
  const s = useStore(), p = s.profile, e = p?.expeditions;
  const [busy, setBusy] = useState(false), [error, setError] = useState(null), [won, setWon] = useState(null);
  const t = useNow(1000);
  useEffect(() => { refresh(); }, []);
  if (!e) return null;
  const claim = async x => {
    setBusy(true);
    try { const r = await api('expeditions/claim', { id: x.id }); set({ profile: r.profile }); setError(null); Sound.play('rare'); setWon(r); }
    catch (err) { setError(err.message); await refresh(); }
    setBusy(false);
  };
  const open = e.missions.filter(m => !m.sent).length;
  return html`<${Screen} close=${close} title="Expeditions">
    <div class="narrow xlist">
      ${e.away.map(x => {
        const back = x.ends <= t;
        return html`<div class="panel xslot ${back ? 'back' : ''}">
          <div class="row" style="align-items: baseline;"><b class="head grow" style="font-size: 17px;">${x.name}</b>
            <span class="small ${back ? 'backtxt' : 'soft'}">${back ? 'Back!' : `${left(x.ends)} left`}</span></div>
          <div class="row" style="gap: 6px;">${x.cards.map(id => html`<${Avatar} id=${id} size="46" />`)}<span class="grow"></span>
            ${back && html`<button class="btn gold" style="height: 40px; padding: 0 22px;" disabled=${busy} onClick=${() => claim(x)}>Claim</button>`}</div>
          ${!back && html`<div class="bar"><i style="width: ${100 * Math.min(1, (t - x.start) / (x.ends - x.start))}%"></i></div>`}
          <${Reward} ...${x} />
        </div>`;
      })}
      ${[...Array(Math.min(open, 3 - e.away.length))].map(() => html`<div class="panel xslot free">
        <span class="small muted grow">Free slot</span><button class="btn gold" style="height: 40px; padding: 0 18px;" onClick=${() => openScreen(ExpSend, {})}>Send a team</button></div>`)}
      ${!open && html`<p class="small muted" style="text-align: center; margin: 4px 0 0;">New missions in ${left(e.next)}</p>`}
      ${error && html`<p class="err" style="text-align: center; margin: 0;">${error}</p>`}
    </div>
    ${won && html`<${RewardPop} title="${won.name} · back" r=${won} onClose=${() => setWon(null)} />`}
  </${Screen}>`;
}

// Pick one of today's missions, then up to 3 cards (not on your team, not already away).
function ExpSend({ close }) {
  const p = useStore().profile, e = p.expeditions;
  const [mi, setMi] = useState(null), [step, setStep] = useState(1), [picked, setPicked] = useState([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState(null);
  const m = mi == null ? null : e.missions[mi];
  const away = e.away.filter(x => x.ends > Date.now()).flatMap(x => x.cards);
  const cards = byRarity(Object.keys(p.collection).filter(id => card(id) && !p.team.includes(id) && !away.includes(id)));
  const toggle = id => setPicked(picked.includes(id) ? picked.filter(x => x !== id) : picked.length < 3 ? [...picked, id] : picked);
  const send = async () => {
    setBusy(true);
    try { set({ profile: await api('expeditions/send', { mission: mi, cards: picked }) }); Sound.play('select'); close(); }
    catch (err) { setError(err.message); await refresh(); }
    setBusy(false);
  };
  if (step === 1) return html`<${Screen} close=${close} title="New expedition">
    <div class="narrow xlist">
      <span class="label">1 · Pick a mission</span>
      ${e.missions.map((x, i) => !x.sent && html`<button class="panel xmiss ${mi === i ? 'on' : ''}" onClick=${() => setMi(i)} aria-pressed=${mi === i}>
        <img src=${classIcon(x.cls)} alt="" /><span class="col grow" style="gap: 3px;"><b class="head" style="font-size: 16px;">${x.name}</b>
          <span class="small muted">${x.hours === 1 ? '1 hour' : `${x.hours} hours`} · ${x.cls}s +5% each</span></span>
        <span class="col" style="align-items: flex-end; gap: 2px;"><span class="row head" style="gap: 4px; font-size: 13px;"><${Coin} size="13" />${fmt(x.gold)}</span>
          <span class="head" style="font-size: 13px; color: var(--cyan);">+${x.xp}</span>${x.pack && html`<span class="tiny" style="color: var(--gold-hi);">+ pack</span>`}</span>
      </button>`)}
      <button class="btn gold big wide" disabled=${m == null} onClick=${() => setStep(2)}>Next</button>
    </div>
  </${Screen}>`;
  const r = picked.length ? expReward(m, picked) : null, match = picked.filter(id => card(id).cls === m.cls).length;
  return html`<${Screen} close=${() => setStep(1)} title="${m.name} · ${m.hours === 1 ? '1 hour' : `${m.hours} hours`}">
    <div class="narrow xlist">
      <span class="label">2 · Pick up to 3 cards</span>
      ${cards.length ? html`<div class="xgrid">${cards.map(id => html`<div class="xpick">
          <${Card} id=${id} count=${p.collection[id]} selected=${picked.includes(id)} onClick=${() => toggle(id)} />
          ${picked.includes(id) && html`<span class="xcheck"><${Icon} name="check" size="14" /></span>`}</div>`)}</div>`
        : html`<p class="small muted">Every card you own is on your team. Get more from packs.</p>`}
      <div class="xfoot">
        <div class="panel xsum"><span class="small muted">${picked.length ? `${picked.length} of 3${match ? ` · ${match} ${m.cls}${match > 1 ? 's' : ''}` : ''}` : `Best: 3 ${m.cls}s`}</span>
          ${r ? html`<${Reward} ...${r} pack=${m.pack} />` : html`<span class="small muted">Pick a card</span>`}</div>
        ${error && html`<p class="err" style="text-align: center; margin: 0;">${error}</p>`}
        <button class="btn gold big wide" disabled=${!picked.length || busy} onClick=${send}>Send</button>
      </div>
    </div>
  </${Screen}>`;
}

// ---- Collector ----
export function Collector({ close }) {
  const s = useStore(), p = s.profile, c = p?.collector;
  const [won, setWon] = useState(null);
  useNow(30000);
  useEffect(() => { refresh(); }, []);
  if (!c) return null;
  return html`<${Screen} close=${close} title="Collector">
    <div class="narrow xlist">
      ${c.requests.map((r, i) => {
        const have = colSpares(p, r).reduce((a, x) => a + x.n, 0);
        return html`<div class="panel xslot ${r.done ? 'done' : ''}">
          <div class="row" style="align-items: baseline;"><b class="head grow" style="font-size: 17px;">${r.name}</b>
            ${r.done ? html`<span class="small" style="color: #3DFF8A;">Done</span>` : html`<span class="small soft">${have} spare</span>`}</div>
          <div class="row" style="align-items: center;"><span class="grow"><${Reward} ...${r} /></span>
            ${!r.done && html`<button class="btn gold" style="height: 40px; padding: 0 18px;" disabled=${have < r.n}
              onClick=${() => openScreen(ColPick, { i, onWon: setWon })}>Turn in</button>`}</div>
        </div>`;
      })}
      <p class="small muted" style="text-align: center; margin: 4px 0 0;">New requests in ${left(c.next)}</p>
    </div>
    ${won && html`<${RewardPop} title="Collector · ${won.name}" r=${won} onClose=${() => setWon(null)} />`}
  </${Screen}>`;
}
const colSpares = (p, r) => Object.keys(p.collection).map(id => ({ id, n: spareOf(p, id) }))
  .filter(x => x.n > 0 && card(x.id) && card(x.id).rarity === r.rarity && (!r.cls || card(x.id).cls === r.cls));

// Pick the copies to turn in: a tap adds a copy (up to your spares), and once that card is maxed a tap takes them all back.
function ColPick({ close, i, onWon }) {
  const p = useStore().profile, r = p.collector.requests[i];
  const [picked, setPicked] = useState([]), [busy, setBusy] = useState(false), [error, setError] = useState(null);
  const spares = byRarity(colSpares(p, r).map(x => x.id)).map(id => ({ id, n: spareOf(p, id) }));
  const k = id => picked.filter(x => x === id).length;
  const tap = x => setPicked(k(x.id) < x.n && picked.length < r.n ? [...picked, x.id] : picked.filter(y => y !== x.id));
  const go = async () => {
    setBusy(true);
    try { const res = await api('collector/turnin', { request: i, cards: picked }); set({ profile: res.profile }); Sound.play('rare'); close(); onWon(res); }
    catch (err) { setError(err.message); await refresh(); setBusy(false); }
  };
  return html`<${Screen} close=${close} title=${r.name}>
    <div class="narrow xlist">
      <span class="label">Pick ${r.n} spare ${r.n > 1 ? 'copies' : 'copy'}</span>
      <div class="xgrid">${spares.map(x => html`<div class="xpick">
        <${Card} id=${x.id} count=${x.n} selected=${k(x.id) > 0} onClick=${() => tap(x)} label="${card(x.id).name}, ${x.n} spare" />
        ${k(x.id) > 0 && html`<span class="xcheck">${k(x.id) > 1 ? `×${k(x.id)}` : html`<${Icon} name="check" size="14" />`}</span>`}</div>`)}</div>
      <p class="small muted" style="margin: 0;">You keep at least one of each card.</p>
      <div class="xfoot">
        <div class="panel xsum"><span class="small muted">${picked.length} of ${r.n}</span><${Reward} ...${r} /></div>
        ${error && html`<p class="err" style="text-align: center; margin: 0;">${error}</p>`}
        <button class="btn gold big wide" disabled=${picked.length !== r.n || busy} onClick=${go}>Turn in</button>
      </div>
    </div>
  </${Screen}>`;
}
