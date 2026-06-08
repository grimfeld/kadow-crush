// Background music (view-only). Loops one selectable track via an
// HTMLAudioElement. Tracks are CC-BY (Eric Matyas, soundimage.org) and CC0 —
// see public/music/ATTRIBUTION.md.
//
// The track choice (including "off") persists in localStorage. Audio can't
// start until a user gesture (autoplay policy), so unlock() is called from the
// first tap; until then we just remember the desired track and start it then.

export interface Track {
  /** Stable id, also the localStorage value. */
  id: string;
  /** Short label for the menu chip. */
  label: string;
  /** File under /music (served from public/). */
  file: string;
}

export const TRACKS: Track[] = [
  { id: "puzzler", label: "Puzzler", file: "/music/arcade-puzzler.ogg" },
  { id: "funky", label: "Funky", file: "/music/funky-chiptune.ogg" },
  { id: "balloons", label: "Balloons", file: "/music/balloons-forever.ogg" },
  { id: "adventure", label: "Adventure", file: "/music/happy-adventure.mp3" },
];

const STORAGE_KEY = "kadow.music";
const VOLUME = 0.4;

/** Music off, or a chosen track. (Persisted as the track id or "off".) */
type Selection = { kind: "off" } | { kind: "track"; id: string };

const OFF: Selection = { kind: "off" };
const track = (id: string): Selection => ({ kind: "track", id });

export class MusicPlayer {
  private audio: HTMLAudioElement | null = null;
  private selection: Selection;
  private unlocked = false;

  constructor() {
    this.selection = this.load();
  }

  private load(): Selection {
    if (typeof localStorage === "undefined") return track(TRACKS[0].id);
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "off") return OFF;
    if (saved && TRACKS.some((t) => t.id === saved)) return track(saved);
    return track(TRACKS[0].id); // default: first track on
  }

  private save() {
    if (typeof localStorage !== "undefined")
      localStorage.setItem(STORAGE_KEY, this.selection.kind === "off" ? "off" : this.selection.id);
  }

  /** Current selection. */
  get current(): Selection {
    return this.selection;
  }

  /** Short label for the menu chip ("Off" or the track label). */
  get label(): string {
    const sel = this.selection;
    if (sel.kind === "off") return "Off";
    return TRACKS.find((t) => t.id === sel.id)?.label ?? "Off";
  }

  /**
   * Allow playback (call from the first user gesture). Starts the saved track if
   * one is selected; harmless to call repeatedly.
   */
  unlock() {
    if (this.unlocked) return;
    this.unlocked = true;
    if (this.selection.kind === "track") this.play(this.selection.id);
  }

  /** Advance to the next selection: off → track0 → … → trackN → off. */
  cycle() {
    const order: Selection[] = [...TRACKS.map((t) => track(t.id)), OFF];
    const idOf = (s: Selection) => (s.kind === "off" ? "off" : s.id);
    const i = order.findIndex((s) => idOf(s) === idOf(this.selection));
    this.selection = order[(i + 1) % order.length];
    this.save();
    if (this.selection.kind === "off") this.stop();
    else if (this.unlocked) this.play(this.selection.id);
  }

  private play(id: string) {
    const track = TRACKS.find((t) => t.id === id);
    if (!track) return;
    if (!this.audio) {
      this.audio = new Audio();
      this.audio.loop = true;
      this.audio.volume = VOLUME;
    }
    // only reload the source if the track actually changed
    const want = track.file;
    if (!this.audio.src.endsWith(want)) {
      this.audio.src = want;
    }
    void this.audio.play().catch(() => {
      /* blocked until a gesture — unlock() will retry */
    });
  }

  private stop() {
    if (this.audio) {
      this.audio.pause();
      this.audio.currentTime = 0;
    }
  }
}
