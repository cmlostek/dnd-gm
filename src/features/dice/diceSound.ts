/**
 * Dice clatter, synthesized.
 *
 * Deliberately not a sound file: a decent dice sample is 30–100 KB of binary
 * in the bundle, and the app already ships 3.6 MB of SRD JSON. Short bursts of
 * bandpass-filtered noise read convincingly as dice on a table and cost
 * nothing to download.
 *
 * The AudioContext is created lazily on first play — every roll originates
 * from a click, so the browser's user-gesture requirement is already satisfied
 * by the time we get here.
 */

let ctx: AudioContext | null = null;

function audioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  // Autoplay policies can leave a context suspended after a tab regains focus.
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/** One die-on-wood tick: a filtered noise burst with a very fast decay. */
function tick(ac: AudioContext, at: number, gain: number, freq: number) {
  const dur = 0.05;
  const frames = Math.max(1, Math.floor(ac.sampleRate * dur));
  const buffer = ac.createBuffer(1, frames, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) {
    // White noise shaped by a steep exponential decay — the decay is what
    // makes it read as a hard tick rather than a hiss.
    data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / frames, 8);
  }

  const src = ac.createBufferSource();
  src.buffer = buffer;

  const band = ac.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = freq;
  band.Q.value = 1.2;

  const vol = ac.createGain();
  vol.gain.value = gain;

  src.connect(band).connect(vol).connect(ac.destination);
  src.start(at);
  src.stop(at + dur);
}

/**
 * Play a short tumble of ticks. `intensity` scales count and loudness so a
 * fistful of d6s sounds busier than a single d20.
 */
export function playDiceRoll(intensity = 1) {
  const ac = audioContext();
  if (!ac) return;

  const now = ac.currentTime;
  const count = Math.min(7, 3 + Math.round(intensity));

  for (let i = 0; i < count; i++) {
    // Ticks accelerate then stop, like dice losing momentum.
    const t = now + Math.pow(i / count, 1.6) * 0.28 + Math.random() * 0.015;
    tick(ac, t, 0.16 - i * 0.012, 900 + Math.random() * 1600);
  }
  // Final settle: lower and softer, the die coming to rest.
  tick(ac, now + 0.33, 0.09, 520);
}
