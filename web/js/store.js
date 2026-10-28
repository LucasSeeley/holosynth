// Shared state and the server calls (GameStore in the app). The session lives in an HttpOnly cookie the page can't read.
import { useState, useEffect } from './vendor/preact-htm.js';

export const state = {
  authed: null,         // null: checking, false: logged out, true: logged in
  profile: null,
  social: null,
  error: null,
  newCards: new Set(),  // cards you got and haven't looked at yet (NEW tag)
  screens: [],          // full screens open on top of the tabs, last on top: { id, view, props }
};
const subs = new Set();
export function set(patch) {
  Object.assign(state, patch);
  if ('profile' in patch) trackNew();
  subs.forEach(f => f());
}
// Re-render the calling component whenever the state changes.
export function useStore() {
  const [, force] = useState(0);
  useEffect(() => { const f = () => force(n => n + 1); subs.add(f); return () => subs.delete(f); }, []);
  return state;
}

export class ApiError extends Error {}
// GET when there's no body, POST with JSON otherwise. Errors carry the server's message, as in the app.
export async function api(path, body) {
  let res;
  try {
    res = await fetch('/' + path, body === undefined ? { credentials: 'same-origin' }
      : { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch { throw new ApiError("Can't reach the server. Check your connection."); }
  let data, parsed = true;
  try { data = await res.json(); } catch { parsed = false; }
  if (!res.ok) {
    if (res.status === 401 && !['login', 'signup', 'me/delete', 'me/email'].includes(path)) set({ authed: false, profile: null, social: null, screens: [] });
    throw new ApiError((parsed && data?.error) || `Something went wrong (${res.status}).`);
  }
  if (!parsed) throw new ApiError('Unexpected reply from the server.');   // a JSON null is a real answer ("nothing open")
  return data;
}

// Wakes the connection before a move needs it (the first request after idle otherwise pays to get going).
let lastWarm = 0;
export function warm() {
  if (Date.now() - lastWarm < 10000) return;
  lastWarm = Date.now();
  fetch('/cards.json', { cache: 'no-store' }).catch(() => {});   // no database work on the server
}

// localStorage can be off (private windows): every use is guarded.
export const local = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

// NEW tags: any card that shows up in the collection for the first time. Kept per account in this browser.
function trackNew() {
  const p = state.profile;
  if (!p || !p.team?.length) return;
  const seenKey = 'seen.' + p.username, newKey = 'new.' + p.username;
  const owned = Object.keys(p.collection);
  const seen = local.get(seenKey);
  const fresh = new Set(local.get(newKey, []));
  if (seen) owned.filter(id => !seen.includes(id)).forEach(id => fresh.add(id));   // first visit: nothing is new
  local.set(seenKey, owned);
  local.set(newKey, [...fresh]);
  state.newCards = fresh;
}
export function seenCard(id) {
  if (!state.newCards.has(id)) return;
  state.newCards.delete(id);
  local.set('new.' + state.profile.username, [...state.newCards]);
  set({});
}

// ---- actions (same as GameStore) ----
const fail = e => { set({ error: e.message }); return null; };

export async function boot() {
  try { set({ profile: await api('me'), authed: true }); }
  catch { if (state.authed === null) set({ authed: false }); }
}
export async function auth(username, email, password, newAccount) {
  const body = { username: username.trim(), password };
  if (newAccount) { body.email = email.trim(); body.agree = true; }   // the form only submits once both boxes are ticked
  try { const r = await api(newAccount ? 'signup' : 'login', body); set({ profile: r.profile, authed: true, error: null }); }
  catch (e) { fail(e); }
}
export async function refresh() {
  try { set({ profile: await api('me') }); } catch (e) { if (state.authed) fail(e); }
}
export async function setEmail(email, password) {
  try { set({ profile: await api('me/email', { email: email.trim(), password }) }); return null; }
  catch (e) { return e.message; }
}
export async function logout() {
  try { await api('logout', {}); } catch {}
  set({ authed: false, profile: null, social: null, screens: [], error: null });
}
export async function loadSocial() {
  try { set({ social: await api('social') }); } catch {}
}
// Friend and trade actions: returns the server's message, or throws its error.
export async function socialAction(path, body) {
  const r = await api(path, body);
  set({ social: r.social });
  if (path.startsWith('trades')) await refresh();   // offered cards and gold are held, so the collection changed
  return r.message ?? null;
}
export async function setAvatar(id) { try { set({ profile: await api('avatar', { card: id }) }); } catch (e) { fail(e); } }
export async function buyPack(type) {
  try { const r = await api('packs', { type }); set({ profile: r.profile }); return r; } catch (e) { return fail(e); }
}
// Opens your oldest unopened pack of `type`.
export async function openPack(type) {
  try { const r = await api('packs/open', { type }); set({ profile: r.profile, error: null }); return r; }
  catch (e) { fail(e); await refresh(); return null; }
}
export async function buyShopCard(slot, id) {
  try { const r = await api('shop', { slot, card: id }); set({ profile: r.profile, error: null }); return true; }
  catch (e) { fail(e); await refresh(); return false; }   // e.g. the shop changed at midnight
}
// Opens the next Recruit Pack; returns the starter that came out.
export async function openRecruit() {
  try { const r = await api('recruit', {}); set({ profile: r.profile, error: null }); return r.card; } catch (e) { return fail(e); }
}
export async function claimMainQuest() {
  try { const r = await api('mainquest/claim', {}); set({ profile: r.profile, error: null }); } catch (e) { fail(e); }
}
export async function setPowerTeam(ids) { try { set({ profile: await api('powers/team', { powers: ids }), error: null }); } catch (e) { fail(e); } }
export async function setTeam(ids) { try { set({ profile: await api('team', { team: ids }) }); } catch (e) { fail(e); } }

// Switch tabs (Play, Shop, Cards, Social, Profile).
export const goTab = key => { location.hash = '#/' + key; };

// ---- full screens (fullScreenCover in the app) ----
// open(view, props): view is a component taking ({ close, ...props }). The browser's back button closes the top one.
let nextId = 1;
export function openScreen(view, props = {}) {
  const id = nextId++;
  set({ screens: [...state.screens, { id, view, props }] });
  try { history.pushState({ screen: id }, ''); } catch {}
  return id;
}
// Closes the top screen (or the one with `id`). Goes back in history if that screen added an entry.
export function closeScreen(id) {
  const top = state.screens[state.screens.length - 1];
  if (!top || (id && top.id !== id)) { set({ screens: state.screens.filter(s => s.id !== id) }); return; }
  set({ screens: state.screens.slice(0, -1) });
  if (history.state?.screen === top.id) { ignorePop = true; history.back(); }
}
// Swap the top screen for another (campaign battle → recruit pack) without touching history.
export function replaceScreen(view, props = {}) {
  const top = state.screens[state.screens.length - 1];
  if (!top) return openScreen(view, props);
  set({ screens: [...state.screens.slice(0, -1), { id: top.id, view, props }] });
  return top.id;
}
export const screenOpen = () => state.screens.length > 0;
let ignorePop = false;
addEventListener('popstate', () => {
  if (ignorePop) { ignorePop = false; return; }
  const top = state.screens[state.screens.length - 1];
  if (top && !top.props.locked) set({ screens: state.screens.slice(0, -1) });
  else if (top) { try { history.pushState({ screen: top.id }, ''); } catch {} }   // mid-battle: back does nothing
});
