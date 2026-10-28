// The Profile tab (ProfileTab in the app): picture, level, stats, how much of the set you own, sound switches,
// plus the account (email, log out, delete) and the legal pages.
import { html, useState } from '../vendor/preact-htm.js';
import { CARDS, card as cardOf, rarityColor, holoCount, xpInto, xpNeed } from '../cards.js';
import { useStore, api, set, setAvatar, setEmail, logout } from '../store.js';
import { Icon, Avatar, Screen, Modal, fmt } from '../ui.js';
import { Music, prefs, setEffects } from '../sound.js';

const RAINBOW = 'linear-gradient(90deg, #FF3D6E, #FFB03D, #FFF03D, #3DFF8A, #3DD6FF, #8A5CFF, #FF3DF0)';

export function ProfileTab() {
  const s = useStore(), p = s.profile;
  const [music, setMusic] = useState(prefs.music), [effects, setFx] = useState(prefs.effects);
  const [modal, setModal] = useState(null);     // 'avatar' | 'email' | 'logout' | 'delete'
  if (!p) return null;
  const since = new Date(p.since).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  const frac = xpInto(p) / xpNeed(p), R = 54, C = 2 * Math.PI * R;
  const toggle = (label, on, change) => html`<div class="pf-set"><span class="grow">${label}</span>
    <button class="toggle" role="switch" aria-checked=${on} aria-label=${label} onClick=${() => change(!on)}><i></i></button></div>`;
  return html`<div class="page pf">
    <div class="pf-l">
      <div class="pf-head">
        <div class="pf-ring">
          <svg class="ring" viewBox="0 0 116 116" width="116" height="116" aria-hidden="true">
            <circle cx="58" cy="58" r=${R} fill="none" stroke="rgba(232,184,90,.15)" stroke-width="6" />
            <circle cx="58" cy="58" r=${R} fill="none" stroke="var(--brass)" stroke-width="6" stroke-linecap="round" stroke-dasharray=${`${C * frac} ${C}`} /></svg>
          <${Avatar} id=${p.avatar} size="94" />
          <span class="pf-lv">LV ${p.level}</span>
          <button class="pf-edit" onClick=${() => setModal('avatar')} aria-label="Change picture"><${Icon} name="pencil" size="14" /></button>
        </div>
        <span class="h1" style="margin-top: 12px; font-size: 26px;">${p.username}</span>
        <span class="small muted">${fmt(xpNeed(p) - xpInto(p))} XP to level ${p.level + 1} · Playing since ${since}</span>
      </div>
      <div class="stats3">${[[fmt(p.wins), 'Wins'], [p.campaign.next ? `Ch ${p.campaign.chapterNum} · ${p.campaign.next.num}` : 'Done', 'Campaign'], [fmt(p.friends), 'Friends']]
        .map(([v, k]) => html`<div class="panel stat" style="border-color: rgba(232,184,90,.2);"><b class="ellipsis">${v}</b><span class="tiny muted">${k}</span></div>`)}</div>
      <section class="panel pad col" style="gap: 10px; border-color: rgba(232,184,90,.2);" aria-label="Collection">
        <div class="row" style="justify-content: space-between;"><span class="label">Collection</span><span class="head" style="font-size: 13px;">${Object.keys(p.collection).length}/${CARDS.length}</span></div>
        ${['Common', 'Rare', 'Epic', 'Legendary', 'Holo'].map(r => {
          const all = r === 'Holo' ? CARDS : CARDS.filter(c => c.rarity === r);
          const have = r === 'Holo' ? all.filter(c => holoCount(p, c.id) > 0).length : all.filter(c => p.collection[c.id]).length;
          return html`<div class="pf-bar" role="img" aria-label="${r}: ${have} of ${all.length}"><span>${r}</span>
            <span class="t"><i style="width: ${100 * have / Math.max(all.length, 1)}%; background: ${r === 'Holo' ? RAINBOW : rarityColor(r)};"></i></span>
            <span class="head muted" style="font-size: 13px; text-align: right;">${have}/${all.length}</span></div>`;
        })}
      </section>
    </div>
    <div class="pf-r">
      <section class="panel pad" style="padding-top: 4px; padding-bottom: 4px; border-color: rgba(232,184,90,.2);" aria-label="Settings">
        ${toggle('Music', music, on => { setMusic(on); Music.setEnabled(on); })}
        ${toggle('Sound effects', effects, on => { setFx(on); setEffects(on); })}
      </section>
      <section class="panel pad" style="padding-top: 4px; padding-bottom: 4px; border-color: rgba(232,184,90,.2);" aria-label="Account">
        <div class="pf-set"><div class="col grow" style="gap: 2px; min-width: 0;"><span>Email</span><span class="small muted ellipsis">${p.email || 'None yet'}</span></div>
          <button class="btn out sm" onClick=${() => setModal('email')}>Change</button></div>
        <div class="pf-set"><button class="link" style="color: var(--pink); font-size: 15px;" onClick=${() => setModal('logout')}>Log out</button></div>
        <div class="pf-set"><button class="link" style="color: var(--muted); font-weight: 400;" onClick=${() => setModal('delete')}>Delete account</button></div>
      </section>
    </div>
    <footer class="pf-legal">
      <p><a href="/terms" target="_blank" rel="noopener">Terms and Conditions</a> · <a href="/privacy" target="_blank" rel="noopener">Privacy Policy</a></p>
      <p class="tiny muted">© 2026 Lucas Seeley. All rights reserved.</p>
    </footer>
    ${modal === 'avatar' && html`<${AvatarPicker} close=${() => setModal(null)} />`}
    ${modal === 'email' && html`<${EmailModal} close=${() => setModal(null)} />`}
    ${modal === 'logout' && html`<${Modal} label="Log out" onClose=${() => setModal(null)}><div class="col" style="text-align: center;">
      <span class="h2">Log out of HoloSynth?</span>
      <div class="row" style="gap: 10px;"><button class="btn out" style="flex: 1;" onClick=${() => setModal(null)}>Cancel</button>
        <button class="btn gold" style="flex: 1;" onClick=${() => { Music.stop(); logout(); }}>Log out</button></div></div><//>`}
    ${modal === 'delete' && html`<${DeleteModal} close=${() => setModal(null)} />`}
  </div>`;
}

// Pick any card you own as your picture.
function AvatarPicker({ close }) {
  const s = useStore(), p = s.profile;
  return html`<${Screen} close=${close} title="Choose your picture"><div class="so-wrap" style="width: min(900px, 100%);">
    <div class="pf-avatars">${CARDS.filter(c => p.collection[c.id]).map(c => html`<button aria-pressed=${p.avatar === c.id}
      onClick=${async () => { await setAvatar(c.id); close(); }}><${Avatar} id=${c.id} size="66" /><span class="head ellipsis" style="font-size: 12px; max-width: 100%;">${c.name}</span></button>`)}</div>
  </div><//>`;
}

function EmailModal({ close }) {
  const [email, setE] = useState(''), [pw, setPw] = useState(''), [busy, setBusy] = useState(false), [err, setErr] = useState(null);
  const save = async e => { e.preventDefault(); setBusy(true); const r = await setEmail(email, pw); setBusy(false); if (r) setErr(r); else close(); };
  return html`<${Modal} label="Change email" onClose=${close}><form class="col" onSubmit=${save}>
    <span class="h2">Change email</span>
    <input class="field" type="email" placeholder="New email" autocomplete="email" value=${email} onInput=${e => setE(e.target.value)} />
    <input class="field" type="password" placeholder="Your password" autocomplete="current-password" value=${pw} onInput=${e => setPw(e.target.value)} />
    ${err && html`<p class="err" role="alert" style="margin: 0;">${err}</p>`}
    <div class="row" style="gap: 10px;"><button type="button" class="btn out" style="flex: 1;" onClick=${close}>Cancel</button>
      <button class="btn gold" style="flex: 1;" disabled=${busy || !email || !pw}>${busy ? '…' : 'Save'}</button></div>
  </form><//>`;
}

// Deleting asks for the password again (a stolen session alone can't delete an account).
function DeleteModal({ close }) {
  const [pw, setPw] = useState(''), [busy, setBusy] = useState(false), [err, setErr] = useState(null);
  const del = async e => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { await api('me/delete', { password: pw }); Music.stop(); set({ authed: false, profile: null, social: null, screens: [], error: null }); }
    catch (x) { setErr(x.message); setBusy(false); }
  };
  return html`<${Modal} label="Delete account" onClose=${close}><form class="col" onSubmit=${del}>
    <span class="h2">Delete your account?</span>
    <span class="muted">Your cards, progress, friends and trades are deleted for good. This can't be undone.</span>
    <input class="field" type="password" placeholder="Your password" autocomplete="current-password" value=${pw} onInput=${e => setPw(e.target.value)} />
    ${err && html`<p class="err" role="alert" style="margin: 0;">${err}</p>`}
    <div class="row" style="gap: 10px;"><button type="button" class="btn out" style="flex: 1;" onClick=${close}>Keep it</button>
      <button class="btn gold" style="flex: 1; background: linear-gradient(180deg, #FF7884, #E0303F); color: #fff;" disabled=${busy || !pw}>${busy ? '…' : 'Delete'}</button></div>
  </form><//>`;
}
