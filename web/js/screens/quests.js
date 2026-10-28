// Daily quests (QuestsView): today's three quests with progress and Claim, and the free pack for finishing all three.
// Progress is counted by the server; this screen only shows it. A claimed pack waits in Your packs.
import { html, useState, useEffect } from '../vendor/preact-htm.js';
import { useStore, api, set, refresh } from '../store.js';
import { Icon, Coin, Screen, PackImg, fmt, useNow, left } from '../ui.js';
import { Sound } from '../sound.js';

const GREEN = '#3DFF8A';

export function Quests({ close }) {
  const s = useStore(), q = s.profile?.quests;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useNow(30000);
  useEffect(() => { refresh(); }, []);   // progress made since the profile was last loaded

  // i: quest index, or 'bonus' for the pack
  const claim = async i => {
    setBusy(true);
    try {
      const r = await api('quests/claim', { quest: i });
      set({ profile: r.profile }); setError(null);
      Sound.play('rare');
      if (r.cards) close();   // the pack waits on the Play tab
    } catch (e) { setError(e.message); await refresh(); }
    setBusy(false);
  };

  const finished = q ? q.list.filter(x => x.n >= x.goal).length : 0;
  const claimedN = q ? q.list.filter(x => x.claimed).length : 0;
  return html`<${Screen} close=${close} title="Daily quests">
    <div class="narrow quests" style="padding: 0 16px 24px;">
      ${q && html`
        <div class="row"><span class="label">Today · ${finished} of ${q.list.length} done</span>
          <span class="small soft" style="margin-left: auto;">New quests in <b class="head" style="color: var(--fg);">${left(q.next)}</b></span></div>
        <div class="panel qlist">
          ${q.list.map((x, i) => {
            const done = x.n >= x.goal;
            return html`<div class="qrow">
              <div class="col grow" style="gap: 6px;">
                <div class="row" style="align-items: baseline;"><span class="head grow ellipsis" style="font-size: 16px;">${x.name}</span><span class="head soft num" style="font-size: 13px;">${x.n}/${x.goal}</span></div>
                <div class="bar"><i style="width: ${100 * Math.min(1, x.n / Math.max(x.goal, 1))}%; background: ${done ? GREEN : 'var(--brass)'};"></i></div>
                <span class="tiny muted">${[x.hint, done ? `+${fmt(x.gold)} gold · +${fmt(x.xp)} XP` : `+${fmt(x.xp)} XP`].filter(Boolean).join(' · ')}</span>
              </div>
              <div class="qact">
                ${x.claimed ? html`<span class="qdone"><${Icon} name="check" size="12" />Done</span>`
                  : done ? html`<button class="btn gold sm wide" style="height: 38px;" disabled=${busy} onClick=${() => claim(i)}>Claim</button>`
                  : html`<span class="row head" style="gap: 5px; color: var(--gold-hi); justify-content: flex-end;"><${Coin} size="14" />${fmt(x.gold)}</span>`}
              </div>
            </div>`;
          })}
        </div>
        <div class="qbonus ${q.bonus === 'ready' ? 'ready' : ''}">
          <${PackImg} type=${q.bonusPack} height="74" style="filter: saturate(${q.bonus === 'ready' ? 1 : 0.5}); opacity: ${q.bonus === 'locked' ? 0.55 : 1};" />
          <div class="col grow" style="gap: 5px;">
            <span class="label" style="font-size: 11px; letter-spacing: 2px;">${q.bonus === 'claimed' ? 'Claimed today' : 'Finish all 3'}</span>
            <span class="head" style="font-size: 17px;">Free ${q.bonusPack[0].toUpperCase() + q.bonusPack.slice(1)} Pack</span>
            ${q.bonus === 'ready' ? html`<button class="btn gold sm" style="height: 38px;" disabled=${busy} onClick=${() => claim('bonus')}>Claim</button>`
              : html`<div class="row" style="gap: 5px;">${[0, 1, 2].map(i => html`<span class="qpip" style="background: ${i < claimedN ? GREEN : 'rgba(255,255,255,.1)'};"></span>`)}</div>`}
          </div>
        </div>
        <p class="small muted" style="text-align: center; margin: 0;">Three new quests every day. Progress counts automatically.</p>`}
      ${error && html`<p class="err" style="text-align: center; margin: 0;">${error}</p>`}
    </div>
  </${Screen}>`;
}
