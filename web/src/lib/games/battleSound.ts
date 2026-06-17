// Tiny synthesized sound engine for Quick Battle — no audio assets, just a few
// oscillator blips (ported from the head-to-head prototype). Everything is
// wrapped so it can never throw and break the loop, and guarded for SSR (the
// AudioContext is only ever touched in the browser, lazily, after a gesture).

type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext }

let ctx: AudioContext | null = null
let muted = false

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (ctx) return ctx
  try {
    const Ctor = window.AudioContext ?? (window as WebkitWindow).webkitAudioContext
    if (!Ctor) return null
    ctx = new Ctor()
  } catch {
    ctx = null
  }
  return ctx
}

/** Call from a user gesture (the first pick / unmute) to unlock audio. */
export function initAudio() {
  const c = getCtx()
  if (c && c.state === 'suspended') c.resume().catch(() => {})
}

export function setMuted(value: boolean) {
  muted = value
}

export function isMuted() {
  return muted
}

function tone(
  freq: number,
  duration: number,
  type: OscillatorType,
  peak: number,
  startOffset = 0,
  endFreq?: number,
) {
  const c = getCtx()
  if (!c || muted) return
  try {
    const now = c.currentTime + startOffset
    const osc = c.createOscillator()
    const gain = c.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(freq, now)
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, now + duration)
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(peak, now + 0.012)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration)
    osc.connect(gain).connect(c.destination)
    osc.start(now)
    osc.stop(now + duration + 0.02)
  } catch {
    /* ignore */
  }
}

/** A percussive, tactile hit when a card gets picked — sharp click + low thump. */
export function playPick() {
  tone(560, 0.07, 'square', 0.1, 0, 220) // sharp transient
  tone(95, 0.18, 'sine', 0.24, 0, 52) // low thump (the impact)
  tone(320, 0.1, 'triangle', 0.12, 0.01, 170)
}

/** Bright, quick ascending arpeggio for the winner. */
export function playWin() {
  const notes = [523.25, 659.25, 783.99, 1046.5] // C5 E5 G5 C6
  notes.forEach((n, i) => tone(n, 0.42, 'triangle', 0.13, 0.04 + i * 0.045))
}

/** Triumphant flourish at a streak milestone — an octave-up power triad. */
export function playMilestone() {
  const notes = [659.25, 987.77, 1318.51] // E5 B5 E6
  notes.forEach((n, i) => tone(n, 0.55, 'triangle', 0.15, i * 0.05))
  tone(110, 0.3, 'sine', 0.18, 0, 70) // low swell underneath
}

/** Airy whoosh as a new challenger steps in. */
export function playWhoosh() {
  tone(680, 0.28, 'sine', 0.07, 0, 220)
}
