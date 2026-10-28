// Ranked (RankedView in the app): this week's standings → find a match (live, or another player's team played by the
// computer) → fight → points. Also the week's result when a week ends, and last season's reward.
import { html, useState, useEffect, useRef } from '../vendor/preact-htm.js';
import { api, refresh, set, useStore } from '../store.js';
import { Screen, Icon, Coin, Avatar, PackImg, fmt, useNow, left } from '../ui.js';
import { art } from '../cards.js';
import { Sound, Music } from '../sound.js';
import { BattleBoard } from './battle.js';

const COLORS = ['#C8834E', '#C9D1DC', '#FFD23D', '#3DFFD6', '#3D9BFF', '#FF3D5E', '#8CC8FF', '#FFF3C4'];
export const rankColor = r => COLORS[Math.max(0, Math.min(COLORS.length - 1, r ?? 0))];
const GREEN = '#3DFF8A', RED = '#FF7884';
const RAINBOW = ['#FF3D6E', '#FFB03D', '#FFF03D', '#3DFF8A', '#3DD6FF', '#8A5CFF', '#FF3DF0'];

// A shield in the rank's colour (the Holo rank in rainbow foil), with a crown cut in for the top three.
export function RankEmblem({ rank = 0, size = 64, style = '' }) {
  const c = rankColor(rank), id = 'rk' + rank;
  const shield = 'M50 4.4L88 19.8V46.2Q88 77 50 90.2Q12 77 12 46.2V19.8Z';
  const fill = rank === 6 ? `url(#${id}h)` : c;
  return html`<svg width=${size} height=${size * 1.1} viewBox="0 0 100 110" aria-hidden="true" style="flex: none; ${style}">
    <defs>
      <radialGradient id="${id}g" cx="50%" cy="35%" r="60%"><stop offset="0" stop-color=${c} stop-opacity=".55" /><stop offset="1" stop-color="#0E0C18" /></radialGradient>
      ${rank === 6 && html`<linearGradient id="${id}h" x1="0" y1="0" x2="1" y2="1">${RAINBOW.map((r, i) => html`<stop offset=${i / 6} stop-color=${r} />`)}</linearGradient>`}
    </defs>
    <path d=${shield} fill="url(#${id}g)" />
    <path d=${shield} fill="none" stroke=${fill} stroke-width="4.5" />
    <path d=${shield} fill=${fill} opacity=".9" transform="translate(22.5 22.75) scale(.55)" />
    ${rank >= 5 && html`<path d="M37 53L43.5 41L50 48.2L56.5 41L63 53Z" fill="#12111D" />`}
  </svg>`;
}

const arrows = (place, rank) => place === 1 ? '▲▲▲' : place <= 3 ? '▲▲' : place <= 10 ? '▲' : place <= 20 ? '–' : rank === 0 ? '–' : '▼';
const placeColor = (place, rank) => place <= 10 ? GREEN : place <= 20 || rank === 0 ? 'var(--muted)' : RED;
function outlook(place, rank) {
  const n = place === 1 ? 3 : place <= 3 ? 2 : place <= 10 ? 1 : place <= 20 || rank === 0 ? 0 : -1;
  return ['on track to rank down', 'on track to stay', 'on track to rank up', 'on track to rank up twice', 'on track to rank up 3 times'][n + 1];
}

export function Ranked({ close }) {
  const s = useStore();
  const [phase, setPhase] = useState({ k: 'loading' });   // loading | lobby | rewards | searching | found | fight | result | week | season
  const [view, setView] = useState(null);
  const [match, setMatch] = useState(null);       // live match
  const [state, setState] = useState(null);       // the fight on the board (computer-played)
  const [opp, setOpp] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(null), phaseRef = useRef(phase), searchStart = useRef(0), viewRef = useRef(null);
  const matchRef = useRef(null);
  phaseRef.current = phase; viewRef.current = view; matchRef.current = match;
  const go = p => setPhase(p);
  const name = r => view?.ranks?.[r] ?? 'Rookie';
  const done = () => { close(); refresh(); };

  useEffect(() => { Music.play(phase.k === 'fight' ? 'battle' : 'menu'); }, [phase.k]);

  async function load(keepPhase = false) {
    try {
      const v = await api('ranked');
      setView(v);
      if (v.run) { setState(v.run.state); setOpp(v.run.opp); }
      if (keepPhase) return;
      if (v.reward) go({ k: 'season', r: v.reward });
      else if (v.moved) go({ k: 'week', m: v.moved });
      else if (v.liveMatch) { try { setMatch(await api('matches/' + v.liveMatch)); go({ k: 'fight' }); } catch { go({ k: 'lobby' }); } }
      else if (v.run) go({ k: 'fight' });
      else go({ k: 'lobby' });
    } catch (e) { setError(e.message); if (!keepPhase) go({ k: 'lobby' }); }
  }
  useEffect(() => { load(); }, []);

  // Live match: check for the other player's moves every 2 seconds.
  useEffect(() => {
    if (phase.k !== 'fight' || !match) return;
    let on = true;
    const t = setInterval(async () => {
      const m = matchRef.current;
      if (!on || !m || m.status !== 'active' || m.state?.turn === m.you) return;
      try { const fresh = await api('matches/' + m.id); if (on && JSON.stringify(fresh) !== JSON.stringify(matchRef.current)) setMatch(fresh); } catch {}
    }, 2000);
    return () => { on = false; clearInterval(t); };
  }, [phase.k, match?.id]);

  function show(r) { (r.won ? Sound.play('victory') : Sound.play('defeat')); go({ k: 'result', r }); }

  async function liveOver(won) {
    const before = viewRef.current?.place ?? 0, points = viewRef.current?.points ?? 0;
    await refresh();
    let v = viewRef.current;
    try { v = await api('ranked'); setView(v); } catch {}
    setMatch(null);
    show({ won, delta: (v?.points ?? points) - points, points: v?.points ?? points, from: before, place: v?.place ?? before, gold: won ? 150 : 0, xp: won ? 100 : 0 });
  }

  function startSearch() {
    setError(null);
    searchStart.current = Date.now();
    go({ k: 'searching' });
    phaseRef.current = { k: 'searching' };
    (async () => {
      while (phaseRef.current.k === 'searching') {
        try {
          const gone = Date.now() - searchStart.current > 15000;
          const r = await api(gone ? 'ranked/ghost' : 'ranked/search', {});
          setView(r.view);
          if (r.view.liveMatch) {
            const m = await api('matches/' + r.view.liveMatch);
            setMatch(m);
            if (phaseRef.current.k === 'searching') go({ k: 'found' });
            return;
          }
          if (r.view.run) {
            setState(r.view.run.state); setOpp(r.view.run.opp);
            if (phaseRef.current.k === 'searching') go({ k: 'found' });
            return;
          }
        } catch (e) { setError(e.message); go({ k: 'lobby' }); return; }
        await new Promise(r => setTimeout(r, 2000));
      }
    })();
  }
  function cancelSearch() { go({ k: 'lobby' }); api('ranked/cancel', {}).catch(() => {}); }
  async function seen() { try { await api('ranked/seen', {}); } catch {} await load(); refresh(); }
  async function claim() {
    setBusy(true);
    try {
      const r = await api('ranked/claim', {});
      set({ profile: r.profile });
      if (r.cards) done(); else await load();   // a pack goes to your packs on the Play tab
    } catch (e) { setError(e.message); await load(); }
    setBusy(false);
  }

  const k = phase.k, v = view;
  if (k === 'fight') {
    if (match?.state) {
      const m = match, foe = m.players[1 - m.you] ?? 'Opponent';
      return html`<div class="screen city"><${BattleBoard} state=${m.state} you=${m.you} eyebrow="Ranked" title="vs ${foe}" foeName=${foe}
        leaveLabel="Give up" leaveQuestion="Give up? It counts as a loss."
        onMove=${async (from, mv, to) => {
          try { setMatch(await api(`matches/${m.id}/move`, { from, move: mv, to })); }
          catch (e) { try { setMatch(await api('matches/' + m.id)); } catch {} throw e; }
        }}
        onLeave=${async () => { try { await api(`matches/${m.id}/leave`, {}); } catch {} await liveOver(false); }}
        onSettled=${() => { const w = matchRef.current?.state?.winner; if (w != null) liveOver(w === m.you); }} /></div>`;
    }
    const o = opp ?? v?.run?.opp;
    if (state && o) {
      return html`<div class="screen city"><${BattleBoard} state=${state} you=${0} eyebrow="Ranked" title="vs ${o.name}" foeName=${o.name}
        leaveLabel="Give up" leaveQuestion="Give up? It counts as a loss."
        onMove=${async (from, mv, to) => {
          try {
            const r = await api('ranked/move', { from, move: mv, to });
            if (r.profile) set({ profile: r.profile });
            if (r.view) setView(r.view);
            pending.current = r.result;
            if (r.state) setState(r.state);
          } catch (e) { await load(true); throw e; }
        }}
        onLeave=${async () => {
          try {
            const r = await api('ranked/leave', {});
            if (r.profile) set({ profile: r.profile });
            if (r.view) setView(r.view);
            if (r.result) show(r.result); else go({ k: 'lobby' });
          } catch { go({ k: 'lobby' }); }
        }}
        onSettled=${() => { const r = pending.current; if (r) { pending.current = null; show(r); } }} /></div>`;
    }
  }

  if (k === 'loading' || !v) return html`<${Screen} close=${done} title="Ranked">${k === 'loading' ? html`<div class="center" style="height: 60%;"><div class="spinner"></div></div>`
    : error && html`<p class="err" style="text-align: center;">${error}</p>`}<//>`;

  if (k === 'rewards') return html`<${Screen} close=${() => go({ k: 'lobby' })} title="Season rewards">
    <div class="mwrap mgrid">
      <section class="panel" style="padding: 4px 18px;">
        ${v.rewards.map((rw, i) => html`<div class="row rk-reward">
          <${RankEmblem} rank=${i} size="34" />
          <span class="head" style="font-size: 16px; color: ${rankColor(i)};">${name(i)}</span>
          ${i === v.best && html`<span class="tiny" style="color: ${GREEN};">best</span>`}
          <span class="grow"></span>
          ${rw.pack && html`<${PackImg} type=${rw.pack} height="34" />`}
          <span class="row head" style="gap: 5px; font-size: 15px; color: var(--gold-hi);"><${Coin} size="14" />${fmt(rw.gold)}</span>
        </div>`)}
      </section>
      <div class="col">
        <p class="soft small" style="margin: 0;"><${Clock} /> Season ${v.season} ends in <b class="head" style="color: var(--fg);">${left(v.seasonEnds)}</b>. You get the reward for the highest rank you reach this season.</p>
        <section class="panel pad col" style="gap: 6px;">
          <span class="label" style="font-size: 11px;">Every week</span>
          <span class="small soft">#1 ranks up 3 · #2–3 up 2 · #4–10 up 1 · #11–20 stay · #21–30 rank down 1</span>
          <span class="small soft">Win +25 · Lose −20 that week. Everyone's in the standings, so skipping a week can drop you. A new season drops everyone 2 ranks.</span>
        </section>
      </div>
    </div><//>`;

  if (k === 'searching') return html`<${Screen} close=${cancelSearch} title="Ranked">
    <div class="mcenter">
      <div class="rk-radar" style="--rc: ${rankColor(v.rank)};"><span class="ring r1"></span><span class="ring r2"></span><span class="sweep"></span><${RankEmblem} rank=${v.rank} size="100" /></div>
      <h2 class="h2" style="font-size: 26px;">Finding a match…</h2>
      <${Elapsed} since=${searchStart.current} />
      <p class="small muted" style="margin: 0;">Looking for a player to battle live. If nobody's on,<br />you'll face a computer player or another player's team.</p>
      <button class="btn out" style="width: 180px;" onClick=${cancelSearch}>Cancel</button>
    </div><//>`;

  if (k === 'found') {
    const myTeam = s.profile?.team ?? [];
    const foeName = match ? (match.players[1 - match.you] ?? 'Opponent') : (v.run?.opp.name ?? 'Opponent');
    const foeTeam = match ? (match.state?.teams[1 - match.you].map(u => u.id) ?? []) : (v.run?.opp.team ?? []);
    const o = opp ?? v.run?.opp;
    return html`<${Screen} close=${done} hideClose title="">
      <div class="mcenter" style="max-width: 760px;">
        <span class="label">Match found</span>
        <div class="row rk-vs">
          <${Side} name=${s.profile?.username ?? 'You'} rank=${v.rank} rname=${name(v.rank)} team=${myTeam} me />
          <span class="head" style="font-size: 26px; color: var(--pink);">VS</span>
          <${Side} name=${foeName} rank=${match ? null : v.run?.opp.rank} rname=${name(v.run?.opp.rank)} team=${foeTeam} />
        </div>
        <p class="small muted" style="margin: 0;">${match ? "Live match: you're both playing now." : o?.bot ? `${foeName} is a computer player.` : `${foeName} isn't online: you're facing their team, played by the computer.`}</p>
        <p class="soft" style="margin: 0;">Win <b class="head" style="color: ${GREEN};">+25</b> · Lose <b class="head" style="color: ${RED};">−20</b></p>
        <button class="btn gold big" style="width: min(360px, 100%);" onClick=${() => go({ k: 'fight' })}>Battle</button>
      </div><//>`;
  }

  if (k === 'result') {
    const r = phase.r, pc = placeColor(r.place, v.rank), c = r.won ? GREEN : RED;
    return html`<${Screen} close=${done} hideClose title="">
      <div class="mcenter">
        <span class="label" style="color: ${c};">${r.won ? 'Victory' : 'Defeat'}</span>
        <span class="head" style="font-size: 64px; line-height: 1; color: ${c};">${r.delta >= 0 ? '+' + r.delta : r.delta}</span>
        <span class="soft">points this week · <b class="head" style="color: var(--fg);">${r.points}</b> total</span>
        <div class="row rk-place" style="--pc: ${pc};">
          <span class="head soft">#${r.from}</span><${Icon} name="right" size="14" style="color: var(--soft);" />
          <span class="head" style="font-size: 22px; color: ${pc};">#${r.place}</span><span class="small" style="color: ${pc};">${outlook(r.place, v.rank)}</span>
        </div>
        ${r.won && html`<div class="row" style="gap: 10px; width: min(360px, 100%);">
          <div class="panel stat grow"><b>+${r.gold}</b><span class="tiny muted">Gold</span></div>
          <div class="panel stat grow"><b>+${r.xp}</b><span class="tiny muted">XP</span></div></div>`}
        <div class="col" style="width: min(360px, 100%); margin-top: 18px;">
          <button class="btn gold big wide" onClick=${startSearch}>Play again</button>
          <button class="btn out wide" onClick=${() => go({ k: 'lobby' })}>Done</button>
        </div>
      </div><//>`;
  }

  if (k === 'week') return html`<${Week} m=${phase.m} name=${name} onDone=${seen} />`;

  if (k === 'season') {
    const r = phase.r;
    return html`<${Screen} close=${done} hideClose title="">
      <div class="mcenter">
        <span class="label">Season ${r.season} rewards</span>
        <${RankEmblem} rank=${r.rank} size="120" />
        <span class="head" style="font-size: 28px;">You reached <span style="color: ${rankColor(r.rank)};">${name(r.rank)}</span></span>
        <span class="row head" style="gap: 6px; font-size: 22px; color: var(--gold-hi);"><${Coin} size="20" />${fmt(r.gold)} gold</span>
        ${r.pack && html`<${PackImg} type=${r.pack} height="160" />`}
        <p class="small muted" style="margin: 0;">A new season starts now: everyone drops 2 ranks.</p>
        ${error && html`<p class="err" style="margin: 0;">${error}</p>`}
        <button class="btn gold big" style="width: min(360px, 100%);" disabled=${busy} onClick=${claim}>Claim</button>
      </div><//>`;
  }

  // lobby
  return html`<${Screen} close=${done} title="Ranked" right=${html`<button class="btn out" onClick=${() => go({ k: 'rewards' })}>Rewards</button>`}>
    <div class="mwrap mgrid rk-lobby">
      <div class="col">
        <section class="panel rk-head" style="--rc: ${rankColor(v.rank)};">
          <${RankEmblem} rank=${v.rank} size="72" />
          <div class="col grow" style="gap: 3px;">
            <span class="head" style="font-size: 24px; color: ${rankColor(v.rank)};">${name(v.rank)}</span>
            <span class="small soft">You're <b class="head" style="color: ${placeColor(v.place, v.rank)};">#${v.place}</b> this week · <b class="head" style="color: var(--fg);">${v.points}</b> pts</span>
          </div>
          <div class="col" style="gap: 2px; align-items: flex-end;"><span class="tiny muted">Week ends in</span><${WeekLeft} t=${v.weekEnds} /></div>
        </section>
        <div class="row tiny muted rk-legend"><span style="color: ${GREEN};">Top 10 rank up</span><span>11–20 stay</span><span style="color: ${RED};">${v.rank === 0 ? "Rookies can't drop" : 'Bottom 10 rank down'}</span></div>
        <section class="panel pad col rk-rules" style="gap: 6px;">
          <span class="label" style="font-size: 11px;">How it works</span>
          <span class="small soft">Live against a player searching now, or another player's team played by the computer. Win +25 · Lose −20 points; a win also pays 150 gold and 100 XP.</span>
        </section>
        <div class="rk-cta">
          ${error && html`<p class="err" style="margin: 0 0 10px; text-align: center;">${error}</p>`}
          <button class="btn gold big wide" onClick=${startSearch}>Find a match</button>
        </div>
      </div>
      <${Table} v=${v} />
    </div><//>`;
}

function Table({ v }) {
  const ref = useRef();
  useEffect(() => {   // centre your row inside the table only (not the whole page)
    const t = ref.current, me = t?.querySelector('.rk-me');
    if (me) t.scrollTop = me.offsetTop - t.clientHeight / 2 + me.offsetHeight / 2;
  }, []);
  return html`<section class="panel rk-table" ref=${ref} aria-label="This week's standings">
    ${v.table.map(r => html`<div class="row rk-row ${r.me ? 'rk-me' : ''} ${r.place === 11 ? 'cut-up' : r.place === 21 ? 'cut-down' : ''}">
      <span class="head soft" style="width: 26px; text-align: right; font-size: 13px;">${r.place}</span>
      <span class="head grow ellipsis" style="font-size: 14px; color: ${r.me ? '#FFD23D' : 'var(--fg)'};">${r.name}${r.me && html`<span class="tiny soft" style="font-family: var(--body);">  (you)</span>`}</span>
      <span class="head num" style="font-size: 13px;">${r.points}</span>
      <span style="width: 34px; text-align: right; font-size: 10px; color: ${placeColor(r.place, v.rank)};">${arrows(r.place, v.rank)}</span>
    </div>`)}
  </section>`;
}

function Side({ name, rank, rname, team, me }) {
  return html`<div class="panel col rk-side ${me ? 'lit' : ''}">
    <${Avatar} id=${team[0] ?? 'volt'} size="56" />
    <span class="head ellipsis" style="font-size: 18px; max-width: 100%;">${name}</span>
    ${rank != null && html`<span class="row" style="gap: 4px;"><${RankEmblem} rank=${rank} size="26" /><span class="head" style="font-size: 12px; color: ${rankColor(rank)};">${rname}</span></span>`}
    <div class="row" style="gap: 4px;">${team.map(id => html`<img src=${art(id)} alt="" class="rk-mini" />`)}</div>
  </div>`;
}

function Week({ m, name, onDone }) {
  const change = m.to - m.from;
  useEffect(() => { Sound.play(change > 0 ? 'legendary' : change < 0 ? 'defeat' : 'rare'); }, []);
  return html`<${Screen} hideClose title="">
    <div class="mcenter">
      <span class="label" style="color: ${GREEN};">Week results</span>
      <span class="head" style="font-size: 32px;">You finished #${m.place}</span>
      <span class="soft">${change > 1 ? `Ranked up ${change === 2 ? 'twice' : '3 times'}` : change === 1 ? 'Ranked up' : change < 0 ? 'Ranked down' : 'Held your rank'}</span>
      <div class="row" style="gap: 14px; padding: 10px 0;">
        ${change !== 0 && html`<${RankEmblem} rank=${m.from} size="64" style="opacity: .5;" /><${Icon} name="right" size="20" style="color: var(--soft);" />`}
        <${RankEmblem} rank=${m.to} size="120" />
      </div>
      <span class="head" style="font-size: 30px; color: ${rankColor(m.to)};">${name(m.to)}</span>
      <span class="small muted">A new week starts now.</span>
      <button class="btn gold big" style="width: min(360px, 100%); margin-top: 18px;" onClick=${onDone}>Let's go</button>
    </div><//>`;
}

function WeekLeft({ t }) { useNow(60000); return html`<span class="head" style="font-size: 16px;">${left(t)}</span>`; }
function Elapsed({ since }) {
  useNow(1000);
  const s = Math.max(0, Math.floor((Date.now() - since) / 1000));
  return html`<span class="head soft" style="font-size: 20px;">${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}</span>`;
}
const Clock = () => html`<${Icon} name="clock" size="13" style="vertical-align: -2px;" />`;
