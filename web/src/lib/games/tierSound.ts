// Tiny zero-asset Web Audio synth for tactile UI feedback in the Tier List.
// The AudioContext is created lazily on the first call — which always happens
// inside a user gesture (a placement tap/drag or the submit click) — so nothing
// ever autoplays and we don't trip browser autoplay policies.

let ctx: AudioContext | null = null
let enabled = true

// Caller (the Builder) flips this from its mute toggle; every play fn no-ops
// when sound is off, so call sites stay clean.
export function setSoundEnabled(on: boolean) {
  enabled = on
}

function audio(): AudioContext | null {
  if (!enabled || typeof window === 'undefined') return null
  if (!ctx) {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext
    if (!Ctor) return null
    try {
      ctx = new Ctor()
    } catch {
      return null
    }
  }
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

// One short enveloped tone. Attack is near-instant, decay is exponential, so
// every blip reads as a soft "snap" rather than a beep.
function blip(
  freq: number,
  delay: number,
  dur: number,
  gain: number,
  type: OscillatorType = 'sine',
) {
  const a = audio()
  if (!a) return
  const t = a.currentTime + delay
  const osc = a.createOscillator()
  const g = a.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t)
  g.gain.setValueAtTime(0.0001, t)
  g.gain.linearRampToValueAtTime(gain, t + 0.006)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  osc.connect(g).connect(a.destination)
  osc.start(t)
  osc.stop(t + dur + 0.02)
}

// Pitch rises with tier quality — dropping into S is the brightest, most
// satisfying snap; D is a low, grounded thud. A faint fifth above adds shimmer.
const TIER_FREQ: Record<string, number> = {
  S: 880,
  A: 740,
  B: 622,
  C: 523,
  D: 440,
}

export function playPlace(tier: string) {
  const base = TIER_FREQ[tier] ?? 600
  blip(base, 0, 0.13, 0.09, 'triangle')
  blip(base * 1.5, 0.018, 0.09, 0.035, 'sine')
}

// Sending a skin back to the tray — softer and lower than a placement.
export function playPop() {
  blip(330, 0, 0.08, 0.045, 'sine')
}

// The reward: an ascending C-major arpeggio to land with the confetti.
export function playSubmit() {
  const notes = [523.25, 659.25, 783.99, 1046.5] // C5 E5 G5 C6
  notes.forEach((f, i) => blip(f, i * 0.075, 0.26, 0.08, 'triangle'))
  blip(1567.98, 0.3, 0.4, 0.03, 'sine') // a high G shimmer to ring out
}
