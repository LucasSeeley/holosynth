// The once-a-day prize wheel (DailySpinView). The server picks the prize; the wheel spins to land on it.
import { html, useState, useEffect } from '../vendor/preact-htm.js';
import { useStore, api, set, refresh } from '../store.js';
import { Icon, PackImg, useNow, clock, sleep } from '../ui.js';
import { Sound } from '../sound.js';

// must match SPIN_SLOTS in server/src/game.js (clockwise from the top)
export const SLOTS = [['gold', 100], ['xp', 100], ['gold', 250], ['pack', 1], ['xp', 100], ['gold', 500], ['xp', 250], ['gold', 100], ['xp', 500]];
const STEP = 360 / SLOTS.length;
const FG = { gold: '#E8B85A', xp: '#3FF0FF', pack: '#FF4D5E' }, BG = { gold: '#3A2A0E', xp: '#0D2A33', pack: '#3A0A14' };

// SpinClock: ready when the reset time (ms since 1970) has passed; "05:12:48" until then
export const spinReady = ms => ms <= Date.now();
export const spinLeft = ms => clock(ms);

// one slice of a circle of radius r at (r, r), pointing up
function slicePath(r, inset = 0) {
  const rr = r - inset, a0 = (-90 - STEP / 2) * Math.PI / 180, a1 = (-90 + STEP / 2) * Math.PI / 180;
  return `M${r},${r} L${r + rr * Math.cos(a0)},${r + rr * Math.sin(a0)} A${rr},${rr} 0 0 1 ${r + rr * Math.cos(a1)},${r + rr * Math.sin(a1)} Z`;
}

// Little wheel icon for the Play tile: coloured slices when ready, dim when used.
export function MiniWheel({ lit, size = 36 }) {
  const r = 50;
  return html`<svg width=${size} height=${size} viewBox="0 0 100 100" aria-hidden="true" style=${lit ? 'filter: drop-shadow(0 0 5px rgba(232,184,90,.5))' : ''}>
    <circle cx="50" cy="50" r="50" fill="#0B0A14" />
    ${SLOTS.map(([k], i) => html`<path d=${slicePath(r, 7)} fill=${(lit ? FG : BG)[k]} stroke="#07060C" stroke-width="3" transform="rotate(${i * STEP} 50 50)" />`)}
    <circle cx="50" cy="50" r="48" fill="none" stroke="#E8B85A" stroke-width="3" />
    <circle cx="50" cy="50" r="13" fill="#E8B85A" stroke="#07060C" stroke-width="3" />
  </svg>`;
}

function Wheel({ size, angle, spinning, landedSlot, pack }) {
  const r = size / 2;
  return html`<div class="wheel" style="width: ${size}px; height: ${size}px;" role="img" aria-label="Prize wheel: gold, XP and a free pack">
    <svg width=${size} height=${size} viewBox="0 0 ${size} ${size}">
      <circle cx=${r} cy=${r} r=${r} fill="#0B0A14" />
      <g style="transform-origin: 50% 50%; transform: rotate(${angle}deg); transition: ${spinning ? 'transform 4.2s cubic-bezier(.12,.7,.1,1)' : 'none'};">
        ${SLOTS.map(([k, amt], i) => {
          const lit = landedSlot === i, ink = lit ? '#1A0D05' : FG[k];
          return html`<g transform="rotate(${i * STEP} ${r} ${r})">
            <path d=${slicePath(r, size * 0.045)} fill=${lit ? FG[k] : BG[k]} stroke="#07060C" stroke-width="3" />
            ${k === 'pack'
              ? html`<image href=${pack === 'cyber' ? '/img/pack.webp' : `/img/pack_${pack}.webp`} x=${r - size * 0.06} y=${size * 0.1} height=${size * 0.19} width=${size * 0.12} />`
              : html`<text x=${r} y=${size * 0.2} text-anchor="middle" fill=${ink} style="font: 700 ${size * 0.075}px var(--head);">${amt}</text>
                <text x=${r} y=${size * 0.26} text-anchor="middle" fill=${ink} style="font: 600 ${size * 0.042}px var(--head); letter-spacing: 2px;">${k === 'gold' ? '●' : 'XP'}</text>`}
          </g>`;
        })}
      </g>
      ${SLOTS.map((_, i) => html`<circle cx=${r} cy=${r - size * 0.456} r=${size * 0.0125} fill="#FFD77A" transform="rotate(${(i - 0.5) * STEP} ${r} ${r})" />`)}
      <circle cx=${r} cy=${r} r=${r - 1.5} fill="none" stroke="#E8B85A" stroke-width="3" />
      <circle cx=${r} cy=${r} r=${size * 0.105} fill="url(#hub)" stroke="#07060C" stroke-width="4" />
      <text x=${r} y=${r + size * 0.016} text-anchor="middle" fill="#1A0D05" style="font: 700 ${size * 0.047}px var(--head); letter-spacing: 1.5px;">SPIN</text>
      <defs><linearGradient id="hub" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFD77A" /><stop offset="1" stop-color="#E0A12A" /></linearGradient></defs>
    </svg>
    <svg class="pointer" width="30" height="36" viewBox="0 0 30 36" aria-hidden="true"><path d="M15 35 L2.4 13 A14 14 0 1 1 27.6 13 Z" fill="#FF4D5E" stroke="#07060C" stroke-width="3" /></svg>
  </div>`;
}

export function DailySpin({ close }) {
  const s = useStore();
  const [angle, setAngle] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [reply, setReply] = useState(null);
  const [landed, setLanded] = useState(false);
  const [error, setError] = useState(null);
  useNow(1000);
  useEffect(() => { refresh(); }, []);   // today's wheel pack, in case the page was left open past midnight
  const done = () => { if (reply) set({ profile: reply.profile }); close(); };
  useEffect(() => {
    const k = e => { if (e.key === 'Escape' && !spinning) done(); };
    addEventListener('keydown', k); return () => removeEventListener('keydown', k);
  });

  const spin = async () => {
    setSpinning(true); setError(null);
    Sound.play('move');
    try {
      const r = await api('spin', {});
      setReply(r);
      // land the won slot under the pointer after 5 full turns, a little off-centre so it looks natural
      setAngle(360 * 5 - r.slot * STEP + (Math.random() * 26 - 13));
      await sleep(4300);
      Sound.play(r.kind === 'pack' ? 'legendary' : 'rare');
      setLanded(true);
    } catch (e) { setError(e.message); }
    setSpinning(false);
  };

  const size = Math.min(300, innerWidth - 80);
  let body;
  if (landed && reply) {
    const pack = reply.kind === 'pack', gold = reply.kind === 'gold';
    const color = pack ? '#FF7884' : gold ? '#FFD77A' : '#3FF0FF';
    body = html`
      <h2 class="spinprize" style="color: ${color}; text-shadow: 0 0 12px ${color}99;">${pack ? 'Free pack!' : gold ? `${reply.amount} gold!` : `${reply.amount} XP!`}</h2>
      <div class="prizeart" aria-hidden="true">
        ${pack ? html`<${PackImg} type=${reply.packType || 'cyber'} height="250" style="transform: rotate(-4deg); filter: drop-shadow(0 14px 20px rgba(158,16,36,.8));" />`
          : gold ? html`<div class="goldhex"><${Icon} name="coin" size="160" /></div>`
          : html`<div class="xpball">XP</div>`}
      </div>
      <p class="soft small" style="margin: 0;">${pack ? 'Jackpot! Open it from the Play tab.' : gold ? 'Added to your gold.' : 'Added to your level.'}</p>
      <button class="btn gold big wide" onClick=${done}>Collect</button>
      <span class="small muted num">Next spin in ${clock(reply.profile.nextSpin)}</span>`;
  } else {
    body = html`
      <h2 class="h1" style="font-size: 26px; margin-top: -6px;">Spin to win</h2>
      <${Wheel} size=${size} angle=${angle} spinning=${spinning} landedSlot=${landed ? reply?.slot : -1} pack=${s.profile?.spinPack || 'cyber'} />
      <p class=${error ? 'err' : 'soft small'} style="margin: 0; text-align: center;">${error || 'Gold, XP or a free pack. One spin every day.'}</p>
      <button class="btn gold big wide" disabled=${spinning} onClick=${spin}>Spin</button>`;
  }
  return html`<div class="screen city spinscreen" role="dialog" aria-modal="true" aria-label="Daily spin">
    <div class="spinbox">
      <button class="close spinx" onClick=${done} disabled=${spinning} aria-label="Close"><${Icon} name="x" /></button>
      <span class="label">Daily spin</span>
      ${body}
    </div>
  </div>`;
}
