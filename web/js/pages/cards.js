// The Cards tab (CollectionTab + FuseSheet + PowerCardView in the app). Wide: the collection with filters on the left,
// your team, power slots and the picked card's details pinned on the right. Phone: the app's layout, team on top.
// Team changes: drag a card onto a slot, or press "+ Team" then the slot. Every change saves straight away.
import { html, useState, useEffect } from '../vendor/preact-htm.js';
import { CARDS, card as cardOf, art, sortCards, SORTS, fusionOf, holoOf, holoCount, battleUsesHolo, battleFusion, fusionTotal,
  POWERS, power as powerOf, passiveOf, maxHP, dmg, rarityColor, classColor, CLASS_COLOR, POWER_VIOLET } from '../cards.js';
import { useStore, api, set, setTeam, setPowerTeam, seenCard, openScreen, local } from '../store.js';
import { Icon, Card, CardBack, Coin, Screen, Modal, fmt } from '../ui.js';
import { Sound } from '../sound.js';

const wide = () => matchMedia('(min-width: 1280px)').matches;   // detail sits in the side column instead of its own screen

// A full screen takes the keyboard focus when it opens (everything behind it is inert).
export function useFocusTop(dep) {
  useEffect(() => requestAnimationFrame(() => {
    const top = [...document.querySelectorAll('.screen')].pop();
    if (top && !top.contains(document.activeElement)) top.querySelector('button, input, [href], [tabindex]')?.focus();
  }), [dep]);
}

export function CollectionTab() {
  const s = useStore(), p = s.profile;
  const [sort, setSort] = useState(local.get('collectionSort', 0));
  const [powers, setPowers] = useState(false);
  const [pending, setPending] = useState(null);         // "+ Team" pressed: waiting for a slot
  const [pendingPower, setPendingPower] = useState(null);
  const [cls, setCls] = useState('All');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(null);                 // { id, holo } shown in the side column
  if (!p) return null;
  const owned = p.collection, team = p.team, teamSize = Math.min(3, Object.keys(owned).length);
  const pTeam = p.powerTeam || [], pOwned = p.powers || {};

  // Puts `id` in slot `i`: a card already on the team swaps places, a new one replaces whoever is there.
  const put = (id, i) => {
    setPending(null);
    if (i >= teamSize || !owned[id]) return;
    const next = team.slice(), from = next.indexOf(id);
    if (from >= 0) { if (i >= next.length || from === i) return; [next[from], next[i]] = [next[i], next[from]]; }
    else if (i < next.length) next[i] = id; else next.push(id);
    setTeam(next);
  };
  // Power slot `i`; with only one copy, moving it between slots swaps them.
  const putPower = (id, i) => {
    setPendingPower(null);
    if (!(pOwned[id] > 0)) return;
    const next = pTeam.slice(), from = next.indexOf(id);
    if (from >= 0 && ((pOwned[id] || 0) < 2 || from === i)) { if (i >= next.length || from === i) return; [next[from], next[i]] = [next[i], next[from]]; }
    else if (i < next.length) next[i] = id; else next.push(id);
    setPowerTeam(next);
  };
  const cycleSort = () => { const n = (sort + 1) % SORTS.length; setSort(n); local.set('collectionSort', n); };
  const open = (id, holo) => {
    if (pending) { setPending(null); return; }
    seenCard(id);
    if (wide()) setSel({ id, holo }); else openScreen(FuseScreen, { id, holo, start: 'detail' });
  };

  // One cell per card you own (holo copies get their own next to the normal one), then locked cards.
  const hc = id => holoCount(p, id);
  const mine = sortCards(CARDS.filter(c => owned[c.id]), sort, owned, new Set(Object.keys(owned).filter(id => hc(id) > 0)));
  const holoFirst = SORTS[sort % SORTS.length] === 'Holo';
  let entries = [];
  for (const c of mine) {
    const normal = owned[c.id] > hc(c.id), holo = hc(c.id) > 0;
    if (holo && holoFirst) entries.push({ c, holo: true });
    if (normal) entries.push({ c, holo: false });
    if (holo && !holoFirst) entries.push({ c, holo: true });
  }
  entries = entries.concat(CARDS.filter(c => !owned[c.id]).map(c => ({ c, holo: false })));
  const needle = q.trim().toLowerCase();
  const shown = entries.filter(e => (cls === 'All' || e.c.cls === cls) && (!needle || (owned[e.c.id] && e.c.name.toLowerCase().includes(needle)) || String(e.c.num) === needle));
  const selected = sel && owned[sel.id] ? sel : null;
  const powerCount = Object.values(pOwned).reduce((a, b) => a + b, 0);

  const teamPanel = html`<section class="panel pad col cp-team" aria-label="Your team">
    <div class="cp-hd"><span class="label">Your team</span>
      <span class="tiny muted">${pending ? `Choose who ${cardOf(pending)?.name} replaces` : 'Drag a card here, or press + Team'}</span></div>
    <div class="cp-slots">${[0, 1, 2].map(i => html`<${TeamSlot} i=${i} id=${team[i]} size=${teamSize} picking=${pending && i < teamSize} p=${p}
      onPick=${() => pending && put(pending, i)} onDrop=${id => put(id, i)} />`)}</div>
    <div class="cp-hd"><span class="label" style="font-size: 11px; color: ${POWER_VIOLET};">Power cards</span>
      <span class="tiny muted">${pendingPower ? `Choose where ${powerOf(pendingPower)?.name} goes` : '2 per battle · used up when played'}</span></div>
    <div class="cp-pslots">${[0, 1].map(i => html`<${PowerSlot} id=${pTeam[i]} picking=${!!pendingPower}
      onPick=${() => pendingPower && putPower(pendingPower, i)} onDrop=${id => putPower(id, i)} />`)}</div>
    ${s.error && html`<p class="err" role="alert" style="margin: 0;">${s.error}</p>`}
  </section>`;

  return html`<div class="page cp">
    <div class="cp-main">
      <div class="cp-toolbar">
        <h1 class="h1">Cards</h1>
        <div class="seg" role="tablist" aria-label="Card type">
          <button role="tab" aria-selected=${!powers} class=${!powers ? 'on' : ''} onClick=${() => setPowers(false)}>Characters</button>
          <button role="tab" aria-selected=${powers} class="${powers ? 'on' : ''} violet" onClick=${() => setPowers(true)}>Power · ${powerCount}</button>
        </div>
        ${!powers && html`<label class="cp-search"><${Icon} name="search" size="16" style="color: var(--brass);" />
          <input type="search" placeholder="Search cards" aria-label="Search cards" value=${q} onInput=${e => setQ(e.target.value)} /></label>
          <button class="btn out sm cp-sort" onClick=${cycleSort} aria-label="Sort by ${SORTS[sort % SORTS.length]}, press to change">Sort: ${SORTS[sort % SORTS.length]}</button>`}
      </div>
      <div class="cp-teamtop">${teamPanel}</div>
      ${powers ? html`
        <div class="cp-grid">${POWERS.filter(pw => pOwned[pw.id] > 0).map(pw => html`<${PowerCell} pw=${pw} count=${pOwned[pw.id]}
          pending=${pendingPower === pw.id} onTag=${() => setPendingPower(pendingPower === pw.id ? null : pw.id)}
          onOpen=${() => pendingPower ? setPendingPower(null) : openScreen(PowerZoom, { id: pw.id })} />`)}</div>
        ${!powerCount && html`<p class="muted" style="text-align: center; padding-top: 20px;">No power cards yet. They come in Power Packs in the Shop, and now and then in any pack.</p>`}`
      : html`
        <div class="cp-filters">
          ${['All', ...Object.keys(CLASS_COLOR)].map(k => html`<button class="fchip ${cls === k ? 'on' : ''}" aria-pressed=${cls === k} onClick=${() => setCls(k)}>
            ${k !== 'All' && html`<i style="background: ${CLASS_COLOR[k]};"></i>`}${k}</button>`)}
          <span class="small muted cp-count"><b style="color: var(--fg);">${Object.keys(owned).length}</b> of ${CARDS.length} collected</span>
        </div>
        <div class="cp-grid">${shown.map(e => html`<${Cell} key=${e.c.id + (e.holo ? '#h' : '')} e=${e} p=${p} isNew=${s.newCards.has(e.c.id)}
          pending=${pending} selected=${selected && selected.id === e.c.id && selected.holo === e.holo}
          onTag=${() => setPending(pending === e.c.id ? null : e.c.id)} onOpen=${() => open(e.c.id, e.holo)} />`)}</div>
        ${!shown.length && html`<p class="muted" style="text-align: center; padding-top: 20px;">No cards match.</p>`}`}
    </div>
    <aside class="cp-side">
      ${teamPanel}
      ${!powers && (selected ? html`<${Detail} id=${selected.id} holo=${selected.holo} p=${p} onTeam=${() => setPending(selected.id)} />`
        : html`<section class="panel pad muted small">Pick a card to see it here and fuse it.</section>`)}
    </aside>
  </div>`;
}

function TeamSlot({ i, id, size, picking, p, onPick, onDrop }) {
  const [over, setOver] = useState(false);
  const c = cardOf(id);
  const drag = { onDragOver: e => { e.preventDefault(); setOver(true); }, onDragLeave: () => setOver(false),
    onDrop: e => { e.preventDefault(); setOver(false); const d = e.dataTransfer.getData('text/plain'); if (d && !d.startsWith('pw:')) onDrop(d); } };
  return html`<button class="cp-slot ${picking || over ? 'picking' : ''}" ...${drag} onClick=${onPick} draggable=${!!c}
      onDragStart=${e => c && e.dataTransfer.setData('text/plain', id)} aria-label=${c ? `Slot ${i + 1}: ${c.name}` : `Slot ${i + 1}: ${i < size ? 'empty' : 'locked'}`}>
    <span class="n">${i + 1}</span>
    ${c ? html`<img src=${art(id)} alt="" style="border-color: ${fusionTotal(battleFusion(p, id)) > 0 ? 'var(--gold-text)' : rarityColor(c.rarity)};" draggable="false" />
        <span class="head ellipsis" style="font-size: 13px;">${c.name}</span>`
      : html`<span class="ph"><${Icon} name=${i < size ? 'plus' : 'lock'} size="18" /></span><span class="tiny muted">${i < size ? 'Empty' : `Level ${i === 1 ? 3 : 6}`}</span>`}
  </button>`;
}

function PowerSlot({ id, picking, onPick, onDrop }) {
  const [over, setOver] = useState(false);
  const pw = powerOf(id);
  return html`<button class="cp-pslot ${picking || over ? 'picking' : ''} ${pw ? '' : 'empty'}" onClick=${onPick} draggable=${!!pw}
      style=${pw ? `border-color: ${rarityColor(pw.rarity)};` : ''}
      onDragStart=${e => pw && e.dataTransfer.setData('text/plain', 'pw:' + pw.id)}
      onDragOver=${e => { e.preventDefault(); setOver(true); }} onDragLeave=${() => setOver(false)}
      onDrop=${e => { e.preventDefault(); setOver(false); const d = e.dataTransfer.getData('text/plain'); if (d.startsWith('pw:')) onDrop(d.slice(3)); }}>
    ${pw ? html`<${Icon} name=${pw.icon} size="20" style="color: var(--cyan); filter: drop-shadow(0 0 3px var(--cyan));" />
        <span class="col" style="gap: 1px; min-width: 0; text-align: left;"><span class="head ellipsis" style="font-size: 13px;">${pw.name}</span><span class="tiny" style="color: ${rarityColor(pw.rarity)};">${pw.rarity}</span></span>`
      : html`<span class="small muted">+ Power card</span>`}
  </button>`;
}

function Cell({ e, p, isNew, pending, selected, onTag, onOpen }) {
  const c = e.c, owned = p.collection[c.id] || 0;
  if (!owned) return html`<div class="cp-cell locked" aria-label="Card ${c.num}, not collected"><${CardBack} /><span class="num head">#${c.num}</span></div>`;
  const holo = holoCount(p, c.id), count = e.holo ? holo : owned - holo;
  const onTeam = p.team.includes(c.id) && e.holo === battleUsesHolo(p, c.id);
  return html`<div class="cp-cell" draggable="true" onDragStart=${ev => ev.dataTransfer.setData('text/plain', c.id)}>
    <${Card} id=${c.id} fusion=${e.holo ? holoOf(p, c.id) : fusionOf(p, c.id)} count=${count} isNew=${isNew}
      selected=${selected || pending === c.id} onClick=${onOpen} label="${c.name}${e.holo ? ' (holo)' : ''}, open" />
    ${onTeam ? html`<span class="cp-tag on">On team</span>`
      : html`<button class="cp-tag ${pending === c.id ? 'lit' : ''}" onClick=${onTag} aria-label="Add ${c.name} to your team">+ Team</button>`}
  </div>`;
}

// ---- power cards ----
export function PowerCard({ pw, style = '' }) {
  const tint = rarityColor(pw.rarity);
  const [noArt, setNoArt] = useState(false);   // the symbol stands in until the art loads (or if it's missing)
  return html`<div class="card pcard" style=${style}><div class="face" style="--edge: ${tint}; --face: linear-gradient(135deg, #241240, #0B0918);">
    <div class="top" style="font-size: 4.5cqw;"><span style="font: 600 4.5cqw var(--head); letter-spacing: 1cqw; text-transform: uppercase; color: ${POWER_VIOLET};">Power</span>
      <span style="margin-left: auto; color: ${tint}; font-weight: 400;">${pw.rarity}</span></div>
    ${noArt ? html`<div class="art center" style="background: radial-gradient(circle, ${tint}59, #120A24 70%);"><${Icon} name=${pw.icon} style="color: var(--cyan); filter: drop-shadow(0 0 4cqw var(--cyan)); width: 30cqw; height: 30cqw;" /></div>`
      : html`<img class="art" src=${art('power_' + pw.id)} alt="" loading="lazy" draggable="false" onError=${() => setNoArt(true)} />`}
    <div style="font-size: 6cqw; font-weight: 700;" class="ellipsis">${pw.name}</div>
    <div style="font-size: 4.6cqw; color: var(--muted); line-height: 1.25;">${pw.effect}</div>
    <div class="quip" style="color: rgba(235,233,247,.5);">Used up when played</div>
  </div></div>`;
}
function PowerCell({ pw, count, pending, onTag, onOpen }) {
  return html`<div class="cp-cell" draggable="true" onDragStart=${ev => ev.dataTransfer.setData('text/plain', 'pw:' + pw.id)}>
    <button class="cardbtn ${pending ? 'card sel' : ''}" onClick=${onOpen} aria-label="${pw.name}, open"><${PowerCard} pw=${pw} /></button>
    ${count > 1 && html`<span class="cp-pcount">×${count}</span>`}
    <button class="cp-tag violet low ${pending ? 'lit' : ''}" onClick=${onTag} aria-label="Take ${pw.name} into battle">+ Power</button>
  </div>`;
}
function PowerZoom({ close, id }) {
  useFocusTop();
  return html`<${Screen} close=${close} title=${powerOf(id).name}><div class="narrow" style="padding: 20px 40px; max-width: 380px;"><${PowerCard} pw=${powerOf(id)} /></div><//>`;
}

// ---- fusion ----
const FUSE_COPIES = [1, 3, 5], FUSE_GOLD = [1000, 2500, 5000], MAX = 3, SECOND_COPIES = 10, SECOND_GOLD = 10000, PASSIVE_GOLD = 2500;
const Pips = ({ level, size = 8 }) => html`<span class="pips" aria-label="${level} of 3">${[0, 1, 2].map(i => html`<i class=${i < level ? 'on' : ''} style="width: ${size}px; height: ${size}px;"></i>`)}</span>`;
function fuseInfo(p, id, holo) {
  const fusion = holo ? holoOf(p, id) : fusionOf(p, id);
  const copies = p.collection[id] || 0, fusedCount = (p.fused || []).filter(f => f.card === id).length;
  return { fusion, copies, holoCopies: holoCount(p, id), spare: Math.max(0, copies - fusedCount - (fusion ? 0 : 1)) };
}

// The picked card on wide screens: big face, copies and fusion pips, Fuse and + Team.
function Detail({ id, holo, p, onTeam }) {
  const c = cardOf(id), { fusion, copies, holoCopies } = fuseInfo(p, id, holo);
  const pas = passiveOf(c), inTeam = p.team.includes(id);
  return html`<section class="panel pad col cp-detail" style="border-color: rgba(232,184,90,.4);">
    <div class="row" style="align-items: flex-start; gap: 16px;">
      <${Card} id=${id} fusion=${fusion} style="width: 132px; flex: none;" />
      <div class="col grow" style="gap: 6px;">
        <span class="label" style="font-size: 11px; color: ${rarityColor(c.rarity)};">${c.rarity} · ${c.cls}${holo ? ' · Holo' : ''}</span>
        <span class="head" style="font-size: 22px;">${c.name}</span>
        <span class="small muted">HP <b style="color: var(--fg);">${maxHP(c, fusion)}</b> · Basic <b style="color: var(--fg);">${dmg(c, 'basic', fusion)}</b> · Special <b style="color: var(--fg);">${dmg(c, 'special', fusion)}</b> (⟳ ${c.special.cd})</span>
        <span class="small muted">×${holo ? holoCopies : copies - holoCopies} ${holo ? 'holo' : 'copies'}</span>
        <div class="tiny muted row" style="gap: 10px; flex-wrap: wrap;">HP <${Pips} level=${fusion?.h || 0} size="6" /> Basic <${Pips} level=${fusion?.b || 0} size="6" /> Special <${Pips} level=${fusion?.s || 0} size="6" /></div>
      </div>
    </div>
    ${pas && html`<div class="cp-pas"><b>◆ ${pas.name}</b> · ${pas.text}${fusion?.p ? '' : ' (fuse to unlock)'}</div>`}
    <div class="row" style="gap: 10px;">
      <button class="btn gold" style="flex: 1;" onClick=${() => openScreen(FuseScreen, { id, holo, start: 'fuse' })}><${Icon} name="sparkle" size="16" />Fuse</button>
      <button class="btn out" style="flex: 1; height: 48px;" disabled=${inTeam} onClick=${onTeam}>${inTeam ? 'On team' : '+ Team'}</button>
    </div>
    <span class="tiny muted" style="text-align: center;">Fusing uses spare copies and some gold</span>
  </section>`;
}

// FuseSheet: the card big (detail), the fuse options (fuse), or the result.
function FuseScreen({ close, id, holo, start }) {
  const s = useStore(), p = s.profile;
  const [view, setView] = useState(start);
  const [busy, setBusy] = useState(false), [err, setErr] = useState(null), [result, setResult] = useState(null);
  useEffect(() => { if (result) Sound.play('legendary'); }, [result]);
  useFocusTop(result ? 'r' : view);
  if (!p) return null;
  const c = cardOf(id), { fusion, copies, holoCopies, spare } = fuseInfo(p, id, holo), gold = p.gold;
  const bumped = st => { const f = { h: 0, b: 0, s: 0, ...(fusion || {}) }; if (st === 'p') f.p = true; else if (st === 'x') f.x = true; else f[st] = Math.min(MAX, f[st] + 1); return f; };
  const fuse = async (stat, line, before, after) => {
    setBusy(true); setErr(null);
    try { set({ profile: await api('fuse', { card: id, stat, holo: !!holo }) }); setResult({ line, before, after, stat }); }
    catch (e) { setErr(e.message); }
    setBusy(false);
  };
  if (result) {
    const r = result;
    return html`<${Screen} close=${close}><div class="col narrow" style="align-items: center; text-align: center; gap: 18px; padding: 24px;">
      <h2 class="h1 gold-glow" style="text-transform: uppercase; font-size: 34px;">${r.stat === 'x' || r.stat === 'p' ? 'Unlocked!' : 'Fused!'}</h2>
      <${Card} id=${id} fusion=${fusion} style="width: 210px; filter: drop-shadow(0 0 22px rgba(255,215,122,.6));" />
      <p class="row muted" style="gap: 8px; font-size: 16px; margin: 0;"><span style="color: var(--gold-text);">↑</span>${r.line}
        ${r.stat === 'p' ? html`<span style="color: var(--cyan);">passive is on</span>`
          : html`${r.stat !== 'x' && html`<span class="mono">${r.before}</span> →`}<b class="mono" style="color: var(--gold-text);">${r.after}</b>`}</p>
      <button class="btn gold big" style="width: 240px;" onClick=${() => setResult(null)}>Nice</button>
    </div><//>`;
  }
  if (view === 'detail') {
    return html`<${Screen} close=${close}><div class="col narrow" style="align-items: center; gap: 16px; padding: 8px 24px 24px;">
      <${Card} id=${id} fusion=${fusion} style="width: min(300px, 78vw);" />
      <div class="row muted" style="gap: 14px; flex-wrap: wrap; justify-content: center; font-size: 14px;">
        <span><b class="head" style="color: var(--fg);">×${holo ? holoCopies : copies - holoCopies}</b> ${holo ? 'holo' : 'copies'}</span>
        <span>HP <${Pips} level=${fusion?.h || 0} size="7" /></span><span>Basic <${Pips} level=${fusion?.b || 0} size="7" /></span><span>Special <${Pips} level=${fusion?.s || 0} size="7" /></span></div>
      <button class="btn gold big wide" onClick=${() => setView('fuse')}><${Icon} name="sparkle" size="18" />Fuse</button>
      <span class="small muted">Fusing uses spare copies and some gold</span>
    </div><//>`;
  }
  const statRow = (title, sub, stat, now, next) => {
    const level = fusion?.[stat] || 0, maxed = level >= MAX, price = maxed ? 0 : FUSE_GOLD[level], need = maxed ? 0 : FUSE_COPIES[level];
    return html`<div class="cp-stat">
      <div class="col grow" style="gap: 5px;">
        <div class="row" style="gap: 8px;"><span class="head" style="font-size: 16px;">${title}</span><${Pips} level=${level} /></div>
        <div class="row small muted" style="gap: 6px;"><span class="ellipsis">${sub}</span><span class="mono">${now}</span>${!maxed && html`→<b class="mono" style="color: var(--gold-text);">${next}</b>`}</div>
        ${!maxed && html`<span class="tiny" style="color: ${gold < price ? '#FF7884' : 'var(--muted)'};">${need} ${need === 1 ? 'copy' : 'copies'} + ${fmt(price)} gold</span>`}
      </div>
      ${maxed ? html`<span class="cp-max">Max</span>`
        : html`<button class="btn gold" style="width: 90px; height: 40px;" disabled=${busy || spare < need || gold < price} onClick=${() => fuse(stat, sub, now, next)}>Fuse</button>`}
    </div>`;
  };
  const pas = passiveOf(c), s2 = c.special2;
  const short2 = spare < SECOND_COPIES ? `Need ${SECOND_COPIES - spare} more copies` : gold < SECOND_GOLD ? `Need ${fmt(SECOND_GOLD - gold)} more gold` : null;
  return html`<${Screen} close=${start === 'fuse' ? close : () => setView('detail')} title="Fuse ${c.name}${holo ? ' (Holo)' : ''}">
    <div class="col cp-fuse">
      <div class="row" style="gap: 14px; align-items: center;">
        <${Card} id=${id} fusion=${fusion} style="width: 120px; flex: none;" />
        <div class="col" style="gap: 6px;"><span class="label">Copies + gold per fusion</span>
          <span class="muted">You have <b class="head" style="color: var(--fg);">${spare} spare</b> copies.</span>
          <span class="small muted">Each stat can be fused ${MAX} times.</span>
          <span class="row small muted" style="gap: 5px;"><${Coin} size="14" />${fmt(gold)} gold</span></div>
      </div>
      ${pas && html`<div class="cp-passive">
        <div class="col grow" style="gap: 3px;">
          <div class="row" style="gap: 6px;"><span style="color: var(--cyan); font-size: 10px;">◆</span><span class="head" style="font-size: 15px; color: var(--cyan);">${pas.name}</span><span class="label" style="font-size: 10px; color: var(--muted);">Passive</span></div>
          <span class="tiny muted">${pas.text}</span>
          ${!fusion?.p && html`<span class="tiny muted"><b style="color: var(--fg);">1 copy</b> + <b style="color: ${gold < PASSIVE_GOLD ? '#FF7884' : 'var(--fg)'};">${fmt(PASSIVE_GOLD)} gold</b></span>`}
        </div>
        ${fusion?.p ? html`<span class="row small" style="gap: 4px; color: var(--online); font-weight: 600;"><${Icon} name="check" size="14" />On</span>`
          : html`<button class="btn gold" style="width: 90px; height: 36px;" disabled=${busy || spare < 1 || gold < PASSIVE_GOLD} onClick=${() => fuse('p', pas.name, 0, 0)}>Unlock</button>`}
      </div>`}
      <div class="panel" style="padding: 0 14px; border-color: rgba(232,184,90,.2);">
        ${statRow('HP +10%', 'HP', 'h', maxHP(c, fusion), maxHP(c, bumped('h')))}
        ${statRow('Basic +20%', c.basic.name, 'b', dmg(c, 'basic', fusion), dmg(c, 'basic', bumped('b')))}
        ${statRow('Special +10%', c.special.name, 's', dmg(c, 'special', fusion), dmg(c, 'special', bumped('s')))}
      </div>
      ${s2 && html`<div class="cp-second">
        <div class="row" style="justify-content: space-between;"><span class="label" style="color: var(--gold-text);">Second special</span>
          <span class="tiny" style="color: ${fusion?.x ? 'var(--online)' : 'var(--muted)'};">${fusion?.x ? 'Unlocked' : 'Epic & Legendary only'}</span></div>
        <div class="col" style="gap: 3px;"><span class="head" style="font-size: 18px;">${s2.name}</span>
          <span class="small muted"><span class="mono" style="color: var(--fg);">${dmg(c, 'special2', fusion)}</span> damage · cooldown ${s2.cd} · gets the Special bonus too</span></div>
        ${!fusion?.x && html`<div class="row" style="gap: 10px;"><span class="small muted grow">Costs <b style="color: var(--fg);">${SECOND_COPIES} copies</b> + <b style="color: var(--fg);">${fmt(SECOND_GOLD)} gold</b></span>
          <button class="btn gold" style="width: 100px; height: 40px;" disabled=${busy || !!short2} onClick=${() => fuse('x', s2.name, 0, dmg(c, 'special2', bumped('x')))}>Unlock</button></div>
          ${short2 && html`<span class="tiny" style="color: #FF7884;">${short2}</span>`}`}
      </div>`}
      ${err && html`<p class="err" role="alert" style="margin: 0;">${err}</p>`}
    </div>
  <//>`;
}
