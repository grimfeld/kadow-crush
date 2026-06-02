// Tiny WebAudio synth — no audio files. Each game event is a short procedurally
// generated tone (or arpeggio). Lazily creates the AudioContext on first sound
// so it unlocks after the first user gesture (mobile autoplay policy).

export type SoundName =
  | "swap"
  | "invalid"
  | "clear"
  | "special"
  | "striped"
  | "wrapped"
  | "bomb"
  | "fish"
  | "fall"
  | "win"
  | "lose";

let ctx: AudioContext | null = null;

function ac(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/** One enveloped oscillator note. */
function note(
  c: AudioContext,
  freq: number,
  start: number,
  dur: number,
  type: OscillatorType,
  gain: number,
) {
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  g.gain.setValueAtTime(0, start);
  g.gain.linearRampToValueAtTime(gain, start + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(g).connect(c.destination);
  osc.start(start);
  osc.stop(start + dur + 0.02);
}

export function playSound(name: SoundName) {
  const c = ac();
  if (!c) return;
  const t = c.currentTime;
  switch (name) {
    case "swap":
      note(c, 440, t, 0.09, "triangle", 0.18);
      break;
    case "invalid":
      note(c, 180, t, 0.16, "sawtooth", 0.15);
      note(c, 140, t + 0.08, 0.16, "sawtooth", 0.13);
      break;
    case "clear":
      // bright two-note blip
      note(c, 660, t, 0.1, "square", 0.16);
      note(c, 880, t + 0.05, 0.12, "square", 0.14);
      break;
    case "special":
      // rising arpeggio
      [523, 659, 784, 1047].forEach((f, i) =>
        note(c, f, t + i * 0.05, 0.16, "square", 0.16),
      );
      break;
    case "striped":
      // a quick laser sweep — descending sawtooth zip
      note(c, 1200, t, 0.06, "sawtooth", 0.16);
      note(c, 700, t + 0.05, 0.1, "sawtooth", 0.14);
      break;
    case "wrapped":
      // a punchy double thud (the 3x3 burst)
      note(c, 160, t, 0.16, "sine", 0.22);
      note(c, 120, t + 0.12, 0.2, "sine", 0.2);
      note(c, 420, t, 0.1, "square", 0.1);
      break;
    case "bomb":
      // a big detonation: low boom + bright shimmer spray
      note(c, 90, t, 0.4, "sine", 0.28);
      [880, 1320, 1760, 2200].forEach((f, i) =>
        note(c, f, t + i * 0.03, 0.18, "square", 0.08),
      );
      break;
    case "fish":
      // a watery blip-up
      note(c, 520, t, 0.08, "sine", 0.16);
      note(c, 900, t + 0.06, 0.12, "sine", 0.14);
      break;
    case "fall":
      note(c, 300, t, 0.12, "sine", 0.1);
      break;
    case "win": {
      // Triumphant fanfare: a rising melody, a sustained major chord underneath,
      // and a sparkle arpeggio on top — bigger and brighter than a single run.
      const melody = [523, 659, 784, 1047, 1319, 1568];
      melody.forEach((f, i) =>
        note(c, f, t + i * 0.09, 0.34, "triangle", 0.2),
      );
      // C-major chord swell that lands as the melody peaks
      [523, 659, 784, 1047].forEach((f) =>
        note(c, f, t + 0.45, 0.7, "sine", 0.12),
      );
      // high sparkle cascade
      [1568, 1976, 2349, 2637].forEach((f, i) =>
        note(c, f, t + 0.55 + i * 0.06, 0.25, "square", 0.07),
      );
      break;
    }
    case "lose":
      [400, 320, 250, 180].forEach((f, i) =>
        note(c, f, t + i * 0.13, 0.3, "sawtooth", 0.18),
      );
      break;
  }
}
