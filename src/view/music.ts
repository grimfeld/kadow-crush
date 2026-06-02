// Background music (view-only). Loops one selectable track via an
// HTMLAudioElement across both the menu and play screens. Tracks are Kevin
// MacLeod (incompetech.com), CC BY 3.0 — see public/music/ATTRIBUTION.md.
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
  { id: "monkeys", label: "Monkeys", file: "/music/monkeys-spinning-monkeys.ogg" },
  { id: "sneaky", label: "Sneaky", file: "/music/sneaky-snitch.ogg" },
  { id: "carefree", label: "Carefree", file: "/music/carefree.ogg" },
  { id: "duck", label: "Duck", file: "/music/fluffing-a-duck.ogg" },
];

const STORAGE_KEY = "kadow.music";
const VOLUME = 0.4;

/** A selection is either a track id or "off". */
type Selection = string;

export class MusicPlayer {
  private audio: HTMLAudioElement | null = null;
  private selection: Selection;
  private unlocked = false;

  constructor() {
    this.selection = this.load();
  }

  private load(): Selection {
    if (typeof localStorage === "undefined") return TRACKS[0].id;
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "off") return "off";
    if (saved && TRACKS.some((t) => t.id === saved)) return saved;
    return TRACKS[0].id; // default: first track on
  }

  private save() {
    if (typeof localStorage !== "undefined")
      localStorage.setItem(STORAGE_KEY, this.selection);
  }

  /** Current selection ("off" or a track id). */
  get current(): Selection {
    return this.selection;
  }

  /** Short label for the menu chip ("Off" or the track label). */
  get label(): string {
    if (this.selection === "off") return "Off";
    return TRACKS.find((t) => t.id === this.selection)?.label ?? "Off";
  }

  /**
   * Allow playback (call from the first user gesture). Starts the saved track if
   * one is selected; harmless to call repeatedly.
   */
  unlock() {
    if (this.unlocked) return;
    this.unlocked = true;
    if (this.selection !== "off") this.play(this.selection);
  }

  /** Advance to the next selection: off → track0 → … → trackN → off. */
  cycle() {
    const order: Selection[] = [...TRACKS.map((t) => t.id), "off"];
    const i = order.indexOf(this.selection);
    this.selection = order[(i + 1) % order.length];
    this.save();
    if (this.selection === "off") this.stop();
    else if (this.unlocked) this.play(this.selection);
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
