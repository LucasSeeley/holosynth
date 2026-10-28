// Battle a friend (FriendBattleView): create a match and share its code, or type a friend's code to join.
// Opened with `friend` it sends that friend a challenge first; with `join` ({ id, code }) it accepts theirs.
import { html, useState, useEffect, useRef } from '../vendor/preact-htm.js';
import { battleFusion } from '../cards.js';
import { api, useStore, refresh, loadSocial } from '../store.js';
import { Icon, Card } from '../ui.js';
import { BattleBoard, ResultCard, apiOrNull, focusOnce } from './battle.js';

export function FriendBattle({ close, friend, join }) {
  const s = useStore(), p = s.profile;
  const [match, setMatch] = useState(null), [loaded, setLoaded] = useState(false);
  const [code, setCode] = useState(''), [busy, setBusy] = useState(false), [err, setErr] = useState(null);
  const [settled, setSettled] = useState(true), [copied, setCopied] = useState(false);
  const live = useRef(null); live.current = match;
  const run = async work => {
    setBusy(true);
    try { await work(); setErr(null); } catch (e) { setErr(e.message); }
    setBusy(false);
  };
  useEffect(() => {
    (async () => {
      if (friend) await run(async () => setMatch(await api('friends/challenge', { name: friend })));
      else if (join) await run(async () => setMatch(await api('matches/join', { code: join.code })));
      else await run(async () => setMatch(await apiOrNull('matches/current')));
      setLoaded(true);
    })();
    return () => loadSocial();
  }, []);
  // While a match is open, check for the other player's moves every 2 seconds.
  useEffect(() => {
    if (!match) return;
    const i = setInterval(async () => {
      const m = live.current;
      if (!m || m.status === 'done' || (m.state?.turn === m.you && m.status !== 'waiting')) return;
      try {
        const fresh = await api(`matches/${m.id}`);
        if (JSON.stringify(fresh) === JSON.stringify(live.current)) return;
        if (JSON.stringify(fresh.state) !== JSON.stringify(m.state)) setSettled(false);   // their move plays out before any result shows
        setMatch(fresh);
        if (fresh.state?.winner != null) refresh();
      } catch {}
    }, 2000);
    return () => clearInterval(i);
  }, [match?.id]);
  // Escape closes the lobby, like the other screens (the board and the waiting screen have their own way out)
  const inLobby = loaded && !match;
  useEffect(() => {
    if (!inLobby) return;
    const k = e => { if (e.key === 'Escape' && !document.querySelector('.modal')) close(); };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [inLobby]);
  const leave = async () => {
    const m = live.current;
    if (!m) return;
    await run(async () => { await api(`matches/${m.id}/leave`, {}); setMatch(null); });
    refresh();
  };

  if (!loaded) return html`<div class="screen city center" tabindex="-1" ref=${focusOnce}><div class="spinner"></div></div>`;
  if (match && match.status !== 'waiting' && match.state) {
    const m = match, st = m.state, foe = m.players[1 - m.you] ?? 'Opponent';
    const onMove = async (from, move, to) => {
      setSettled(false);
      try {
        const next = await api(`matches/${m.id}/move`, { from, move, to });
        setMatch(next);
        if (next.state?.winner != null) refresh();
      } catch (e) {
        try { setMatch(await api(`matches/${m.id}`)); } catch {}   // out of step with the server: load the real match
        setSettled(true); throw e;
      }
    };
    return html`<div class="screen city" role="dialog" aria-modal="true" tabindex="-1" ref=${focusOnce} aria-label="Friend battle">
      <${BattleBoard} state=${st} you=${m.you} eyebrow="Friend battle" title="vs ${foe}" foeName=${foe}
        leaveLabel="Forfeit" leaveQuestion="Forfeit this match? Your opponent wins." onMove=${onMove} onLeave=${leave} onSettled=${() => setSettled(true)} />
      ${st.winner != null && settled && html`<${ResultCard} won=${st.winner === m.you}>
        <p>${st.winner === m.you ? '+50 gold  ·  +25 XP' : 'Better luck next time.'}</p>
        <button class="btn gold big wide" onClick=${() => { setMatch(null); refresh(); }}>Back</button>
      </${ResultCard}>`}
    </div>`;
  }
  const errText = err && html`<p class="err" role="alert" style="text-align: center; margin: 0;">${err}</p>`;
  if (match) {   // waiting for the other player
    const share = async () => {
      const text = `Battle me in HoloSynth! Code: ${match.code}`;
      try { if (navigator.share) { await navigator.share({ text }); return; } } catch { return; }
      try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {}
    };
    return html`<div class="screen city" role="dialog" aria-modal="true" tabindex="-1" ref=${focusOnce} aria-label="Friend battle"><div class="scroll center">
      <div class="narrow col fb-wait">
        ${match.invitee ? html`
          <span class="label">Challenge sent</span>
          <b class="head ellipsis" style="font-size: 36px;">${match.invitee}</b>
          <div class="spinner" style="align-self: center;"></div>
          <p class="small muted">Waiting for ${match.invitee} to accept…</p>`
        : html`
          <span class="label">Send this code to a friend</span>
          <span class="fb-code panel lit">${match.code}</span>
          <button class="btn gold" style="align-self: center; width: 220px;" onClick=${share}>${copied ? 'Copied!' : 'Share code'}</button>
          <div class="spinner" style="align-self: center;"></div>
          <p class="small muted">Waiting for them to join…</p>`}
        <button class="btn out" style="align-self: center; color: var(--pink); border-color: rgba(255,63,164,.5);" disabled=${busy} onClick=${leave}>Cancel</button>
        ${errText}
      </div></div></div>`;
  }
  // lobby
  return html`<div class="screen city" role="dialog" aria-modal="true" tabindex="-1" ref=${focusOnce} aria-label="Battle a friend">
    <div class="screenhead"><button class="close" onClick=${close} aria-label="Back"><${Icon} name="left" /></button><span class="h2">Battle a friend</span></div>
    <div class="scroll"><div class="narrow col fb-lobby">
      <span class="label" style="text-align: center;">Your team</span>
      <div class="fb-team">${(p?.team || []).map(id => html`<${Card} id=${id} fusion=${battleFusion(p, id)} />`)}</div>
      <p class="small muted" style="text-align: center; margin: 0;">Change it in Cards</p>
      <button class="btn gold big wide" disabled=${busy} onClick=${() => run(async () => setMatch(await api('matches', {})))}>Create a match</button>
      <div class="fb-or"><i></i><span class="small muted">or join a friend's match</span><i></i></div>
      <form class="row" style="gap: 10px;" onSubmit=${e => { e.preventDefault(); if (code.trim().length >= 5) run(async () => setMatch(await api('matches/join', { code }))); }}>
        <label class="inputrow grow"><span class="head" style="color: var(--brass);">#</span><span class="sr">Friend's code</span>
          <input placeholder="Friend's code" value=${code} autocapitalize="characters" autocomplete="off" spellcheck="false"
            style="font: 600 17px var(--head); text-transform: uppercase;" onInput=${e => setCode(e.target.value)} /></label>
        <button class="btn out" style="height: 54px;" disabled=${busy || code.trim().length < 5}>Join</button>
      </form>
      ${errText}
    </div></div>
  </div>`;
}
