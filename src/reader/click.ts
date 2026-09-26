/**
 * The counter click.
 *
 * A mechanical counter makes a noise when you press it, and that noise is the
 * point: it tells you the press registered without taking your eyes off the
 * needles. Long-distance knitters rely on it, and a silent button gives nothing
 * back.
 *
 * It is synthesised rather than played from a file. That keeps a binary out of
 * the installer, avoids shipping someone else's recording of a click, and makes
 * the sound a couple of lines rather than an asset to load and cache.
 *
 * The shape is a mechanical one: a very short bright transient for the tick of
 * the pawl, over a fast-decaying body. It has to be short -- a click that
 * rings is a click that becomes grating after an evening of counting.
 */

/** How long the body rings for. Long enough to read as a click, not a beep. */
const BODY_MS = 45;
/** The pitch of the tick, in Hz. High and dry, like a small plastic counter. */
const TICK_HZ = 2100;
/** Peak level. Deliberately quiet: this fires on every row. */
const PEAK = 0.22;

/**
 * Rapid presses are throttled to this, so holding a key down does not turn the
 * click into a buzz. A mechanical counter cannot be pressed faster than a
 * finger moves, and neither should this sound.
 */
const MIN_GAP_MS = 35;

const MUTE_KEY = "shiny.knitting.counterSound";

let context: AudioContext | null = null;
let lastPlayed = 0;

/**
 * Whether the click is on.
 *
 * A preference rather than pattern data, so it lives in local storage and
 * applies everywhere. Read once at startup and cached, because it is consulted
 * on every press and local storage is not free.
 */
let muted = readMuted();

function readMuted(): boolean {
  try {
    return window.localStorage.getItem(MUTE_KEY) === "off";
  } catch {
    // Storage can be unavailable, which is not a reason to fail a count.
    return false;
  }
}

/** Turns the click on or off, and remembers the choice. */
export function setClickMuted(value: boolean): void {
  muted = value;
  try {
    window.localStorage.setItem(MUTE_KEY, value ? "off" : "on");
  } catch {
    // See above: a count must not fail because a preference could not be saved.
  }
}

export function isClickMuted(): boolean {
  return muted;
}

/**
 * Plays the click, if it is on and not too soon after the last one.
 *
 * Safe to call on every count: a browser that will not give us an audio
 * context, or a user who has muted it, simply produces nothing.
 */
export function playClick(): void {
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

    const start = ctx.currentTime;
    const body = ctx.createOscillator();
    const bodyGain = ctx.createGain();
    body.type = "triangle";
    body.frequency.setValueAtTime(TICK_HZ, start);
    // A real counter's pitch drops as the pawl settles, which is what makes it
    // read as a mechanism rather than a beep.
    body.frequency.exponentialRampToValueAtTime(TICK_HZ * 0.55, start + BODY_MS / 1000);
    bodyGain.gain.setValueAtTime(PEAK, start);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, start + BODY_MS / 1000);
    body.connect(bodyGain).connect(ctx.destination);
    body.start(start);
    body.stop(start + BODY_MS / 1000 + 0.01);
  } catch {
    // No audio available. A silent counter still counts.
  }
}

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
