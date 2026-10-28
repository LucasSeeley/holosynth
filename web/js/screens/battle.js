// The battle screen (BattleBoard in the app), shared by the campaign, friend battles, ranked, gauntlet and the hunt.
// Wide: battle log on the left, the board in the middle, moves and power cards on the right; keys 1 2 3 pick a card,
// Q W E a move, then click a target (never an auto attack). Phones: the app's single column with the move bar below.
// New moves from the server play back one at a time: the attacker lunges, the target shakes and flashes,
// the number pops and the HP bar drains.
import { html, useEffect, useRef, useReducer } from '../vendor/preact-htm.js';
import { card as cardOf, art, classColor, rarityColor, dmg as dmgOf, power as powerOf, passiveOf, POWER_VIOLET } from '../cards.js';
import { api, warm } from '../store.js';
import { Icon, Modal, sleep } from '../ui.js';
import { Sound, Music } from '../sound.js';

// Same table as the server: each class beats two others (+20%).
const BEATS = {
  Fighter: ['Beast', 'Arcanist'], Beast: ['Mech', 'Mystic'], Mech: ['Fighter', 'Spirit'],
  Arcanist: ['Spirit', 'Beast'], Spirit: ['Mystic', 'Fighter'], Mystic: ['Arcanist', 'Mech'],
};
const MOVE_KEYS = { basic: 'Q', special: 'W', special2: 'E' };
const STATUS = [['sh', 'shield'], ['mi', 'swap'], ['oc', 'bolt'], ['od', 'flame']];   // power cards waiting on a card
const clone = s => JSON.parse(JSON.stringify(s));
const key = (side, i) => side * 10 + i;
const pv = c => passiveOf(c)?.value || 0;
const verb = () => matchMedia('(hover: hover)').matches ? 'Click' : 'Tap';

export function BattleBoard({ state, you, eyebrow, title, foeName, leaveLabel, leaveQuestion, onMove, onLeave, onSettled }) {
  const [, bump] = useReducer(n => n + 1, 0);
  // everything the playback loop touches lives in one mutable object (like the app's @State), re-rendered with bump()
  const m = useRef(null);
  if (!m.current) m.current = { shown: state, latest: state, acting: null, fx: {}, selected: null, move: null, sending: false,
    preHit: null, playing: false, strike: null, error: null, confirm: false, alive: true };
  const v = m.current, els = useRef({});
  const props = useRef({}); props.current = { onMove, onSettled };

  const s = v.shown;
  const myTurn = s.turn === you && s.winner == null && !v.playing;
  const fxOf = k => (v.fx[k] ||= {});
  const set = (k, patch) => { Object.assign(fxOf(k), patch); };
  const shake = k => els.current[k]?.animate?.([{ transform: 'translateX(0)' }, { transform: 'translateX(-7px)' }, { transform: 'translateX(7px)' },
    { transform: 'translateX(-5px)' }, { transform: 'translateX(4px)' }, { transform: 'translateX(0)' }], { duration: 450, easing: 'linear' });

  // ---- rules shown on screen ----
  const team = s.teams[you];
  const selCard = v.selected != null && team[v.selected] ? cardOf(team[v.selected].id) : null;
  const selUnit = v.selected != null ? team[v.selected] : null;
  const powerMove = v.move?.startsWith('pw:') ? powerOf(v.move) : null;
  const healing = v.move === 'special' && !!selCard?.special.heal;
  const powerCanTarget = (p, unit, i) => p.target === 'ko' ? unit.hp === 0 : p.target === 'acted' ? unit.hp > 0 && i !== v.selected && s.acted[you][i] : unit.hp > 0;
  const targetable = (unit, mine, ko, i) => {
    if (!myTurn || v.selected == null || !v.move) return false;
    if (powerMove) return mine && powerCanTarget(powerMove, unit, i);
    return !ko && (healing ? mine : !mine);
  };
  // Same sum as the server's hitFor: passives, then +20% when the attacker's class beats the target's, then the target's guard.
  const preview = target => {
    if (powerMove || v.selected == null || !v.move) return null;
    const u = team[v.selected], a = cardOf(u.id), t = cardOf(target.id);
    if (!a || !t) return null;
    if (healing) {
      const amount = dmgOf(a, 'special', u.f) * (u.ps === 'blessing' ? 1 + pv(a) / 100 : 1);
      return Math.min(Math.round(amount), (target.max ?? t.hp) - target.hp);
    }
    const low = (x, c) => x.hp < (x.max ?? c.hp) * 0.3;
    let pct = 100;
    if (u.ps === 'firststrike' && !u.hit) pct += pv(a);
    else if (u.ps === 'momentum' && v.move === 'basic') pct += pv(a) * (u.mom || 0);
    else if (u.ps === 'executioner' && low(target, t)) pct += pv(a);
    else if (u.ps === 'laststand' && low(u, a)) pct += pv(a);
    let d = Math.round(dmgOf(a, v.move, u.f) * pct / 100 * ((BEATS[a.cls] || []).includes(t.cls) ? 1.2 : 1));
    if (target.ps === 'armor' || (target.ps === 'phaseshift' && !target.ph)) d = Math.round(d * (1 - pv(t) / 100));
    return d;
  };
  const prompt = () => {
    if (v.preHit) return 'Charging…';   // drawn back, waiting on the server
    if (v.playing) return v.acting === you ? (v.strike || '') : `${foeName} attacks…`;
    if (s.winner != null) return '';
    if (s.turn !== you) return `Waiting for ${foeName}…`;
    const T = verb();
    if (powerMove) return powerMove.target === 'ko' ? `${T} a knocked-out card to revive it` : powerMove.target === 'acted' ? `${T} a card that already went to let it act again`
      : `${T} one of your cards for ${powerMove.name}`;
    if (selCard && v.move) {
      if (healing) return `${T} one of your cards to heal it with ${selCard.special.name}`;
      return `${T} an enemy to hit it with ${v.move === 'special' ? selCard.special.name : v.move === 'special2' ? selCard.special2?.name || '' : selCard.basic.name}`;
    }
    if (selCard) return (s.pw?.[you] || []).length ? `${selCard.name} is up. Choose a move or a power card.` : `${selCard.name} is up. Choose a move.`;
    const ready = team.map((u, i) => i).filter(i => team[i].hp > 0 && !s.acted[you][i]);
    if (ready.length === 1) {
      const c = cardOf(team[ready[0]].id);
      return team.length > 1 && s.acted[you].includes(true) ? `${c.name} hasn't gone yet this round. ${T} ${c.name}.` : `${T} ${c.name} to act`;
    }
    return `${T} one of your glowing cards`;
  };

  // ---- input ----
  const send = (from, mv, to) => {
    // an attack on the enemy starts on the tap: the card draws back (charging) while the server rolls the hit,
    // then strikes as the answer lands, so the trip to the server is hidden in the wind-up
    if ((mv === 'basic' || mv === 'special') && !healing && !v.playing) {
      v.preHit = { from, to, move: mv };
      v.selected = null; v.move = null; v.acting = you;
      set(key(you, from), { lunge: -0.35, t: 'transform .25s ease-out' });
    }
    v.sending = true; v.error = null; bump();
    // stays locked until the move has played out (playBack unlocks), so nothing can be clicked mid-attack
    props.current.onMove(from, mv, to).catch(e => {
      v.error = e.message; v.move = null; v.sending = false;
      if (v.preHit) { set(key(you, v.preHit.from), { lunge: 0, t: 'transform .3s ease' }); v.preHit = null; v.acting = null; }
      if (v.alive) bump();
    });
  };
  const tap = (side, i) => {
    const unit = s.teams[side][i];
    if (!myTurn || v.sending || !unit) return;
    if (side === you && powerMove && v.selected != null) { if (powerCanTarget(powerMove, unit, i)) send(v.selected, v.move, i); return; }
    if (unit.hp <= 0) return;
    if (side === you && healing && v.selected != null) send(v.selected, 'special', i);
    else if (side === you) {
      if (s.acted[you][i]) return;
      warm();   // picking a card: get the connection ready for the attack
      Sound.play('select');
      if (v.selected === i) { v.selected = null; v.move = null; } else { v.selected = i; v.move = null; }
      v.error = null; bump();
    } else if (v.selected != null && v.move) send(v.selected, v.move, i);
  };
  const choose = kind => {
    if (v.selected == null || !myTurn || v.sending) return;
    const u = team[v.selected];
    if (kind === 'special2' && u.cd2 == null) return;
    if (kind !== 'basic' && (kind === 'special2' ? u.cd2 : u.cd) > 0) return;
    Sound.play('move');
    v.move = kind; bump();   // then click the target, even when there's only one
  };
  // A power card from the hand: no target needed plays it straight away.
  const choosePower = p => {
    if (v.selected == null || !myTurn || v.sending) { v.error = myTurn ? 'Pick one of your cards first' : null; bump(); return; }
    Sound.play('move');
    if (p.target === 'none') { send(v.selected, 'pw:' + p.id, 0); return; }
    v.move = 'pw:' + p.id;
    const ok = team.map((u, i) => i).filter(i => powerCanTarget(p, team[i], i));
    if (ok.length === 1) send(v.selected, v.move, ok[0]); else bump();
  };

  // keys: 1 2 3 pick one of your cards, Q W E a move, Escape asks to leave
  useEffect(() => {
    const k = e => {
      if (e.target.closest?.('input, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Escape') { if (v.shown.winner == null) { v.confirm = !v.confirm; bump(); } return; }
      const n = Number(e.key);
      if (n >= 1 && n <= 3 && v.shown.teams[you][n - 1]) { e.preventDefault(); tapRef.current(you, n - 1); return; }
      const mv = { q: 'basic', w: 'special', e: 'special2' }[e.key.toLowerCase()];
      if (mv) { e.preventDefault(); chooseRef.current(mv); }
    };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, []);
  const tapRef = useRef(tap), chooseRef = useRef(choose);
  tapRef.current = tap; chooseRef.current = choose;

  // ---- playback ----
  const atImpact = (pa, e) => pa.v === 0 && ((pa.p === 1 - e.p && pa.i === e.to) || (pa.p === e.p && pa.i === e.from));
  const guards = e => (e.pas || []).filter(pa => atImpact(pa, e) && pa.p === 1 - e.p).map(pa => pa.n);
  const boosts = e => (e.pas || []).filter(pa => atImpact(pa, e) && pa.p === e.p).map(pa => pa.n);
  const showState = cur => { v.shown = cur; };

  async function playPassives(e, start, skipGuards) {
    const cur = start;
    for (const pa of e.pas || []) {
      if (!cur.teams[pa.p]?.[pa.i] || (skipGuards && atImpact(pa, e))) continue;
      const k = key(pa.p, pa.i), u = cur.teams[pa.p][pa.i];
      u.hp = pa.n === 'Rebirth' ? pa.v : Math.max(0, u.hp + pa.v);
      const amount = pa.n === 'Rebirth' || pa.v === 0 ? '' : pa.v > 0 ? ` +${pa.v}` : ` −${-pa.v}`;
      set(k, { callout: `◆ ${pa.n.toUpperCase()}${amount}`, power: false }); showState(cur); bump();
      await sleep(750);
      set(k, { callout: null }); bump();
    }
    return cur;
  }

  async function hit(cur, p, from, to, dmg, ko, special, dodge, gs, bs, lunged) {
    const a = key(p, from), t = key(1 - p, to);
    if (!lunged && v.acting !== p) { v.acting = p; bump(); await sleep(350); }
    if (p === you) v.strike = dodge ? 'Dodged!' : 'Hit!';
    set(a, { lunge: 1, t: 'transform .14s ease-in' }); bump();   // the strike
    await sleep(140);
    if (dodge) {   // the target slips aside: no damage
      set(a, { lunge: 0, t: 'transform .35s cubic-bezier(.3,1.6,.5,1)' });
      Sound.play('dodge'); shake(t);
      set(t, { callout: '◆ DODGE', power: false }); bump();
      await sleep(800);
      set(t, { callout: null }); bump();
      await sleep(200);
      return cur;
    }
    // impact (a block's callout lands with it)
    const blocked = gs.includes('Deflector');
    const sound = ko ? 'ko' : blocked ? 'deflect' : special ? 'crit' : 'hit';
    Sound.play(sound);
    set(t, { ghostHP: cur.teams[1 - p][to].hp });
    cur.teams[1 - p][to].hp = Math.max(0, cur.teams[1 - p][to].hp - dmg);
    set(a, { lunge: 0, t: 'transform .35s cubic-bezier(.3,1.6,.5,1)' });
    shake(t);
    if (gs[0]) set(t, { callout: '◆ ' + gs[0].toUpperCase(), power: false });
    if (bs[0]) set(a, { callout: '◆ ' + bs[0].toUpperCase(), power: false });
    set(t, { flash: true, heal: false, pop: dmg, popId: (fxOf(t).popId || 0) + 1 });
    showState(cur); bump();
    await sleep(300);
    set(t, { flash: false }); bump();
    const called = gs.length || bs.length;
    await sleep(called ? 550 : 350);
    set(t, { ghostHP: null, pop: null }); if (called) { set(t, { callout: null }); set(a, { callout: null }); }
    bump();
    await sleep(Math.max(450, (Sound.duration(sound) - 0.65 + 0.1) * 1000));   // let the hit sound finish
    return cur;
  }

  async function playBack() {
    if (v.playing) return;   // the running playback picks up later states itself
    v.playing = true;
    while (v.alive && JSON.stringify(v.shown) !== JSON.stringify(v.latest)) {
      const target = v.latest, from = v.shown;
      const fresh = Math.max(0, Math.min((target.moves ?? target.log.length) - (from.moves ?? from.log.length), target.log.length));
      let cur = clone(from);
      v.selected = null; v.move = null; bump();
      for (const e of fresh ? target.log.slice(-fresh) : []) {
        if (!v.alive) return;
        const pw = e.pw && powerOf(e.pw);
        if (pw) {   // a power card: a violet callout on each card it touched
          if (v.acting !== e.p) { v.acting = e.p; bump(); await sleep(350); }
          Sound.play('rare');
          const spots = (e.fx || []).filter(x => cur.teams[x.p]?.[x.i]);
          const keys = spots.length ? spots.map(x => key(x.p, x.i)) : [key(e.p, e.from)];
          for (const x of spots) cur.teams[x.p][x.i].hp = x.hp;
          const hand = cur.pw?.[e.p], at = hand ? hand.indexOf(e.pw) : -1;
          if (at >= 0) hand.splice(at, 1);
          keys.forEach(k => set(k, { callout: '◆ ' + pw.name.toUpperCase(), power: true }));
          showState(cur); bump();
          await sleep(900);
          keys.forEach(k => set(k, { callout: null, power: false })); bump();
          await sleep(250);
          continue;
        }
        if (e.heal != null) {   // a Mystic healing its own side: green glow and a +number, no lunge
          if (!cur.teams[e.p]?.[e.to]) continue;
          const t = key(e.p, e.to);
          if (v.acting !== e.p) { v.acting = e.p; bump(); await sleep(350); }
          Sound.play('heal');
          cur.teams[e.p][e.to].hp += e.heal;
          set(t, { heal: true, flash: true, pop: e.heal, popId: (fxOf(t).popId || 0) + 1 }); showState(cur); bump();
          await sleep(500);
          set(t, { flash: false }); bump();
          await sleep(350);
          set(t, { pop: null }); bump();
          await sleep(Math.max(450, (Sound.duration('heal') - 0.65 + 0.1) * 1000));
          set(t, { heal: false });
          cur = await playPassives(e, cur);
          continue;
        }
        if (!cur.teams[1 - e.p]?.[e.to]) continue;
        let wound = false;
        const pre = v.preHit;
        if (pre && e.p === you && pre.from === e.from && pre.to === e.to && pre.move === e.move) { wound = true; v.preHit = null; }
        cur = await hit(cur, e.p, e.from, e.to, e.dmg, e.ko, e.move !== 'basic', !!e.dodge, guards(e), boosts(e), wound);
        cur = await playPassives(e, cur, !e.dodge);
      }
      if (v.preHit) { set(key(you, v.preHit.from), { lunge: 0, t: 'transform .3s ease' }); v.preHit = null; }   // a wind-up the answer didn't match
      v.shown = target; v.acting = null; bump();
      if (target.turn === you && target.winner == null) Sound.play('turn');
    }
    v.playing = false; v.sending = false; v.strike = null;
    if (!v.alive) return;
    bump();
    if (v.latest.winner != null) Music.stop();
    props.current.onSettled?.();
  }

  // a new state from the server
  useEffect(() => {
    if (state === v.latest) return;
    v.latest = state;
    if (state.winner == null) Music.play('battle');   // "Next battle" reuses this screen: bring the music back
    playBack();   // a fresh battle has fewer moves than what's shown, so it just appears
  }, [state]);
  useEffect(() => {
    warm();
    if (state.winner == null) Music.play('battle');
    return () => { v.alive = false; Music.play('menu'); };
  }, []);

  // ---- pieces ----
  const n = Math.max(s.teams[0].length, s.teams[1].length);
  const token = (side, i) => {
    const unit = s.teams[side][i], c = cardOf(unit.id);
    if (!c) return null;
    const mine = side === you, k = key(side, i), f = v.fx[k] || {};
    const ko = unit.hp === 0, acted = s.acted[side][i];
    const ready = mine && myTurn && !ko && !acted;
    const isSel = mine && v.selected === i && myTurn;
    const isTarget = targetable(unit, mine, ko, i);
    const mx = unit.max ?? c.hp, pct = unit.hp / mx;
    let look = 'idle';
    if (powerMove && isTarget) look = 'power';
    else if ((healing && isTarget) || (f.flash && f.heal)) look = 'green';
    else if (f.flash || isTarget) look = 'red';
    else if ((isSel && !isTarget) || f.lunge) look = 'gold';
    else if (ready) look = 'ready';
    const d = isTarget ? preview(unit) : null;
    const lift = (isSel ? (mine ? -10 : 10) : 0) + (f.lunge || 0) * (mine ? -30 : 30);
    const status = STATUS.filter(([p]) => unit[p]);
    const label = `${c.name}, ${unit.hp} of ${mx} HP${ko ? ', knocked out' : ''}${acted && mine ? ', done this round' : ''}`;
    return html`<button type="button" class="bb-tok ${look} ${ko ? 'ko' : ''} ${mine && acted && myTurn ? 'acted' : ''}"
        style="transform: translateY(${lift}px) scale(${ko ? 0.94 : 1}); transition: ${f.t || 'transform .3s cubic-bezier(.3,1.4,.5,1)'}, opacity .4s, box-shadow .2s, border-color .2s;
          background: linear-gradient(135deg, color-mix(in srgb, ${c.color} 38%, #12111D), color-mix(in srgb, ${c.color} 12%, #0A0912));"
        onClick=${() => tap(side, i)} aria-label=${label} aria-pressed=${isSel ? 'true' : null}
        aria-disabled=${ready || isTarget ? null : 'true'} ref=${el => { els.current[k] = el; }}>
      <span class="bb-art">
        <img src=${art(c.id)} alt="" draggable="false" />
        ${f.flash && html`<span class="bb-flash ${f.heal ? 'heal' : ''}"></span>`}
        ${f.pop != null && html`<span class="bb-pop ${f.heal ? 'heal' : ''}" key=${f.popId}>${f.heal ? '+' : '−'}${f.pop}</span>`}
        ${ko && html`<span class="bb-ko">KO</span>`}
        ${d != null && html`<span class="bb-prev ${healing ? 'heal' : ''}">${healing ? '+' : '−'}${d}</span>`}
        <span class="bb-chips">${acted && !ko && mine ? html`<span class="bb-chip">DONE</span>` : html`<span></span>`}
          ${unit.cd > 0 && !ko && html`<span class="bb-chip">⟳ ${unit.cd}</span>`}</span>
        ${f.callout && html`<span class="bb-call ${f.power ? 'pw' : ''}" key=${f.callout}>${f.callout}</span>`}
        ${status.length > 0 && html`<span class="bb-status">${status.map(([, ic]) => html`<span><${Icon} name=${ic} size="12" /></span>`)}</span>`}
      </span>
      <span class="bb-info">
        <span class="bb-name"><i style="background: ${classColor(c.cls)}" title=${c.cls}></i><b>${c.name}</b><span class="num">${unit.hp}</span></span>
        <span class="bb-hp">${f.ghostHP != null && html`<i class="ghost" style="width: ${100 * f.ghostHP / mx}%"></i>`}
          <i style="width: ${100 * pct}%; background: ${pct > 0.5 ? '#3DFF8A' : pct > 0.25 ? '#FFB03D' : '#FF4D5E'};"></i></span>
      </span>
      ${mine && html`<kbd class="bb-key" aria-hidden="true">${i + 1}</kbd>`}
    </button>`;
  };

  const turnSide = v.acting ?? s.turn, mineTurn = turnSide === you;
  const living = team.map((u, i) => i).filter(i => team[i].hp > 0);
  const left = living.filter(i => !s.acted[you][i]).length;
  const powers = s.pw?.[you] || [];

  const moveBtn = kind => {
    let name, sub, enabled = false;
    if (selCard && selUnit && myTurn) {
      const wait = kind === 'special2' ? (selUnit.cd2 || 0) : selUnit.cd;
      name = kind === 'basic' ? selCard.basic.name : kind === 'special2' ? selCard.special2?.name || 'Special' : selCard.special.name;
      if (kind !== 'basic' && wait > 0) sub = `Ready in ${wait} turn${wait === 1 ? '' : 's'}`;
      else {
        const d = dmgOf(selCard, kind, selUnit.f);
        sub = kind === 'basic' ? `${d} damage` : kind === 'special2' ? `${d} damage · then waits ${selCard.special2?.cd || 0}`
          : selCard.special.heal ? `Heals ${d} · then waits ${selCard.special.cd}` : `${d} damage · then waits ${selCard.special.cd}`;
        enabled = !v.sending;
      }
    } else {
      name = kind === 'basic' ? 'Basic attack' : 'Special';
      sub = myTurn ? 'Pick a card first' : 'Wait for your turn';
    }
    const chosen = v.move === kind && selCard && myTurn;
    return html`<button type="button" class="bb-move ${chosen ? 'on' : ''} ${selCard ? '' : 'dash'}" disabled=${!enabled} onClick=${() => choose(kind)}>
      <span class="col" style="gap: 3px; min-width: 0; flex: 1;"><b class="ellipsis">${name}</b><span class="sub ellipsis">${sub}</span></span>
      <kbd class="bb-key" aria-hidden="true">${MOVE_KEYS[kind]}</kbd></button>`;
  };
  const handEnabled = !!selCard && myTurn && !v.sending;
  const powerHand = powers.length > 0 && html`<div class="bb-hand ${powers.length > 1 ? 'two' : ''} ${handEnabled || powerMove ? '' : 'off'}">
    ${powers.slice(0, 2).map(id => {
      const p = powerOf(id);
      if (!p) return null;
      const picked = powerMove?.id === p.id;
      return html`<button type="button" class="bb-pw ${picked ? 'picked' : ''} ${handEnabled || picked ? 'glow' : ''}" style="--rc: ${rarityColor(p.rarity)}"
          onClick=${() => choosePower(p)} aria-label="Power card: ${p.name}. ${p.effect}" title=${p.effect}>
        <span class="tag">Power</span>
        <span class="pic"><${Icon} name=${p.icon} size="22" /><img src=${art('power_' + p.id)} alt="" onError=${e => { e.target.style.display = 'none'; }} /></span>
        <b>${p.name}</b><span class="eff">${p.short}</span></button>`;
    })}</div>`;

  // class advantage of the selected card over the enemies still standing
  const foes = s.teams[1 - you].filter(u => u.hp > 0).map(u => cardOf(u.id)?.cls);
  const beaten = selCard ? [...new Set(foes.filter(cls => (BEATS[selCard.cls] || []).includes(cls)))] : [];

  // battle log, newest first (from what's on screen, so it never runs ahead of the playback)
  const nameAt = (side, i) => cardOf(s.teams[side]?.[i]?.id)?.name || '?';
  const logRows = s.log.slice(-12).reverse().map(e => {
    const who = e.p === you ? 'you' : 'foe', att = nameAt(e.p, e.from);
    if (e.pw) return { who: 'pw', html: html`${e.p === you ? 'You' : foeName} played <b>${powerOf(e.pw)?.name || 'a power card'}</b> with ${att}.` };
    const c = cardOf(s.teams[e.p]?.[e.from]?.id);
    const mv = e.move === 'basic' ? c?.basic.name : e.move === 'special2' ? c?.special2?.name : c?.special.name;
    if (e.heal != null) return { who: 'heal', html: html`<b>${att}</b> healed ${nameAt(e.p, e.to)} with ${mv}. <span class="g">+${e.heal}</span>` };
    if (e.dodge) return { who: 'dodge', html: html`<b>${nameAt(1 - e.p, e.to)}</b> <span class="c">dodged</span> ${att}’s ${mv}.` };
    return { who, html: html`<b>${att}</b> hit ${nameAt(1 - e.p, e.to)} with ${mv}. <span class=${who === 'you' ? 'y' : 'r'}>−${e.dmg}</span>${e.ko ? html` <span class="r">KO</span>` : ''}` };
  });

  return html`<div class="bb n${n}">
    <header class="bb-top">
      <button type="button" class="close" style="visibility: ${s.winner == null ? 'visible' : 'hidden'};" onClick=${() => { v.confirm = true; bump(); }} aria-label=${leaveLabel}><${Icon} name="x" /></button>
      <div class="bb-title"><span class="label" style="font-size: 11px; letter-spacing: 2.5px;">${eyebrow}</span><span class="head ellipsis" style="font-size: 20px;">${title}</span></div>
      <span class="bb-hints small muted">Keys: <b>1 2 3</b> pick a card · <b>Q W${team.some(u => u.cd2 != null) ? ' E' : ''}</b> moves · click a target</span>
    </header>
    <div class="bb-body">
      <aside class="bb-log" aria-label="Battle log">
        <span class="label">Battle log</span>
        ${logRows.length ? html`<ul>${logRows.map(r => html`<li><i class=${r.who}></i><span>${r.html}</span></li>`)}</ul>`
          : html`<p class="small muted">${s.turn === you ? 'You go first.' : `${foeName} goes first.`}</p>`}
      </aside>
      <section class="bb-board" aria-label="Board">
        <span class="bb-side foe">Enemy</span>
        <div class="bb-row foe">${s.teams[1 - you].map((u, i) => token(1 - you, i))}</div>
        <div class="bb-turn">${s.winner == null && html`<span class="pill ${mineTurn ? 'mine' : 'theirs'}" key=${mineTurn}>${mineTurn ? 'Your turn' : 'Enemy turn'}</span>`}</div>
        <div class="bb-row mine">${team.map((u, i) => token(you, i))}</div>
        <div class="bb-teamlabel"><span class="label" style="font-size: 11px; letter-spacing: 2.5px;">Your team</span>
          ${living.length > 1 && s.winner == null && html`<span class="row" style="gap: 5px;">${living.map((x, i) => html`<i class="pip ${i < left ? 'on' : ''}"></i>`)}
            <span class="tiny muted">${left} of ${living.length} left this round</span></span>`}</div>
      </section>
      <aside class="bb-moves" aria-label="Moves">
        <span class="label bb-who">${selCard ? selCard.name : 'Moves'}</span>
        <p class="bb-prompt ${v.error ? 'err' : myTurn || v.playing ? '' : 'wait'}" role="status" aria-live="polite">${v.error || prompt()}</p>
        <div class="bb-handwrap">${powerHand}</div>
        <div class="bb-btns">${moveBtn('basic')}${moveBtn('special')}${selUnit?.cd2 != null && moveBtn('special2')}</div>
        ${beaten.length > 0 && myTurn && html`<div class="bb-adv"><b>+20%</b> ${selCard.cls} beats ${beaten.join(' and ')}</div>`}
        ${powers.length > 0 && html`<p class="tiny muted bb-pwnote">Power cards: one per round, played as one card's move.</p>`}
      </aside>
    </div>
    ${v.confirm && html`<${Modal} label=${leaveQuestion} onClose=${() => { v.confirm = false; bump(); }}>
      <div class="col" style="gap: 14px; text-align: center;">
        <p class="head" style="font-size: 18px; margin: 0;">${leaveQuestion}</p>
        <button class="btn gold wide" style="background: linear-gradient(180deg, #FF7884, #E0334A); color: #fff;" onClick=${() => { v.confirm = false; bump(); onLeave(); }}>${leaveLabel}</button>
        <button class="btn out wide" onClick=${() => { v.confirm = false; bump(); }}>Keep playing</button>
      </div></${Modal}>`}
  </div>`;
}

// GETs that answer `null` when there's nothing open (campaign/current, matches/current); store.api calls null an error.
// shortcut: matches the store's error text; drop once api() lets a null reply through.
export const apiOrNull = path => api(path).catch(e => { if (e.message === 'Unexpected reply from the server.') return null; throw e; });

// The Victory / Defeated card over the board (campaign, friend battles).
export function ResultCard({ won, children }) {
  useEffect(() => { Sound.play(won ? 'victory' : 'defeat'); }, []);
  return html`<div class="bb-result" role="dialog" aria-modal="true" aria-label=${won ? 'Victory' : 'Defeated'}>
    <div class="box"><h2 class=${won ? 'win' : 'lose'}>${won ? 'Victory' : 'Defeated'}</h2>${children}</div></div>`;
}
