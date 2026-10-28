// Gauntlet (GauntletView in the app): lobby → fight → between fights → … → run over. Endless; one loss ends the run.
// Packs won wait in the Play tab's Packs row.
import { html, useState, useEffect, useRef } from '../vendor/preact-htm.js';
import { api, refresh, set, useStore } from '../store.js';
import { Screen, Modal, Icon, Coin, Avatar, PackImg, fmt } from '../ui.js';
import { card, art, maxHP, fusionOf } from '../cards.js';
import { Sound, Music } from '../sound.js';
import { BattleBoard } from './battle.js';

export function Gauntlet({ close }) {
  const s = useStore();
  const [phase, setPhase] = useState({ k: 'loading' });   // loading | lobby | fight | between | over
  const [home, setHome] = useState(null);
  const [run, setRun] = useState(null);
  const [won, setWon] = useState(null);       // the fight just won (gold, maybe a pack)
  const [before, setBefore] = useState([]);   // HP at the end of the last fight, before the heal
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [board, setBoard] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const pending = useRef(null), runRef = useRef(null);
  runRef.current = run;
  const done = () => { close(); refresh(); };

  useEffect(() => { if (phase.k !== 'loading') Music.play(phase.k === 'fight' ? 'battle' : 'menu'); }, [phase.k]);

  // A run left open picks up where it was; otherwise the lobby.
  useEffect(() => {
    api('gauntlet').then(h => {
      setHome(h);
      if (h.run) { setRun(h.run); setPhase({ k: h.run.state ? 'fight' : 'between' }); } else setPhase({ k: 'lobby' });
    }).catch(e => { setError(e.message); setPhase({ k: 'lobby' }); });
  }, []);

  const act = async work => {
    setBusy(true);
    try { await work(); setError(null); } catch (e) { setError(e.message); }
    setBusy(false);
  };
  const start = () => act(async () => {
    const r = await api('gauntlet/start', {});
    setRun(r); setWon(null); setBefore([]);
    setPhase({ k: r.state ? 'fight' : 'between' });
  });
  const next = () => act(async () => { const r = await api('gauntlet/next', {}); setRun(r); setWon(null); setPhase({ k: 'fight' }); });
  async function end() {
    try {
      const r = await api('gauntlet/leave', {});
      if (r.profile) set({ profile: r.profile });
      if (r.result) { setPhase({ k: 'over', r: r.result }); return; }
    } catch {}
    done();
  }

  // The last hits have played out: between-fights or run-over.
  function finishFight() {
    const r = pending.current;
    if (!r) return;
    pending.current = null;
    if (r.won) {
      if (lastState.current) setBefore(lastState.current.teams[0].map(u => u.hp));
      setWon(r);
      Sound.play('victory');
      setPhase({ k: 'between' });
    } else {
      Sound.play('defeat');
      setPhase({ k: 'over', r });
    }
  }
  const lastState = useRef(null);

  const k = phase.k;
  if (k === 'fight' && run?.state) {
    lastState.current = run.state;
    return html`<div class="screen city"><${BattleBoard} state=${run.state} you=${0} eyebrow="Gauntlet · Fight ${run.fight}" title="Streak ${run.wins}"
      foeName="The enemy" leaveLabel="Quit" leaveQuestion="Quit this run? Your streak of ${run.wins} still counts."
      onMove=${async (from, mv, to) => {
        try {
          const r = await api('gauntlet/move', { from, move: mv, to });
          if (r.profile) set({ profile: r.profile });
          pending.current = r.result;
          if (r.run) setRun(r.run);
        } catch (e) {
          try { const h = await api('gauntlet'); if (h.run) setRun(h.run); } catch {}
          throw e;
        }
      }}
      onLeave=${end} onSettled=${finishFight} /></div>`;
  }

  if (board) return html`<${Leaderboard} onClose=${() => setBoard(false)} />`;

  if (k === 'loading') return html`<${Screen} close=${done} title="Gauntlet"><div class="center" style="height: 60%;"><div class="spinner"></div></div><//>`;

  if (k === 'over') {
    const r = phase.r;
    return html`<${Screen} close=${done} hideClose title="">
      <div class="mcenter">
        <span class="label" style="color: #FF7884;">Run over</span>
        <span class="head g-big">${r.streak ?? 0}</span>
        <span class="soft" style="margin-top: -10px; font-size: 16px;">fights won</span>
        ${r.newBest && html`<span class="g-best">New best!</span>`}
        <div class="stats3" style="width: min(460px, 100%); margin-top: 14px;">
          <div class="panel stat"><b>${fmt(r.gold ?? 0)}</b><span class="tiny muted">Gold earned</span></div>
          <div class="panel stat"><b>${r.packs ?? 0}</b><span class="tiny muted">${(r.packs ?? 0) === 1 ? 'Pack' : 'Packs'}</span></div>
          <div class="panel stat"><b>#${r.rank ?? 1}</b><span class="tiny muted">Among friends</span></div>
        </div>
        ${error && html`<p class="err" style="margin: 0;">${error}</p>`}
        <div class="col" style="width: min(360px, 100%); margin-top: 18px;">
          <button class="btn gold big wide" disabled=${busy} onClick=${start}>Run it back</button>
          <button class="btn out wide" onClick=${done}>Done</button>
        </div>
      </div><//>`;
  }

  if (k === 'between' && run) {
    const fus = id => fusionOf(s.profile, id);   // shortcut: uses today's best fused copy for max HP, not the one the run started with
    return html`<${Screen} close=${() => setConfirmEnd(true)} eyebrow="Gauntlet · Streak ${run.wins}" title=${run.wins > 0 ? `Fight ${run.wins} cleared!` : 'Ready'}>
      <div class="mwrap col" style="gap: 16px;">
        <div class="row" style="gap: 12px; flex-wrap: wrap;">
          ${won?.gold != null && html`<span class="g-gold"><${Coin} size="18" />+${fmt(won.gold)} gold</span>`}
          <span class="small muted">This run: ${fmt(run.gold)} gold</span>
        </div>
        <div class="mgrid">
          <${Panel} title="Your team" trailing=${before.length ? 'Healed 20%' : null} tcolor="#3DFF8A">
            <div class="g-cards">${run.team.map((id, i) => html`<${HpCard} id=${id} hp=${run.hp[i]} max=${card(id) ? maxHP(card(id), fus(id)) : 1}
              healed=${before.length > i ? run.hp[i] - before[i] : 0} />`)}</div>
          <//>
          <${Panel} title="Next · Fight ${run.fight}" trailing="win for ${fmt(run.nextGold)} gold">
            <div class="g-cards">${[0, 1, 2].map(i => run.enemies[i] && card(run.enemies[i])
              ? html`<div class="tile" style="--edge: rgba(255,77,94,.5);"><img src=${art(run.enemies[i])} alt="" /><span class="head ellipsis" style="font-size: 13px;">${card(run.enemies[i]).name}</span></div>`
              : html`<span></span>`)}</div>
          <//>
        </div>
        ${error && html`<p class="err" style="margin: 0; text-align: center;">${error}</p>`}
        <button class="btn gold big g-cta" disabled=${busy} onClick=${next}>Next fight</button>
      </div>
      ${confirmEnd && html`<${Modal} label="End run" onClose=${() => setConfirmEnd(false)}>
        <div class="col" style="text-align: center;">
          <span class="h2">End this run?</span>
          <span class="soft">Your streak of ${run.wins} still counts.</span>
          <button class="btn gold wide" disabled=${busy} onClick=${() => { setConfirmEnd(false); act(end); }}>End run</button>
          <button class="btn out wide" onClick=${() => setConfirmEnd(false)}>Keep going</button>
        </div><//>`}
    <//>`;
  }

  // lobby
  return html`<${Screen} close=${done} title="Gauntlet">
    <div class="mwrap mgrid g-lobby">
      <div class="col" style="gap: 16px;">
        <section class="g-hero">
          <${Icon} name="swords" size="42" style="color: var(--brass);" />
          <span class="label" style="margin-top: 8px;">Your best streak</span>
          <span class="head g-best-n">${home?.best ?? 0}</span>
          <span class="soft" style="text-align: center;">Fight until you fall. Damage carries over;<br />each win heals your team 20%.</span>
        </section>
        <div class="g-cta-wrap">
          ${error && html`<p class="err" style="margin: 0 0 10px; text-align: center;">${error}</p>`}
          <button class="btn gold big wide" disabled=${busy} onClick=${start}>Start run</button>
        </div>
      </div>
      <div class="col" style="gap: 16px; order: 1;">
        <${Panel} title="Rewards per win" trailing="gold · pack every 10"><${Ladder} /><//>
        <${Panel} title="Friends">
          <div>${(home?.top ?? []).map((r, i, a) => html`<${LeaderRow} r=${r} compact last=${i === a.length - 1} />`)}</div>
          <button class="link" style="align-self: flex-end; min-height: 36px;" onClick=${() => setBoard(true)}>See leaderboard ›</button>
        <//>
      </div>
    </div>
  <//>`;
}

function Panel({ title, trailing, tcolor = 'var(--soft)', children }) {
  return html`<section class="panel col g-panel" style="gap: 10px;">
    <div class="row" style="justify-content: space-between;"><span class="label" style="font-size: 12px; letter-spacing: 2.5px;">${title}</span>
      ${trailing && html`<span class="tiny" style="color: ${tcolor};">${trailing}</span>`}</div>
    ${children}
  </section>`;
}

// Fight 1 pays 75 gold, each win 25 more; a free pack every 10 wins.
function Ladder() {
  return html`<div class="g-ladder" role="img" aria-label="Fight 1 pays 75 gold, each win 25 more; a free pack every 10 wins">
    ${Array.from({ length: 10 }, (_, i) => i + 1).map(n => html`<div class="col" style="gap: 4px; align-items: center;">
      <span class="g-step ${n === 1 ? 'on' : ''} ${n === 10 ? 'pack' : ''}">${n === 10 ? html`<${PackImg} type="cyber" height="30" />` : 50 + 25 * n}</span>
      <span class="tiny muted" style="font-size: 10px;">${n}</span></div>`)}
  </div>`;
}

function HpCard({ id, hp, max, healed }) {
  const c = card(id), ko = hp === 0;
  const pct = Math.max(0, (hp - healed) / max), heal = Math.max(0, healed / max);
  const col = pct > 0.5 ? '#3DFF8A' : pct > 0.25 ? '#FFB03D' : '#FF4D5E';
  return html`<div class="tile g-hp ${ko ? 'ko' : ''}" aria-label=${ko ? `${c?.name}: knocked out` : `${c?.name}: ${hp} of ${max} HP`}>
    <div style="position: relative;">
      <img src=${art(id)} alt="" />
      ${ko && html`<span class="g-ko">KO</span>`}
      ${healed > 0 && html`<span class="g-heal">+${healed}</span>`}
    </div>
    <div class="row" style="gap: 4px;"><span class="head grow ellipsis" style="font-size: 13px;">${c?.name ?? id}</span><span class="head soft num" style="font-size: 13px;">${hp}</span></div>
    <div class="g-bar"><i style="width: ${(pct + heal) * 100}%; background: rgba(61,255,138,.45);"></i><i style="width: ${pct * 100}%; background: ${col};"></i></div>
  </div>`;
}

// One leaderboard line: rank (gold / silver / bronze for the top 3), picture, name, best streak.
function LeaderRow({ r, compact, last }) {
  const medal = r.rank === 1 ? '#FFD77A' : r.rank === 2 ? '#C9C6DA' : r.rank === 3 ? '#D9895A' : '#8E8AA8';
  return html`<div class="row g-lrow ${compact ? 'compact' : ''} ${r.me && !compact ? 'g-me' : ''} ${compact && !last ? 'sep' : ''}">
    <span class="head" style="width: ${compact ? 18 : 26}px; text-align: center; font-size: ${compact ? 15 : 17}px; color: ${medal};">${r.rank}</span>
    <${Avatar} id=${r.avatar} size=${compact ? 34 : 40} />
    <span class="head grow ellipsis" style="font-size: ${compact ? 15 : 16}px; color: ${r.me && compact ? 'var(--brass)' : 'var(--fg)'};">${r.name}${r.me && !compact && html`<span style="font-size: 12px; color: var(--brass);">  (you)</span>`}</span>
    <span class="row head" style="gap: 6px; font-size: ${compact ? 15 : 18}px;">${r.best}<${Icon} name="swords" size=${compact ? 14 : 16} style="color: var(--muted);" /></span>
  </div>`;
}

// Best Gauntlet streaks, friends or everyone. A load replaced by a newer one (switching tabs) is dropped, not an error.
function Leaderboard({ onClose }) {
  const [everyone, setEveryone] = useState(false);
  const [rows, setRows] = useState([]);
  const [error, setError] = useState(null);
  useEffect(() => {
    let live = true;
    api('leaderboard/' + (everyone ? 'everyone' : 'friends'))
      .then(r => { if (live) { setRows(r); setError(null); } })
      .catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [everyone]);
  const tab = (t, on, f) => html`<button class="g-scope ${on ? 'on' : ''}" aria-pressed=${on} onClick=${f}>${t}</button>`;
  return html`<${Screen} close=${onClose} title="Leaderboard">
    <div class="mwrap col narrow" style="gap: 14px;">
      <div class="row panel" style="padding: 4px; gap: 0;">${tab('Friends', !everyone, () => setEveryone(false))}${tab('Everyone', everyone, () => setEveryone(true))}</div>
      <span class="label" style="letter-spacing: 2.5px;">Best Gauntlet streak</span>
      ${error && html`<p class="err" style="margin: 0;">${error}</p>`}
      <section class="panel col" style="padding: 6px; gap: 2px;">${rows.map(r => html`<${LeaderRow} r=${r} />`)}</section>
    </div><//>`;
}
