/**
 * The counter click.
 *
 * A mechanical counter makes a noise when you press it, and that noise is the
 * point: it tells you the press registered without taking your eyes off the
 * needles. Long-distance knitters rely on it, and a silent button gives nothing
 * back.
 *
 * It is synthesised rather than played from a file: no binary in the
 * installer, nobody else's recording, and no latency. A few to choose from,
 * each a few milliseconds of shaped noise or tone -- short, because a click
 * that rings becomes grating after an evening of counting. Counting down
 * plays each a little lower, so a correction sounds like one.
 */

export type ClickSound = "clicker" | "soft" | "wood" | "tick";

/** The sounds offered, in order: the first is the one a new install has. */
export const CLICK_SOUNDS: { key: ClickSound; label: string }[] = [
  { key: "clicker", label: "Clicker" },
  { key: "soft", label: "Soft tap" },
  { key: "wood", label: "Wood block" },
  { key: "tick", label: "Tick" },
];

/**
 * Rapid presses are throttled to this, so holding a key down does not turn the
 * click into a buzz. A mechanical counter cannot be pressed faster than a
 * finger moves, and neither should this sound.
 */
const MIN_GAP_MS = 35;

const MUTE_KEY = "shiny.knitting.counterSound";
const SOUND_KEY = "shiny.knitting.counterSoundKind";

let context: AudioContext | null = null;
let lastPlayed = 0;

/**
 * Whether the click is on, and which it is: preferences rather than pattern
 * data, so they live in local storage and apply everywhere. Read once and
 * cached, as they are consulted on every press.
 */
let muted = read(MUTE_KEY) === "off";
let sound: ClickSound = CLICK_SOUNDS.some((s) => s.key === read(SOUND_KEY)) ? (read(SOUND_KEY) as ClickSound) : "clicker";

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    // Storage can be unavailable, which is not a reason to fail a count.
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // A count must not fail because a preference could not be saved.
  }
}

/** Turns the click on or off, and remembers the choice. */
export function setClickMuted(value: boolean): void {
  muted = value;
  write(MUTE_KEY, value ? "off" : "on");
}

export function isClickMuted(): boolean {
  return muted;
}

export function clickSound(): ClickSound {
  return sound;
}

/** Chooses the sound, and remembers it. */
export function setClickSound(value: ClickSound): void {
  if (!CLICK_SOUNDS.some((s) => s.key === value)) return;
  sound = value;
  write(SOUND_KEY, value);
}

/**
 * Plays the click, if it is on and not too soon after the last one; `down`
 * a little lower, for a row taken back.
 *
 * Safe to call on every count: a browser that will not give us an audio
 * context, or a user who has muted it, simply produces nothing.
 */
export function playClick(down = false): void {
  if (muted) return;
  const now = performance.now();
  if (now - lastPlayed < MIN_GAP_MS) return;
  lastPlayed = now;
  try {
    const ctx = audioContext();
    if (!ctx) return;
    // Autoplay policy suspends the context until a gesture; the first click is
    // itself a gesture, so this is the moment it becomes usable.
    if (ctx.state === "suspended") void ctx.resume();
    SOUNDS[sound](ctx, down);
  } catch {
    // No audio available. A silent counter still counts.
  }
}

/** A burst of noise fading to nothing over `ms`: the snap of a mechanism. */
function noise(ctx: AudioContext, ms: number): AudioBufferSourceNode {
  const buf = ctx.createBuffer(1, Math.ceil((ctx.sampleRate * ms) / 1000), ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  return src;
}

/** A gain falling from `peak` to silence over `ms`, from now. */
function fade(ctx: AudioContext, peak: number, ms: number): GainNode {
  const gain = ctx.createGain();
  const t = ctx.currentTime;
  gain.gain.setValueAtTime(peak, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + ms / 1000);
  return gain;
}

/** Filtered noise: what most of these are. */
function filtered(ctx: AudioContext, ms: number, type: BiquadFilterType, hz: number, q: number, peak: number): void {
  const src = noise(ctx, ms);
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = hz;
  filter.Q.value = q;
  src.connect(filter).connect(fade(ctx, peak, ms)).connect(ctx.destination);
  src.start();
}

/** A short tone dropping in pitch as it fades: the knock of something hollow. */
function knock(ctx: AudioContext, hz: number, ms: number, peak: number): void {
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(hz, t);
  osc.frequency.exponentialRampToValueAtTime(hz * 0.7, t + ms / 1000);
  osc.connect(fade(ctx, peak, ms)).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + ms / 1000 + 0.01);
}

const SOUNDS: Record<ClickSound, (ctx: AudioContext, down: boolean) => void> = {
  // Shelfmind's: a dry mechanical click, a hand tally counter's.
  clicker: (ctx, down) => filtered(ctx, 30, "bandpass", down ? 1700 : 3400, 1.1, 0.5),
  // Muffled, as a click through a cloth: for counting next to someone.
  soft: (ctx, down) => filtered(ctx, 25, "lowpass", down ? 700 : 1100, 0.7, 0.45),
  // A wooden knock, with the snap of its strike on top.
  wood: (ctx, down) => {
    knock(ctx, down ? 620 : 880, 70, 0.35);
    filtered(ctx, 8, "highpass", 2500, 0.7, 0.15);
  },
  // A tiny, high, quiet tick: a watch's.
  tick: (ctx, down) => filtered(ctx, 12, "bandpass", down ? 3000 : 5200, 3, 0.35),
};

/**
 * The shared audio context, created on first use.
 *
 * Created lazily rather than at startup: a context built before any gesture
 * starts suspended, and browsers cap how many may exist.
 */
function audioContext(): AudioContext | null {
  if (context) return context;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    context = new Ctor();
  } catch {
    return null;
  }
  return context;
}
