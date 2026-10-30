// Season Pass (PassView in the app): this season's prize, your tier and Pass XP, and the 30-tier reward track.
// The server keeps the XP and what's claimed; packs you claim wait in Your packs on the Play tab.
import { html, useState, useEffect, useRef } from '../vendor/preact-htm.js';
import { useStore, api, set, refresh } from '../store.js';
import { Card, CardBack, Icon, PackImg, Screen, fmt, useNow, left } from '../ui.js';
import { PowerCard } from '../pages/cards.js';
import { power, card } from '../cards.js';
import { packInfo } from '../pages/shop.js';
import { Sound } from '../sound.js';

const COINS = { 500: [[0, 6], [-13, 14], [13, 14]], 750: [[0, -4], [-13, 10], [13, 10], [0, 20]] };
const Coins = ({ n }) => html`<svg viewBox="0 0 80 80" class="pcoins" aria-hidden="true">${(COINS[n] || COINS[500]).map(([x, y]) => html`
  <circle cx=${40 + x} cy=${36 + y} r="13" fill="#E8B85A" stroke="#7a4f10" stroke-width="1.5" />
  <circle cx=${40 + x} cy=${36 + y} r="7.5" fill="none" stroke="#1A0D05" stroke-width="1.6" opacity=".45" />`)}</svg>`;

// What a tier gives, in words and as a picture.
export const rewardName = r => r.gold ? `${fmt(r.gold)} gold` : r.power ? power(r.power)?.name ?? 'Power card'
  : r.card ? `Season card + ${packInfo(r.pack).name}` : packInfo(r.pack).name;
const RewardArt = ({ r }) => r.gold ? html`<${Coins} n=${r.gold} />`
  : r.power ? html`<div class="ppower"><${PowerCard} pw=${power(r.power)} /></div>`
  : html`<${PackImg} type=${r.pack} height="104" />${r.tier30 && html`<div class="pmini"><${SeasonCard} id=${r.card} /></div>`}`;

// The season card (it comes holo): the real card once it's out, a shimmering card back until then.
export const SeasonCard = ({ id }) => id ? html`<${Card} id=${id} fusion=${{ o: 1 }} />` : html`<div class="pmystery"><${CardBack} /><span class="pholo"></span><span class="pq">?</span></div>`;

export function SeasonPass({ close }) {
  const s = useStore(), p = s.profile?.pass;
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const track = useRef();
  useNow(60000);
  useEffect(() => { refresh(); }, []);   // XP earned since the profile was last loaded
  const tier = p ? Math.min(p.tiers, Math.floor(p.xp / p.per)) : 0;
  useEffect(() => {   // open on the first reward to claim, else the tier you're working on
    const el = track.current; if (!el || !p) return;
    const ready = p.rewards.findIndex((_, i) => i < tier && !p.claimed.includes(i + 1));
    el.querySelector(`[data-tier="${(ready >= 0 ? ready : Math.min(tier, p.tiers - 1)) + 1}"]`)?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [!!p]);
  if (!p) return null;

  const claim = async t => {
    setBusy(true);
    try {
      const r = await api('pass/claim', { tier: t });
      set({ profile: r.profile }); Sound.play('rare');
      setNote(r.reward.pack ? `${packInfo(r.reward.pack).name} added to Your packs` : `${rewardName(r.reward)} claimed`);
    } catch (e) { setNote(e.message); await refresh(); }
    setBusy(false);
  };
  const final = p.rewards[p.tiers - 1], toClaim = p.rewards.filter((_, i) => i < tier && !p.claimed.includes(i + 1)).length;
  const into = tier >= p.tiers ? p.per : p.xp - tier * p.per;
  return html`<${Screen} close=${close} title="Season ${p.season}" right=${html`<span class="small soft">Ends in <b class="head" style="color: var(--fg);">${left(p.ends)}</b></span>`}>
    <div class="pass">
      <div class="phero" aria-hidden="true"><${PackImg} type=${final.pack} height="250" /><div class="pscard"><${SeasonCard} id=${final.card} /></div></div>
      <div class="pprize">
        <h2>${final.card ? card(final.card)?.name : `Season ${p.season} card`}</h2>
        <p>A holo ${final.card ? card(final.card)?.cls + ' ' : ''}card you can only get this season. Reach tier ${p.tiers} to unlock it, plus a ${packInfo(final.pack).name}.</p>
      </div>
      <div class="pprog">
        <div class="pbadge" aria-label="Tier ${tier} of ${p.tiers}"><small>Tier</small><b>${tier}</b></div>
        <div class="grow">
          <div class="pbar"><i style="width: ${100 * into / p.per}%"></i></div>
          <div class="row small soft" style="justify-content: space-between; margin-top: 6px;">
            <span>${tier >= p.tiers ? 'Every tier reached' : `${fmt(into)} / ${fmt(p.per)} to tier ${tier + 1}`}</span>
            ${toClaim > 0 && html`<span style="color: var(--gold-hi);">${toClaim} to claim</span>`}
          </div>
        </div>
      </div>
      ${note && html`<p class="pnote small" role="status">${note}</p>`}
      <div class="ptrackwrap">
      <button class="parr l" aria-label="Earlier tiers" onClick=${() => track.current.scrollBy({ left: -464, behavior: 'smooth' })}><${Icon} name="left" /></button>
      <button class="parr r" aria-label="Later tiers" onClick=${() => track.current.scrollBy({ left: 464, behavior: 'smooth' })}><${Icon} name="right" /></button>
      <div class="ptrack" ref=${track}>
        ${p.rewards.map((r, i) => {
          const t = i + 1, claimed = p.claimed.includes(t), reached = t <= tier;
          const st = claimed ? 'claimed' : reached ? 'ready' : t === tier + 1 ? 'current' : 'locked';
          const big = !!r.pack;
          return html`<div class="ptier ${st} ${big ? 'big' : ''} ${t === p.tiers ? 'final' : ''}" data-tier=${t}>
            <div class="ptile" aria-label="Tier ${t}: ${rewardName(r)}">
              ${st === 'locked' && !big ? html`<${CardBack} />` : html`<div class="pface"><${RewardArt} r=${{ ...r, tier30: t === p.tiers }} /></div><span class="pname">${rewardName(r)}</span>`}
            </div>
            <span class="pnum num">${t}</span>
            ${claimed ? html`<span class="pok">Claimed</span>`
              : reached ? html`<button class="btn gold sm" disabled=${busy} onClick=${() => claim(t)}>Claim</button>`
              : st === 'current' ? html`<span class="pcur num">${fmt(into)} / ${fmt(p.per)}</span>` : null}
          </div>`;
        })}
      </div>
      </div>
      <div class="pearn">
        <div><b>Daily quests</b>100, 150 and 250 Pass XP</div>
        <div><b>Battle wins</b>20 Pass XP each, up to 10 a day</div>
      </div>
    </div>
  </${Screen}>`;
}
