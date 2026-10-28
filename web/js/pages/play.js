// The Play tab (PlayTab in the app): main quest, the campaign, packs to open, daily things, modes, team, friends online, stats.
import { html, useState, useEffect } from '../vendor/preact-htm.js';
import { card, art, CARDS, battleFusion, fusionTotal, xpInto, xpNeed } from '../cards.js';
import { useStore, api, openScreen, claimMainQuest, goTab } from '../store.js';
import { Icon, Coin, Tile, Avatar, Bar, PackImg, LockLine, fmt, useNow, left } from '../ui.js';
import { CampaignMap } from '../screens/campaign.js';
import { FriendBattle } from '../screens/friend.js';
import { Gauntlet } from '../screens/gauntlet.js';
import { Ranked, RankEmblem, rankColor } from '../screens/ranked.js';
import { Quests } from '../screens/quests.js';
import { Hunt, HUNT_GOLD } from '../screens/hunt.js';
import { DailySpin, MiniWheel, spinReady } from '../screens/spin.js';
import { PacksScreen, RecruitView } from './shop.js';

export function PlayTab() {
  const s = useStore(), p = s.profile;
  useEffect(() => {
    // A friend match left open (page closed mid-battle) reopens straight away.
    api('matches/current').then(m => { if (m?.status === 'active') openScreen(FriendBattle, {}); }).catch(() => {});
  }, []);
  if (!p) return null;
  return html`<div class="page play">
    <div class="mainc">
      ${p.mainQuest && html`<${MainQuest} q=${p.mainQuest} />`}
      <${CampaignHero} p=${p} />
      <span class="label">Daily</span>
      <${Daily} p=${p} />
      <span class="label">Modes</span>
      <${Modes} p=${p} />
    </div>
    <aside>
      <section class="panel pad col">
        <div class="row" style="justify-content: space-between;"><span class="label">Your team</span><a href="#/cards" class="link small">Edit</a></div>
        <div class="row" style="gap: 10px; align-items: flex-start;">
          ${[0, 1, 2].map(i => html`<div class="grow" style="flex: 1;"><${Tile} id=${p.team[i]} fused=${fusionTotal(battleFusion(p, p.team[i])) > 0} sub=${i === 1 ? 'Level 3' : 'Level 6'} /></div>`)}
        </div>
      </section>
      ${p.unopened?.length > 0 && html`<${PacksRow} u=${p.unopened} />`}
      <${Online} />
      <div class="stats3">
        ${[[fmt(p.wins), 'Wins'], [`${Object.keys(p.collection).length}/${CARDS.length}`, 'Cards'], [fmt(p.packs), 'Packs opened']].map(([v, k]) =>
          html`<div class="panel stat"><b>${v}</b><span class="tiny muted">${k}</span></div>`)}
      </div>
    </aside>
  </div>`;
}

// The active main quest: progress, then Claim once it's done.
function MainQuest({ q }) {
  const [busy, setBusy] = useState(false);
  return html`<section class="mq ${q.done ? 'done' : ''}" aria-label="Main quest">
    <div class="col grow" style="gap: 6px;">
      <span class="label" style="font-size: 11px; letter-spacing: 2.5px;">Main quest ${q.step} / ${q.total}</span>
      <span class="head ellipsis" style="font-size: 18px;">${q.name}</span>
      <div class="row" style="gap: 10px;"><${Bar} value=${q.n} max=${q.goal} style="flex: 1; max-width: 420px;" /><span class="small soft num">${q.done ? 'Done!' : `${q.n} / ${q.goal}`}</span></div>
    </div>
    ${q.done
      ? html`<button class="btn gold" style="height: 44px;" disabled=${busy} onClick=${async () => { setBusy(true); await claimMainQuest(); setBusy(false); }}>Claim</button>`
      : html`<span class="row head" style="gap: 5px; color: var(--brass); font-size: 15px;">${q.gold > 0 ? html`<${Coin} size="14" />+${fmt(q.gold)}` : `+${q.xp} XP`}</span>`}
  </section>`;
}

function CampaignHero({ p }) {
  const c = p.campaign, next = c.next, recruit = (p.recruit || 0) > 0;
  const lead = next?.enemies?.[0];
  return html`<section class="hero" aria-label="Campaign">
    <img src=${lead ? art(lead) : '/img/card_bg.webp'} alt="" />
    <div class="fade"></div>
    <div class="txt">
      <span class="tag">Campaign · Chapter ${c.chapterNum}</span>
      ${recruit ? html`<span class="eyebrow" style="color: var(--brass);">Recruit Pack</span><h2>Your next starter is waiting</h2>`
        : next ? html`<span class="eyebrow">${next.boss ? `Boss · Level ${next.num}` : `Level ${next.num}`} · ${c.chapter}</span><h2>${next.title}</h2>
            <div class="row party" style="gap: 8px; margin-top: 4px;">${next.enemies.map(id => html`<${Avatar} id=${id} size="40" />`)}</div>`
        : html`<span class="eyebrow" style="color: var(--brass);">${c.chapter}</span><h2>Chapter complete!</h2><span class="muted">More chapters are on the way.</span>`}
      <div class="acts">
        ${recruit ? html`<button class="btn gold big" onClick=${() => openScreen(RecruitView, { title: 'Your next starter is waiting' })}>Open</button>`
          : next ? html`<button class="btn gold big" style="padding: 0 34px;" onClick=${() => openScreen(CampaignMap, {})}>${c.cleared === 0 ? 'Start' : 'Continue'}</button>`
          : html`<button class="btn out" onClick=${() => openScreen(CampaignMap, {})}>Map</button>`}
      </div>
    </div>
  </section>`;
}

// Packs won or bought, waiting to be opened. Only shown when there are some.
function PacksRow({ u }) {
  const total = u.reduce((a, b) => a + b.n, 0);
  return html`<button class="packsbtn" onClick=${() => openScreen(PacksScreen, {})}>
    <div class="fan3">${u.slice(0, 3).map((pk, i) => html`<img src=${pk.type === 'cyber' ? '/img/pack.webp' : `/img/pack_${pk.type}.webp`} alt="" style="left: ${i * 22}px; transform: rotate(${(i - 1) * 8}deg);" />`)}</div>
    <div class="col grow" style="gap: 4px;"><span class="label" style="font-size: 11px;">Your packs</span><span class="head" style="font-size: 18px;">${total === 1 ? '1 to open' : `${total} to open`}</span></div>
    <span class="btn gold" style="height: 44px; pointer-events: none;">Open</span>
  </button>`;
}

const chipIcon = (name) => html`<${Icon} name=${name} size="34" style="color: var(--brass);" />`;
function DailyChip({ title, sub, accent, alert, lock, icon, onClick }) {
  return html`<button class="dchip" style="--acc: ${accent}${alert ? 'b3' : '59'};" disabled=${!!lock} onClick=${onClick}
      aria-label="${title}, ${lock ? 'locked: ' + lock : sub}">
    <span class="ic">${icon}</span>
    <span class="col" style="gap: 3px; min-width: 0;"><span class="head" style="font-size: 17px;">${title}</span>
      ${lock ? html`<${LockLine} text=${lock.replace('Clear ', '').replace('Reach player level', 'Player Lv')} />` : html`<span class="t2 small soft num ellipsis">${sub}</span>`}</span>
    ${alert && !lock && html`<span class="dot"></span>`}
  </button>`;
}

function Daily({ p }) {
  useNow(1000);
  const q = p.quests, ready = spinReady(p.nextSpin);
  return html`<div class="dailyrow">
    ${q && html`<${DailyChip} title="Quests" sub=${q.bonus === 'claimed' ? 'All done' : `${q.list.filter(x => x.n >= x.goal).length} of ${q.list.length} done`} accent="#3DFF8A"
      alert=${q.list.some(x => x.n >= x.goal && !x.claimed) || q.bonus === 'ready'} lock=${p.locked?.quests} icon=${chipIcon('scroll')} onClick=${() => openScreen(Quests, {})} />`}
    <${DailyChip} title="Spin" sub=${ready ? 'Ready!' : `Ready in ${clockLeft(p.nextSpin)}`} accent="#FF4D5E" alert=${ready} lock=${p.locked?.spin}
      icon=${html`<${MiniWheel} lit=${ready} size="38" />`} onClick=${() => ready && openScreen(DailySpin, {})} />
    <${DailyChip} title="Shop" sub="New cards today" accent="#B46BFF" alert=${false} lock=${p.locked?.shop}
      icon=${html`<${PackImg} type="omni" height="44" />`} onClick=${() => goTab('shop')} />
  </div>`;
}
function clockLeft(t) {
  const s = Math.max(0, Math.floor((t - Date.now()) / 1000)), pad = n => String(n).padStart(2, '0');
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s % 3600 / 60))}:${pad(s % 60)}`;
}

function ModeTile({ title, sub, accent, lock, alert, art: a, fill, onClick }) {
  return html`<button class="mode" style="--acc: ${accent}${lock ? '33' : '8c'}; --acc-soft: ${accent}4d;" disabled=${!!lock} onClick=${onClick}
      aria-label="${title}, ${lock ? 'locked: ' + lock : sub}">
    ${fill ? html`${a}<span class="shade"></span>` : html`<span class="art" aria-hidden="true">${a}</span>`}
    <span class="head" style="font-size: 20px;">${title}</span>
    ${lock ? html`<span><${LockLine} text=${lock} /></span>` : html`<span class="small soft ellipsis">${sub}</span>`}
    ${alert && !lock && html`<span class="dot"></span>`}
  </button>`;
}

function Modes({ p }) {
  const lock = k => p.locked?.[k];
  const r = p.ranked, h = p.hunt;
  return html`<div class="modesrow">
    ${r && html`<${ModeTile} title="Ranked" sub="${r.name} · #${r.place} this week" accent=${rankColor(r.rank)} lock=${lock('ranked')} alert=${r.alert}
      art=${html`<${RankEmblem} rank=${r.rank} size="56" />`} onClick=${() => openScreen(Ranked, {})} />`}
    <${ModeTile} title="Gauntlet" sub="Best streak ${p.gauntlet.best}" accent="#FF4D5E" lock=${lock('gauntlet')}
      art=${html`<${Icon} name="swords" size="44" style="color: var(--brass);" />`} onClick=${() => openScreen(Gauntlet, {})} />
    ${h && html`<${ModeTile} title="Legend Hunt" sub=${h.status === 'ready' || h.status === 'playing' ? `${card(h.legend)?.name ?? h.legend} · 1 try` : `Back in ${left(h.next)}`}
      accent=${HUNT_GOLD} lock=${lock('hunt')} fill=${true} art=${html`<img class="fill" src=${art(h.legend)} alt="" />`} onClick=${() => openScreen(Hunt, {})} />`}
    <${ModeTile} title="Friendly Battle" sub="Battle a friend" accent="#3FF0FF" lock=${lock('friends')}
      art=${html`<${Icon} name="bolt" size="44" style="color: var(--brass);" />`} onClick=${() => openScreen(FriendBattle, {})} />
  </div>`;
}

// Up to 3 friends who are online, with a quick Battle; hidden when nobody is.
function Online() {
  const s = useStore();
  const on = (s.social?.friends || []).filter(f => f.online).slice(0, 3);
  if (!on.length) return null;
  const locked = s.profile.locked?.friends;
  return html`<section class="panel pad col" style="gap: 14px;">
    <div class="row" style="justify-content: space-between;"><span class="label">Online now</span><a href="#/social" class="link small">All friends →</a></div>
    <ul style="list-style: none; margin: 0; padding: 0;" class="col">
      ${on.map(f => html`<li class="row" style="gap: 10px;">
        <span style="position: relative; display: flex;"><${Avatar} id=${f.avatar} size="38" /><span style="position: absolute; right: -1px; bottom: -1px; width: 11px; height: 11px; border-radius: 50%; background: var(--online); border: 2px solid #12101E;"></span></span>
        <div class="col grow" style="gap: 0;"><span class="head" style="font-size: 15px;">${f.name}</span><span class="tiny muted">Level ${f.level} · Online</span></div>
        ${!locked && html`<button class="btn out sm" onClick=${() => openScreen(FriendBattle, { friend: f.name })}>Battle</button>`}
      </li>`)}
    </ul>
  </section>`;
}
