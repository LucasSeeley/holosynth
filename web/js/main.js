// HoloSynth web: boot, sign-in, and the app shell (sidebar on wide screens, the app's tab bar on phones).
import { html, render, useState, useEffect } from './vendor/preact-htm.js';
import { loadCards, card, xpInto, xpNeed } from './cards.js';
import { state, useStore, set, boot, auth, setEmail, agree, logout, loadSocial, refresh, openScreen, closeScreen, screenOpen, local } from './store.js';
import { Icon, Coin, Avatar, Bar, fmt, PackImg } from './ui.js';
import { Music } from './sound.js';
import { PlayTab } from './pages/play.js';
import { ShopTab, RecruitView } from './pages/shop.js';
import { CollectionTab } from './pages/cards.js';
import { SocialTab } from './pages/social.js';
import { ProfileTab } from './pages/profile.js';
import { DailySpin } from './screens/spin.js';

// Very wide screens (1440p, 4K) get the same layout zoomed up, so nothing ends up tiny in a corner.
function fitZoom() {
  const w = innerWidth, h = innerHeight;   // CSS zoom doesn't change these
  const z = w >= 2000 ? Math.min(w / 1600, h / 900, 2.6) : 1;
  document.documentElement.style.zoom = z === 1 ? '' : String(z);
  document.documentElement.style.setProperty('--z', z);   // 100dvh is in unzoomed pixels: heights divide by this
  document.documentElement.classList.toggle('wide', w >= 760);
}
addEventListener('resize', fitZoom);
// Firefox ignores -webkit-user-drag: stop picture drags everywhere (card slots drag their button, not the image)
addEventListener('dragstart', e => { if (e.target instanceof HTMLImageElement) e.preventDefault(); });
fitZoom();

const TABS = [
  { key: 'play', name: 'Play', icon: 'bolt', view: PlayTab },
  { key: 'shop', name: 'Shop', icon: 'bag', view: ShopTab },
  { key: 'cards', name: 'Cards', icon: 'grid', view: CollectionTab },
  { key: 'social', name: 'Social', icon: 'people', view: SocialTab },
  { key: 'profile', name: 'Profile', icon: 'person', view: ProfileTab },
];
const tabFromHash = () => TABS.find(t => '#/' + t.key === location.hash)?.key || 'play';

function useTab() {
  const [tab, setTab] = useState(tabFromHash());
  useEffect(() => { const f = () => setTab(tabFromHash()); addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []);
  return tab;
}

// ---- sign in ----
// The three packs fanned out: Cyber, Omni in front, Magic.
export function PackFan({ height = 210 }) {
  const pack = (type, angle, x) => html`<img src=${type === 'cyber' ? '/img/pack.webp' : `/img/pack_${type}.webp`} alt=""
    style="height: ${type === 'omni' ? height : height * 0.86}px; transform: translateX(${x * height * 0.62}px) rotate(${angle}deg); ${type === 'omni' ? 'z-index: 1;' : 'filter: brightness(.92);'}" />`;
  return html`<div class="fan" style="height: ${height}px;" aria-hidden="true">${pack('cyber', -13, -0.42)}${pack('magic', 13, 0.42)}${pack('omni', -3, 0)}</div>`;
}

const USER_RE = /^[A-Za-z0-9_]{3,16}$/, EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
function AuthView() {
  const s = useStore();
  const [f, setF] = useState({ username: '', email: '', password: '', confirm: '', terms: false, privacy: false });
  const [newAccount, setNew] = useState(true);
  const [busy, setBusy] = useState(false);
  const upd = k => e => setF({ ...f, [k]: e.target.value });
  let problem = null;
  if (newAccount) {
    if (f.username && !USER_RE.test(f.username)) problem = 'Username: 3–16 letters, numbers or _';
    else if (f.email && !EMAIL_RE.test(f.email.trim())) problem = 'Enter a valid email';
    else if (f.password && (f.password.length < 8 || !/[A-Za-z]/.test(f.password) || !/[0-9]/.test(f.password))) problem = 'Password: 8+ characters with a letter and a number';
    else if (f.confirm && f.confirm !== f.password) problem = "Passwords don't match";
  }
  const complete = newAccount ? f.username && f.email && f.password && f.confirm && !problem && f.terms && f.privacy : f.username && f.password;
  const submit = async e => {
    e.preventDefault();
    if (busy || !complete) return;
    setBusy(true);
    await auth(f.username, f.email, f.password, newAccount);
    setBusy(false);
  };
  const input = (k, icon, ph, type, ac) => html`<label class="inputrow"><${Icon} name=${icon} />
    <span class="sr">${ph}</span><input type=${type} placeholder=${ph} autocomplete=${ac} autocapitalize="off" spellcheck="false" value=${f[k]} onInput=${upd(k)} /></label>`;
  return html`<div class="auth city"><div class="authwide">
    <div class="col" style="align-items: center; gap: 0;">
      <img src="/img/logo.png" alt="HoloSynth" style="width: min(330px, 80vw); filter: drop-shadow(0 0 18px rgba(255,170,40,.35));" />
      <span class="label" style="margin-top: 6px; letter-spacing: 3.8px;">Rip · Build · Battle</span>
      <div style="margin: 16px 0 20px;"><${PackFan} height=${innerWidth >= 1100 ? 300 : newAccount ? 120 : 210} /></div>
    </div>
    <form class="authbox" onSubmit=${submit} style="padding-top: 0;">
      ${input('username', 'person', newAccount ? 'Username' : 'Username or email', 'text', 'username')}
      ${newAccount && input('email', 'mail', 'Email', 'email', 'email')}
      ${input('password', 'lock', 'Password', 'password', newAccount ? 'new-password' : 'current-password')}
      ${newAccount && input('confirm', 'refresh', 'Confirm password', 'password', 'new-password')}
      ${(s.error || problem) ? html`<p class="err" role="alert" style="text-align: center; margin: 0;">${s.error || problem}</p>`
        : newAccount && !f.password && html`<p class="small muted" style="text-align: center; margin: 0;">8+ characters, with a letter and a number</p>`}
      ${newAccount && html`<div class="agree">
        <label><input type="checkbox" checked=${f.terms} onChange=${e => setF({ ...f, terms: e.target.checked })} />
          <span>I have read and agree to the <a href="/terms" target="_blank" rel="noopener">Terms and Conditions</a></span></label>
        <label><input type="checkbox" checked=${f.privacy} onChange=${e => setF({ ...f, privacy: e.target.checked })} />
          <span>I have read and agree to the <a href="/privacy" target="_blank" rel="noopener">Privacy Policy</a></span></label>
      </div>`}
      <button class="btn gold big wide" disabled=${busy || !complete} style="margin-top: 6px;">${busy ? '…' : newAccount ? 'Create account' : 'Log in'}</button>
      <button type="button" class="link" style="min-height: 44px; font-weight: 400; color: var(--muted);"
        onClick=${() => { setNew(!newAccount); set({ error: null }); setF({ ...f, confirm: '' }); }}>
        ${newAccount ? 'Already have an account? ' : 'New here? '}<b style="color: var(--brass);">${newAccount ? 'Log in' : 'Create an account'}</b></button>
      ${!newAccount && html`<p class="legal"><a href="/terms" target="_blank" rel="noopener">Terms and Conditions</a> · <a href="/privacy" target="_blank" rel="noopener">Privacy Policy</a></p>`}
      <p class="legal">© 2026 Lucas Seeley. All rights reserved.</p>
    </form>
  </div></div>`;
}

// Accounts made before sign-up asked for an email add one once, before playing.
function AddEmailView() {
  const [email, setE] = useState(''), [pw, setPw] = useState(''), [busy, setBusy] = useState(false), [err, setErr] = useState(null);
  const save = async e => { e.preventDefault(); setBusy(true); setErr(await setEmail(email, pw)); setBusy(false); };
  return html`<div class="auth city"><form class="authbox" onSubmit=${save} style="text-align: center; align-items: center;">
    <${Icon} name="mail" size="40" style="color: var(--brass);" />
    <h1 class="h1" style="font-size: 26px;">Add your email</h1>
    <p class="muted" style="margin: 0;">Every account needs one now. It'll let you reset your password later.</p>
    <input class="field" type="email" placeholder="Email" autocomplete="email" value=${email} onInput=${e => setE(e.target.value)} />
    <input class="field" type="password" placeholder="Your password" autocomplete="current-password" value=${pw} onInput=${e => setPw(e.target.value)} />
    ${err && html`<p class="err" role="alert" style="margin: 0;">${err}</p>`}
    <button class="btn gold big wide" disabled=${busy || !email || !pw}>${busy ? '…' : 'Save'}</button>
    <button type="button" class="btn out" onClick=${logout}>Log out</button>
  </form></div>`;
}

// Accounts made before sign-up asked (or after either page changes) agree once before playing.
function AgreeView() {
  const [terms, setT] = useState(false), [privacy, setP] = useState(false), [busy, setBusy] = useState(false), [err, setErr] = useState(null);
  const go = async e => { e.preventDefault(); setBusy(true); setErr(await agree()); setBusy(false); };
  return html`<div class="auth city"><form class="authbox" onSubmit=${go} style="text-align: center; align-items: center;">
    <${Icon} name="shield" size="40" style="color: var(--brass);" />
    <h1 class="h1" style="font-size: 26px;">Before you play</h1>
    <p class="muted" style="margin: 0;">Please read and agree to our Terms and Conditions and Privacy Policy.</p>
    <div class="agree" style="text-align: left; align-self: stretch;">
      <label><input type="checkbox" checked=${terms} onChange=${e => setT(e.target.checked)} />
        <span>I have read and agree to the <a href="/terms" target="_blank" rel="noopener">Terms and Conditions</a></span></label>
      <label><input type="checkbox" checked=${privacy} onChange=${e => setP(e.target.checked)} />
        <span>I have read and agree to the <a href="/privacy" target="_blank" rel="noopener">Privacy Policy</a></span></label>
    </div>
    ${err && html`<p class="err" role="alert" style="margin: 0;">${err}</p>`}
    <button class="btn gold big wide" disabled=${busy || !terms || !privacy}>${busy ? '…' : 'Continue'}</button>
    <button type="button" class="btn out" onClick=${logout}>Log out</button>
  </form></div>`;
}

function Loading() {
  return html`<div class="auth city"><div class="authbox" style="align-items: center;">
    <img src="/img/logo.png" alt="HoloSynth" style="width: min(330px, 80vw);" />
    <div style="margin: 24px 0;"><${PackFan} height="240" /></div><div class="spinner" role="status" aria-label="Loading"></div></div></div>`;
}

// ---- the shell ----
function socialBadge(s) {
  if (!s) return 0;
  return s.requests.length + s.challenges.length + (s.trades || []).filter(t => !t.mine || t.status === 'accepted').length;
}

function Home() {
  const s = useStore(), tab = useTab(), p = s.profile;
  const [spinClosed, setSpinClosed] = useState(false);
  useEffect(() => {
    refresh();
    loadSocial();
    const i = setInterval(() => { if (!document.hidden) loadSocial(); }, 15000);   // requests, challenges, who's online
    return () => clearInterval(i);
  }, []);
  useEffect(() => { if (!s.screens.length) Music.play('menu'); }, [s.screens.length]);
  // New accounts open their first Recruit Pack before anything else; the daily spin pops up once a visit.
  useEffect(() => {
    if (!p || screenOpen()) return;
    if (!p.team.length && (p.recruit || 0) > 0) {
      openScreen(RecruitView, { locked: true, eyebrow: 'Welcome to HoloSynth', title: 'Open your Recruit Pack',
        subtitle: 'It holds one of three starters. The other two come in Recruit Packs at campaign levels 3 and 6.' });
    } else if (!spinClosed && p.team.length && !p.locked?.spin && p.nextSpin === 0) {
      setSpinClosed(true);
      openScreen(DailySpin, {});
    }
  }, [p, s.screens.length]);
  if (!p) return html`<${Loading} />`;
  const badges = { play: p.quests ? p.quests.list.filter(q => q.n >= q.goal && !q.claimed).length + (p.quests.bonus === 'ready' ? 1 : 0) : 0, social: socialBadge(s.social) };
  const View = TABS.find(t => t.key === tab).view;
  const navItem = (t, cls) => html`<a href="#/${t.key}" class=${cls} aria-current=${tab === t.key ? 'page' : null}>
      <${Icon} name=${t.icon} size="22" /><span class="t">${t.name}</span>
      ${badges[t.key] > 0 && html`<span class="badge" aria-label="${badges[t.key]} waiting">${badges[t.key]}</span>`}
      ${t.key === 'cards' && s.newCards.size > 0 && html`<span class="navdot" aria-label="new cards"></span>`}</a>`;
  const under = s.screens.length > 0;   // a full screen is up: everything behind it can't be focused or clicked
  return html`<div class="shell city">
    <nav class="side" aria-label="Main" inert=${under}>
      <img class="logo" src="/img/logo.png" alt="HoloSynth" /><img class="mark" src="/img/icon.png" alt="HoloSynth" />
      ${TABS.map(t => navItem(t, 'nav'))}
      <a href="#/profile" class="me panel" style="text-decoration: none; color: var(--fg);" aria-label="Your profile">
        <div class="row" style="gap: 10px;"><${Avatar} id=${p.avatar} size="42" />
          <div class="meinfo col" style="gap: 2px; min-width: 0;"><span class="head ellipsis" style="font-size: 16px;">${p.username}</span>
          <span class="label" style="font-size: 12px; letter-spacing: 1.5px;">LV ${p.level}</span></div></div>
        <${Bar} value=${xpInto(p)} max=${xpNeed(p)} />
        <div class="mefoot row tiny muted" style="justify-content: space-between;"><span class="num">${fmt(xpInto(p))} / ${fmt(xpNeed(p))} XP</span>
          <span class="row head" style="gap: 5px; font-size: 15px; color: var(--gold-hi);"><${Coin} />${fmt(p.gold)}</span></div>
      </a>
    </nav>
    <header class="topbar" inert=${under}>
      <div class="col grow" style="gap: 5px;"><span class="head" style="font-size: 17px;">${p.username}</span>
        <div class="row" style="gap: 8px;"><span class="label" style="font-size: 12px; letter-spacing: 1.5px;">LV ${p.level}</span><${Bar} value=${xpInto(p)} max=${xpNeed(p)} style="width: 90px; height: 5px;" /></div></div>
      <span class="chip"><${Coin} />${fmt(p.gold)}</span>
    </header>
    <main class="main" id="main" inert=${under}><${View} /></main>
    <nav class="tabbar" aria-label="Main" inert=${under}>${TABS.map(t => navItem(t, 'tab'))}</nav>
    ${s.screens.map((sc, i) => html`<div class="layer" key=${sc.id} inert=${i < s.screens.length - 1}><${sc.view} ...${sc.props} close=${() => closeScreen(sc.id)} /></div>`)}
    ${s.error && !s.screens.length && html`<${Toast} />`}
  </div>`;
}

// Errors from actions show briefly at the bottom.
function Toast() {
  const s = useStore();
  useEffect(() => { const t = setTimeout(() => set({ error: null }), 4000); return () => clearTimeout(t); }, [s.error]);
  return html`<div class="toast" role="alert">${s.error}</div>`;
}

function App() {
  const s = useStore();
  if (s.authed === null) return html`<${Loading} />`;
  if (!s.authed) return html`<${AuthView} />`;
  if (s.profile && s.profile.email == null) return html`<${AddEmailView} />`;
  if (s.profile && s.profile.agreed === false) return html`<${AgreeView} />`;
  return html`<${Home} />`;
}

(async () => {
  render(html`<${Loading} />`, document.getElementById('app'));
  try { await loadCards(); } catch {}
  await boot();
  render(html`<${App} />`, document.getElementById('app'));
})();
