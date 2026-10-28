// Sound effects and music (Sound / Music / Rip in the app), through Web Audio so loops are gapless.
// Browsers only allow audio after the first click or key press, so everything waits for that.
import { local } from './store.js';

export const prefs = {
  get music() { return local.get('music', true); },
  get effects() { return local.get('effects', true); },
};
let ctx = null, unlocked = false;
const buffers = {}, loading = {};
const DURATION = {};

function context() {
  if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; } }
  return ctx;
}
function load(name) {
  if (buffers[name] || loading[name] || !context()) return loading[name];
  loading[name] = fetch(`/snd/${name}.wav`).then(r => r.arrayBuffer()).then(b => ctx.decodeAudioData(b))
    .then(buf => { buffers[name] = buf; DURATION[name] = buf.duration; return buf; }).catch(() => null);
  return loading[name];
}
const EFFECTS = ['select', 'move', 'hit', 'crit', 'ko', 'turn', 'victory', 'defeat', 'tear', 'flip', 'rare', 'legendary', 'heal', 'dodge', 'deflect'];

function unlock() {
  if (unlocked || (navigator.userActivation && !navigator.userActivation.isActive) || !context()) return;   // Escape isn't a "gesture"
  unlocked = true;
  ctx.resume?.();
  EFFECTS.forEach(load);
  if (Music.current) Music.start(Music.current);
}
addEventListener('pointerdown', unlock, { capture: true });
addEventListener('keydown', unlock, { capture: true });

// One effect at a time: a new one stops whatever is still ringing.
let playing = null;
export const Sound = {
  duration: name => DURATION[name] ?? 0.3,
  play(name) {
    if (!prefs.effects || !unlocked || !buffers[name]) return;
    try { playing?.stop(); } catch {}
    const src = ctx.createBufferSource();
    src.buffer = buffers[name];
    src.connect(ctx.destination);
    src.start();
    playing = src;
  },
};

// Calm loop in the menus, intense loop in battles.
const VOLUME = { menu: 0.5, battle: 0.6 };
export const Music = {
  current: null, node: null, gain: null,
  play(track) {
    if (track === this.current) return;
    this.current = track;
    this.fadeOut();
    this.start(track);
  },
  async start(track) {
    if (!prefs.music || !unlocked) return;
    const buf = await load(track);
    if (!buf || this.current !== track || this.node) return;
    const gain = ctx.createGain();
    gain.gain.value = VOLUME[track];
    const src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    src.connect(gain).connect(ctx.destination);
    src.start();
    this.node = src; this.gain = gain;
  },
  fadeOut() {
    const { node, gain } = this;
    this.node = null; this.gain = null;
    if (!node) return;
    try { gain.gain.setTargetAtTime(0, ctx.currentTime, 0.25); node.stop(ctx.currentTime + 0.85); } catch {}
  },
  stop() { this.current = null; this.fadeOut(); },
  setEnabled(on) {
    local.set('music', on);
    if (on && this.current) this.start(this.current); else if (!on) this.fadeOut();
  },
};
export function setEffects(on) { local.set('effects', on); }

// The pack rip: loops while the pointer drags across the pack, quiet when it stops.
let rip = null, ripGain = null, lastMove = 0;
export const Rip = {
  async scratch(speed) {
    if (!prefs.effects || !unlocked) return;
    lastMove = performance.now();
    if (!rip) {
      const buf = await load('rip');
      if (!buf || rip) return;
      ripGain = ctx.createGain(); ripGain.gain.value = 0;
      rip = ctx.createBufferSource(); rip.buffer = buf; rip.loop = true;
      rip.connect(ripGain).connect(ctx.destination); rip.start();
    }
    ripGain.gain.setTargetAtTime(0.35 + 0.65 * Math.min(1, speed), ctx.currentTime, 0.015);
    setTimeout(() => { if (ripGain && performance.now() - lastMove >= 110) ripGain.gain.setTargetAtTime(0, ctx.currentTime, 0.02); }, 120);
  },
  end() {
    if (!rip) return;
    const r = rip; rip = null;
    try { ripGain.gain.setTargetAtTime(0, ctx.currentTime, 0.02); r.stop(ctx.currentTime + 0.08); } catch {}
  },
};
