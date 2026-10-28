// The Social tab (SocialTab + TradeView in the app). Wide: friends and requests on the left, the inbox (challenges, trades)
// with the open trade under it in the middle, the picked friend's profile on the right. Phone: the app's single column.
import { html, useState, useEffect } from '../vendor/preact-htm.js';
import { CARDS, sortCards, SORTS, fusionTotal, tradeCard, tradeFusedId, tradeToken } from '../cards.js';
import { useStore, api, set, socialAction, loadSocial, openScreen, replaceScreen, local } from '../store.js';
import { useFocusTop } from './cards.js';
import { Icon, Card, Tile, Avatar, Coin, Screen, Modal, fmt } from '../ui.js';
import { Sound } from '../sound.js';
import { FriendBattle } from '../screens/friend.js';

const wide = () => matchMedia('(min-width: 1280px)').matches;
function seen(p) {
  if (p.online) return html`<span style="color: var(--online);">Online</span>`;
  if (!p.seen) return 'Offline';
  const m = Math.floor((Date.now() - p.seen) / 60000);
  return m < 60 ? `${Math.max(m, 1)}m ago` : m < 1440 ? `${Math.floor(m / 60)}h ago` : m < 2880 ? 'Yesterday' : `${Math.floor(m / 1440)}d ago`;
}
const Av = ({ id, size = 40, online }) => html`<span class="so-av"><${Avatar} id=${id} size=${size} />${online != null && html`<span class="st ${online ? 'on' : ''}" aria-label=${online ? 'Online' : null}></span>`}</span>`;
const fusedCopy = c => ({ h: c.h, b: c.b, s: c.s, x: c.x, o: c.o, p: c.p });

export function SocialTab() {
  const s = useStore(), p = s.profile, soc = s.social;
  const [name, setName] = useState('');
  const [note, setNote] = useState(null);       // { text, err }
  const [busy, setBusy] = useState(false);
  const [selFriend, setSelFriend] = useState(null);
  const [selTrade, setSelTrade] = useState(null);
  useEffect(() => { loadSocial(); }, []);
  if (!p) return null;
  const run = async work => {
    setBusy(true);
    try { await work(); } catch (e) { setNote({ text: e.message, err: true }); await loadSocial(); }
    setBusy(false);
  };
  const act = (path, body, done) => run(async () => { const msg = await socialAction(path, body); setNote(msg ? { text: msg } : null); done?.(); });
  const add = e => { e.preventDefault(); const n = name.trim(); if (n) act('friends', { name: n }, () => setName('')); };
  const tradesLocked = p.locked?.trades;
  const trades = soc?.trades || [];
  const friends = soc?.friends || [], requests = soc?.requests || [], challenges = soc?.challenges || [];
  const openTrade = trades.find(t => t.id === selTrade) || trades.find(t => !t.mine || t.status === 'accepted') || trades[0];
  const friend = friends.find(f => f.name === selFriend) || friends[0];
  const viewPerson = (person, request) => wide() ? setSelFriend(person.name)
    : openScreen(PlayerScreen, { name: person.name, request, onAnswer: ok => act(ok ? 'friends' : 'friends/remove', { name: person.name }) });
  const pickTrade = t => wide() ? setSelTrade(t.id) : openScreen(TradeScreen, { id: t.id });
  const battle = f => openScreen(FriendBattle, { friend: f.name });
  const newTrade = f => openScreen(TradeBuilder, { friend: f.name, avatar: f.avatar });
  const isRequest = selFriend && requests.some(r => r.name === selFriend) && !friends.some(f => f.name === selFriend);

  return html`<div class="page so" aria-busy=${busy}>
    <div class="so-left">
      <h1 class="h1">Social</h1>
      <form class="so-add" onSubmit=${add}><input aria-label="Add a friend by username" placeholder="Add a friend by username" autocapitalize="off" spellcheck="false"
        value=${name} onInput=${e => setName(e.target.value)} /><button class="btn gold" style="height: 44px; padding: 0 16px;" disabled=${busy || !name.trim()}>Add</button></form>
      <span class="small muted" style="margin-top: -6px;">Your username is <b style="color: var(--brass);">${p.username}</b></span>
      ${note && html`<p class=${note.err ? 'err' : ''} role=${note.err ? 'alert' : 'status'} style="margin: 0; ${note.err ? '' : 'color: var(--brass); font-weight: 600;'}">${note.text}</p>`}
      ${!soc ? html`<div class="center" style="padding: 30px;"><div class="spinner"></div></div>` : html`
        <div class="row so-o3" style="justify-content: space-between;"><span class="label">Friends</span><span class="tiny muted">${friends.length}</span></div>
        ${friends.length ? html`<ul class="so-list so-o3" style="margin-top: -6px;">${friends.map(f => html`<li class="so-friend ${wide() && friend?.name === f.name && !isRequest ? 'on' : ''}">
            <button class="who" onClick=${() => viewPerson(f, false)} aria-label="${f.name}, level ${f.level}"><${Av} id=${f.avatar} online=${f.online} />
              <span class="col" style="gap: 1px; min-width: 0;"><span class="head ellipsis" style="font-size: 15px;">${f.name}</span><span class="tiny muted">Level ${f.level} · ${seen(f)}</span></span></button>
            <span class="row so-only-narrow" style="gap: 8px;">
              ${!tradesLocked && f.trade !== false && html`<button class="so-sq" onClick=${() => newTrade(f)} aria-label="Trade with ${f.name}"><${Icon} name="swap" size="16" /></button>`}
              ${!p.locked?.friends && f.battle !== false && html`<button class="so-sq" onClick=${() => battle(f)} aria-label="Battle ${f.name}"><${Icon} name="swords" size="20" /></button>`}</span>
          </li>`)}</ul>`
        : html`<div class="so-empty so-o3"><div class="row" style="gap: 0;">${['volt', 'fang', 'goliath'].map((id, i) => html`<span style="margin-left: ${i ? -14 : 0}px;"><${Avatar} id=${id} size="56" /></span>`)}</div>
            <span class="head" style="font-size: 20px;">No friends yet</span><span class="small muted" style="max-width: 260px;">Add someone by their username, then challenge them straight from here.</span></div>`}
        ${requests.length > 0 && html`<span class="label so-o2" style="margin-top: 6px;">Friend requests</span>
          ${requests.map(r => html`<div class="panel so-o2" style="padding: 14px; display: flex; flex-direction: column; gap: 12px;">
            <button class="row" style="gap: 10px; background: none; border: 0; padding: 0; color: var(--fg); cursor: pointer; text-align: left;" onClick=${() => viewPerson(r, true)}>
              <${Avatar} id=${r.avatar} size="36" /><span style="font-size: 14px;"><b class="head">${r.name}</b> wants to be friends</span></button>
            <div class="row" style="justify-content: flex-end; gap: 8px;">
              <button class="btn out sm" disabled=${busy} onClick=${() => act('friends/remove', { name: r.name })}>Ignore</button>
              <button class="btn gold sm" disabled=${busy} onClick=${() => act('friends', { name: r.name })}>Accept</button></div>
          </div>`)}`}`}
    </div>
    <section class="so-mid" aria-label="Inbox">
      <span class="label so-only-wide" style="margin-top: 10px;">Inbox</span>
      ${soc && html`<ul class="so-inbox">
        ${challenges.map(c => html`<li class="so-item">
          <span class="k" style="color: #FF7884;">Challenge</span>
          <span class="txt" style="cursor: default;"><b>${c.name}</b> challenged you to a Friendly Battle</span>
          <button class="btn out sm" disabled=${busy} onClick=${() => act('challenges/decline', { id: c.id })}>Decline</button>
          <button class="btn gold sm" disabled=${busy} onClick=${() => openScreen(FriendBattle, { join: c })}>Battle</button></li>`)}
        ${!tradesLocked && trades.map(t => html`<li class="so-item ${wide() && openTrade?.id === t.id ? 'on' : ''}">
          <span class="k" style="color: ${t.mine && t.status !== 'accepted' ? 'var(--muted)' : 'var(--cyan)'};">Trade</span>
          <button class="txt" onClick=${() => pickTrade(t)}>${t.mine && t.status === 'accepted' ? html`<b>${t.name}</b> accepted your trade`
            : t.mine ? html`Waiting for <b>${t.name}</b> to answer your offer` : html`<b>${t.name}</b> sent you a trade offer`}</button>
          <span class="tiny so-only-wide" style="color: var(--brass);">${wide() && openTrade?.id === t.id ? 'Open below ↓' : ''}</span>
          <span class="so-only-narrow" style="color: var(--brass);"><${Icon} name="right" size="14" /></span></li>`)}
      </ul>
      ${tradesLocked ? html`<div class="panel row" style="padding: 14px; border-color: rgba(232,184,90,.2);">
          <span class="so-sq" style="color: var(--muted); border-color: transparent;"><${Icon} name="lock" size="18" /></span>
          <div class="col" style="gap: 3px;"><span class="label">Trades</span><span class="small muted">${tradesLocked.replace('Reach player', 'Unlocks at player')}</span></div></div>`
        : !challenges.length && !trades.length && html`<p class="small muted so-only-wide" style="margin: 0;">Nothing waiting. Challenges and trade offers show up here.</p>`}
      ${!tradesLocked && openTrade && html`<div class="so-only-wide" style="flex-direction: column;"><${TradeOffer} key=${openTrade.id} trade=${openTrade} inline=${true} /></div>`}`}
    </section>
    <aside class="so-right" aria-label="Profile">
      ${(isRequest ? selFriend : friend?.name) && html`<${PlayerPanel} key=${isRequest ? selFriend : friend.name} name=${isRequest ? selFriend : friend.name} request=${isRequest}
        friend=${isRequest ? null : friend} tradesLocked=${tradesLocked} battleLocked=${p.locked?.friends} busy=${busy}
        onAnswer=${ok => act(ok ? 'friends' : 'friends/remove', { name: selFriend })}
        onBattle=${() => battle(friend)} onTrade=${() => newTrade(friend)}
        onRemove=${() => act('friends/remove', { name: friend.name }, () => setSelFriend(null))} />`}
    </aside>
  </div>`;
}

// Someone's public card: picture, level, stats and team. A request gets Ignore / Accept; a friend gets Battle / New trade / Remove.
function PlayerPanel({ name, request, friend, tradesLocked, battleLocked, busy, onAnswer, onBattle, onTrade, onRemove }) {
  const [pl, setPl] = useState(null), [err, setErr] = useState(null), [confirm, setConfirm] = useState(false);
  useEffect(() => { api('players/' + encodeURIComponent(name)).then(setPl, e => setErr(e.message)); }, [name]);
  if (err) return html`<section class="panel pad err">${err}</section>`;
  if (!pl) return html`<section class="panel pad center"><div class="spinner"></div></section>`;
  const since = new Date(pl.since).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  return html`<section class="panel pad col" style="gap: 14px;">
    <div class="row" style="gap: 14px;"><${Av} id=${pl.avatar} size="64" online=${friend ? friend.online : null} />
      <div class="col" style="gap: 2px; min-width: 0;"><span class="head ellipsis" style="font-size: 22px;">${pl.name}</span>
        <span class="label" style="font-size: 12px; letter-spacing: 1.5px;">LV ${pl.level}${friend?.online ? html` · <span style="color: var(--online);">Online</span>` : ''}</span>
        <span class="tiny muted">${request ? 'Wants to be friends · ' : ''}Playing since ${since}</span></div></div>
    <div class="so-stats">${[[fmt(pl.wins), 'Wins'], [pl.campaign, 'Campaign'], [`${pl.cards}/${CARDS.length}`, 'Cards']].map(([v, k]) => html`<div><b>${v}</b><span class="tiny muted">${k}</span></div>`)}</div>
    <span class="label" style="font-size: 11px;">Their team</span>
    <div class="so-team">${pl.team.map(id => html`<${Tile} id=${id} />`)}</div>
    ${request ? html`<div class="row" style="gap: 10px;"><button class="btn quiet" style="flex: 1; height: 44px;" disabled=${busy} onClick=${() => onAnswer(false)}>Ignore</button>
        <button class="btn gold" style="flex: 1; height: 44px;" disabled=${busy} onClick=${() => onAnswer(true)}>Accept</button></div>`
      : friend && html`${friend.battle !== false && !battleLocked && html`<button class="btn gold" onClick=${onBattle}>Battle</button>`}
        ${!tradesLocked && friend.trade !== false && html`<button class="btn out" style="height: 46px;" onClick=${onTrade}>New trade</button>`}
        ${(friend.battle === false || friend.trade === false) && html`<span class="tiny muted" style="text-align: center;">${friend.battle === false && friend.trade === false ? "Hasn't unlocked Friendly Battles or trading yet" : friend.battle === false ? "Hasn't unlocked Friendly Battles yet" : "Hasn't unlocked trading yet"}</span>`}
        <button class="link" style="align-self: center; color: var(--muted); text-decoration: underline;" onClick=${() => setConfirm(true)}>Remove friend</button>`}
    ${confirm && html`<${Modal} label="Remove friend" onClose=${() => setConfirm(false)}><div class="col" style="text-align: center;">
      <span class="h2">Remove ${pl.name}?</span><span class="muted">You can add each other again any time.</span>
      <div class="row" style="gap: 10px;"><button class="btn out" style="flex: 1;" onClick=${() => setConfirm(false)}>Keep</button>
        <button class="btn gold" style="flex: 1;" onClick=${() => { setConfirm(false); onRemove(); }}>Remove</button></div></div><//>`}
  </section>`;
}

// Phone: a friend's or requester's profile on its own screen.
function PlayerScreen({ close, name, request, onAnswer }) {
  useFocusTop();
  const s = useStore(), friend = s.social?.friends.find(f => f.name === name);
  return html`<${Screen} close=${close} title=${name}><div class="so-wrap">
    <${PlayerPanel} name=${name} request=${request} friend=${friend} tradesLocked=${s.profile?.locked?.trades} battleLocked=${s.profile?.locked?.friends}
      onAnswer=${ok => { close(); onAnswer(ok); }} onBattle=${() => replaceScreen(FriendBattle, { friend: name })}
      onTrade=${() => replaceScreen(TradeBuilder, { friend: name, avatar: friend.avatar })}
      onRemove=${async () => { close(); try { await socialAction('friends/remove', { name }); } catch (e) { set({ error: e.message }); } }} />
  </div><//>`;
}

// ---- trades ----
const fusionIn = (tok, lists) => { const id = tradeFusedId(tok); const c = id && lists.flat().find(f => String(f.id) === id); return c ? fusedCopy(c) : null; };

// An open offer: answer it (theirs), cancel or claim it (mine). Inline on wide screens, its own screen on phones.
function TradeOffer({ trade, inline, onClose }) {
  const [busy, setBusy] = useState(false), [err, setErr] = useState(null);
  const fusions = Object.values(trade.fusions || {});
  const go = (view, props) => onClose ? replaceScreen(view, props) : openScreen(view, props);   // on its own screen: swap it, history stays in step
  const done = d => { set({ social: d.social, profile: d.profile }); go(TradeDone, { d }); };
  const answer = async action => {
    setBusy(true); setErr(null);
    try {
      if (action === 'accept') done(await api('trades/accept', { id: trade.id }));
      else if (action === 'claim') done(await api('trades/claim', { id: trade.id }));
      else { await socialAction('trades/' + action, { id: trade.id }); onClose?.(); }
    } catch (e) { setErr(e.message); await loadSocial(); }
    setBusy(false);
  };
  const counter = () => go(TradeBuilder, { friend: trade.name, avatar: trade.avatar, counter: trade });
  const side = (title, sub, ids, gold) => html`<div class="so-side">
    <div class="col grow" style="gap: 4px; min-width: 92px;"><span class="label">${title}</span><span class="tiny muted">${sub}</span>
      <span class="so-gold"><${Coin} size="18" />${fmt(gold)}</span><span class="tiny muted">gold</span></div>
    <div class="cards">${[0, 1, 2].map(i => ids[i] && tradeCard(ids[i]) ? html`<${Card} id=${tradeCard(ids[i]).id} fusion=${fusionIn(ids[i], [fusions])} />`
      : html`<div class="slot"></div>`)}${!ids.length && html`<span class="none">${gold > 0 ? 'Just gold' : 'Nothing'}</span>`}</div></div>`;
  const ready = trade.mine && trade.status === 'accepted';
  return html`<div class=${inline ? 'so-trade' : 'col'} style=${inline ? '' : 'gap: 14px;'}>
    ${inline && html`<div class="row" style="gap: 12px;"><${Avatar} id=${trade.avatar} size="44" />
      <div class="col" style="gap: 0;"><span class="label" style="font-size: 11px;">${trade.mine ? 'Your offer' : 'Trade offer'}</span>
        <span class="head" style="font-size: 22px;">${trade.mine ? `you → ${trade.name}` : `${trade.name} → you`}</span></div>
      <span class="small muted" style="margin-left: auto;">Up to 3 cards + gold each way</span></div>`}
    ${trade.mine && html`<span class="so-tag" style="color: ${ready ? 'var(--online)' : 'var(--muted)'}; border-color: ${ready ? 'var(--online)' : 'rgba(142,138,168,.6)'};">${ready ? 'Accepted' : `Pending · waiting for ${trade.name}`}</span>`}
    <div class="col" style="gap: 0;">
      ${side('You get', `From ${trade.name}`, trade.get, trade.getGold)}
      <div class="so-swap" aria-hidden="true"><${Icon} name="swap" size="18" /></div>
      ${side('You give', trade.mine ? 'Held while the offer is open' : 'Spare copies only', trade.give, trade.giveGold)}
    </div>
    ${err && html`<p class="err" role="alert" style="margin: 0;">${err}</p>`}
    <div class="row" style="gap: 12px; margin-top: auto; flex-wrap: wrap;">
      ${trade.mine ? (ready ? html`<button class="btn gold big" style="flex: 1;" disabled=${busy} onClick=${() => answer('claim')}>${busy ? 'Claiming…' : 'Claim'}</button>`
          : html`<button class="btn quiet big" style="flex: 1;" disabled=${busy} onClick=${() => answer('cancel')}>Cancel offer</button>`)
        : html`<button class="btn quiet" style="flex: 1; height: 50px;" disabled=${busy} onClick=${() => answer('decline')}>Decline</button>
          <button class="btn out" style="flex: 1; height: 50px;" disabled=${busy} onClick=${counter}>Counter</button>
          <button class="btn gold" style="flex: 1.4; height: 50px;" disabled=${busy} onClick=${() => answer('accept')}>${busy ? 'Trading…' : 'Accept trade'}</button>`}
    </div>
  </div>`;
}
function TradeScreen({ close, id }) {
  useFocusTop();
  const s = useStore(), t = (s.social?.trades || []).find(x => x.id === id);
  useEffect(() => { if (!t) close(); }, [t]);
  if (!t) return null;
  return html`<${Screen} close=${close} title=${t.mine ? `Your offer to ${t.name}` : `${t.name} wants to trade`}
    right=${html`<${Avatar} id=${t.avatar} size="40" />`}><div class="so-wrap"><${TradeOffer} trade=${t} onClose=${close} /></div><//>`;
}
function TradeDone({ close, d }) {
  useFocusTop();
  useEffect(() => { Sound.play('rare'); }, []);
  return html`<${Screen} close=${close}><div class="so-done">
    <h2 class="h1 gold-glow" style="text-transform: uppercase; font-size: 34px;">Trade complete!</h2>
    <div class="got">${d.received.map(id => html`<${Card} id=${id} style="width: 150px;" />`)}</div>
    <span class="muted">${d.gold > 0 ? `+ ${fmt(d.gold)} gold · from ${d.from}` : `from ${d.from}`}</span>
    <button class="btn gold big" style="width: 240px;" onClick=${close}>Nice</button>
  </div><//>`;
}

// Build an offer (or a counter): up to 3 cards and some gold each way.
function TradeBuilder({ close, friend, avatar, counter }) {
  const s = useStore();
  const [give, setGive] = useState(counter ? counter.give : []), [get, setGet] = useState(counter ? counter.get : []);
  const [giveGold, setGiveGold] = useState(counter ? counter.giveGold : 0), [getGold, setGetGold] = useState(counter ? counter.getGold : 0);
  const [cards, setCards] = useState(null), [picking, setPicking] = useState(null), [err, setErr] = useState(null), [sending, setSending] = useState(false);
  useEffect(() => { api('trades/cards/' + encodeURIComponent(friend)).then(setCards, e => setErr(e.message)); }, []);
  useFocusTop(picking);
  const lists = [cards?.mineFused || [], cards?.theirsFused || [], Object.values(counter?.fusions || {})];
  const send = async () => {
    setSending(true); setErr(null);
    try {
      const body = { to: friend, give, get, giveGold, getGold };
      if (counter) body.counter = counter.id;
      await socialAction('trades', body);
      close();
    } catch (e) { setErr(e.message); }
    setSending(false);
  };
  if (picking !== null) {
    const mine = picking, p = s.profile;
    return html`<${TradePicker} close=${() => setPicking(null)} title=${mine ? 'Pick cards to give' : `Pick from ${friend}'s cards`}
      avatar=${mine ? p.avatar : avatar} spare=${(mine ? cards?.mine : cards?.theirs) || {}} fused=${(mine ? cards?.mineFused : cards?.theirsFused) || []}
      owned=${mine ? p.collection : {}} team=${mine ? p.team : []} picked=${mine ? give : get} setPicked=${mine ? setGive : setGet} />`;
  }
  const side = (title, sub, list, setList, gold, setGold, label, maxGold, mine) => html`<div class="panel pad col" style="border-color: rgba(232,184,90,.2);">
    <div class="row" style="justify-content: space-between;"><span class="label">${title}</span><span class="tiny muted">${sub}</span></div>
    <div class="so-bslots">${[0, 1, 2].map(i => list[i] ? html`<div class="cp-cell">
        <${Card} id=${tradeCard(list[i]).id} fusion=${fusionIn(list[i], lists)} />
        <button class="so-rm" onClick=${() => setList(list.filter((_, j) => j !== i))} aria-label="Remove ${tradeCard(list[i]).name}"><${Icon} name="x" size="10" /></button></div>`
      : html`<button class="slot" style="aspect-ratio: 5/7; border-radius: 8px; border: 1.5px dashed rgba(232,184,90,.45); background: rgba(7,6,12,.5); color: var(--brass); cursor: pointer; display: flex; align-items: center; justify-content: center;"
          disabled=${!cards} onClick=${() => setPicking(mine)} aria-label="Add a card"><${Icon} name="plus" size="24" /></button>`)}</div>
    <div class="row so-step"><span class="muted grow">${label}</span>
      <button onClick=${() => setGold(Math.max(0, gold - 50))} aria-label="Less gold"><${Icon} name="minus" size="14" /></button>
      <span class="row head num" style="gap: 6px; font-size: 17px; min-width: 80px; justify-content: center;"><${Coin} />${fmt(gold)}</span>
      <button onClick=${() => setGold(Math.min(maxGold, gold + 50))} aria-label="More gold"><${Icon} name="plus" size="14" /></button></div>
  </div>`;
  return html`<${Screen} close=${close} title=${counter ? `Counter ${friend}` : `Trade with ${friend}`} right=${html`<${Avatar} id=${avatar} size="40" />`}>
    <div class="so-wrap">
      ${side('You give', 'up to 3 cards', give, setGive, giveGold, setGiveGold, 'Add gold', cards?.gold || 0, true)}
      ${side('You get', `from ${friend}'s cards`, get, setGet, getGold, setGetGold, 'Ask for gold', 1000000, false)}
      ${err && html`<p class="err" role="alert" style="margin: 0;">${err}</p>`}
      <button class="btn gold big wide" disabled=${sending || !cards || (!give.length && !get.length && !giveGold && !getGold)} onClick=${send}>${sending ? 'Sending…' : 'Send offer'}</button>
      <p class="small muted" style="text-align: center; margin: 0;">${friend} can accept, decline or send a counter offer.</p>
    </div>
  <//>`;
}

// Pick cards for one side: plain spare copies (a count when you have several) and fused copies (each its own item).
function TradePicker({ close, title, avatar, spare, fused, owned, team, picked, setPicked }) {
  const [sort, setSort] = useState(local.get('collectionSort', 0));
  const teamSet = new Set(team);
  const ids = new Set([...Object.keys(spare), ...Object.keys(owned).filter(id => teamSet.has(id))]);
  const list = sortCards(CARDS.filter(c => ids.has(c.id)), sort, spare);
  const order = new Map(sortCards(CARDS, sort).map((c, i) => [c.id, i]));
  const holoFirst = SORTS[sort % SORTS.length] === 'Holo';
  const rank = f => holoFirst && f.o ? 0 : 1;
  const fusedSorted = fused.slice().sort((a, b) => rank(a) - rank(b) || order.get(a.card) - order.get(b.card) || fusionTotal(b) - fusionTotal(a));
  const remove = id => { const i = picked.lastIndexOf(id); if (i >= 0) setPicked(picked.filter((_, j) => j !== i)); };
  return html`<${Screen} close=${close} title=${title} right=${html`<${Avatar} id=${avatar} size="40" />`}>
    <div class="so-wrap" style="width: min(1100px, 100%);">
      <div class="row"><span class="label grow">${picked.length} of 3 picked</span>
        <button class="btn out sm" onClick=${() => { const n = (sort + 1) % SORTS.length; setSort(n); local.set('collectionSort', n); }}>Sort: ${SORTS[sort % SORTS.length]}</button></div>
      ${Object.keys(owned).length > 0 && html`<span class="small muted">Team cards are locked unless you have a spare copy.</span>`}
      <div class="so-pick">
        ${fusedSorted.map(f => { const tok = tradeToken(f), on = picked.includes(tok); return html`<div class="cp-cell">
          <${Card} id=${f.card} fusion=${fusedCopy(f)} selected=${on} onClick=${() => on ? setPicked(picked.filter(x => x !== tok)) : picked.length < 3 && setPicked([...picked, tok])} /></div>`; })}
        ${list.map(c => {
          const free = spare[c.id] || 0, chosen = picked.filter(x => x === c.id).length, have = owned[c.id] ?? free;
          return html`<div class="cp-cell" style=${free ? '' : 'opacity: .35;'}>
            <${Card} id=${c.id} count=${have} selected=${chosen > 0} label="${c.name}${free ? '' : ', on your team'}"
              onClick=${() => { if (!free) return; if (!chosen) { if (picked.length < 3) setPicked([...picked, c.id]); } else if (free === 1) remove(c.id); }} />
            ${!free && html`<div class="onteam"><span>On team</span></div>`}
            ${chosen > 0 && free > 1 && html`<div class="so-copies"><button onClick=${() => remove(c.id)} aria-label="One fewer"><${Icon} name="minus" size="11" /></button>
              <span class="head num" style="font-size: 12px; min-width: 40px; text-align: center;">${chosen} of ${free}</span>
              <button onClick=${() => picked.length < 3 && chosen < free && setPicked([...picked, c.id])} aria-label="One more"><${Icon} name="plus" size="11" /></button></div>`}
          </div>`; })}
      </div>
      <button class="btn gold big wide" onClick=${close}>Done</button>
    </div>
  <//>`;
}
