// The end-of-game celebration sequence (ADR-0001 — view only). A small timing
// state machine: once a Move decides the outcome and the board comes to rest,
// it holds on the final board for a beat, then reveals the result overlay; on a
// win it also showers confetti in spaced waves and ramps the overlay pop-in.
//
// Pure timing + particle triggers — it draws nothing itself (the Hud draws the
// overlay, gated by showOverlay()/overlayRamp()). It owns the fields that used
// to be threaded through GameView.tick().

import type { KAPLAYCtx } from "kaplay";
import type { Particles } from "./particles.ts";
import { playSound } from "./sound.ts";

const END_OVERLAY_DELAY = 0.9; // seconds to watch the final board before the modal
const WIN_CELEBRATE_SECS = 2.6; // how long confetti keeps showering on a win
const WIN_WAVE_GAP = 0.4; // gap between confetti rain waves

export class EndSequence {
  private started = false;
  private won = false;
  // Seconds to linger on the final board before the overlay appears. Counts
  // down from END_OVERLAY_DELAY once begun.
  private endHold = 0;
  // Win celebration: seconds of confetti showers still to fire, a timer to space
  // the waves out, and a 0→1 ramp that pops the overlay in.
  private celebrateLeft = 0;
  private nextWaveIn = 0;
  private overlayPop = 0;

  constructor(
    private k: KAPLAYCtx,
    private particles: Particles,
  ) {}

  /** Reset for a fresh game. */
  reset() {
    this.started = false;
    this.won = false;
    this.endHold = 0;
    this.celebrateLeft = 0;
    this.nextWaveIn = 0;
    this.overlayPop = 0;
  }

  /** Whether the sequence has already begun (so the caller fires it once). */
  get hasBegun() {
    return this.started;
  }

  /**
   * Begin the sequence: the outcome is decided and the board is at rest. Plays
   * the win/lose sting and kicks off the confetti shower on a win. Idempotent —
   * guard with `hasBegun` at the call site.
   */
  begin(won: boolean) {
    if (this.started) return;
    this.started = true;
    this.won = won;
    this.endHold = END_OVERLAY_DELAY;
    if (won) {
      playSound("win");
      this.particles.confettiRain(this.k.width(), 80);
      this.particles.confettiPop(this.k.width() / 2, this.k.height() * 0.55, 48);
      this.celebrateLeft = WIN_CELEBRATE_SECS;
      this.nextWaveIn = WIN_WAVE_GAP;
    } else {
      playSound("lose");
    }
  }

  /** Advance timers + confetti. Call each frame once begun. */
  advance(dt: number) {
    if (!this.started) return;

    // Count down the linger before the overlay shows.
    if (this.endHold > 0) this.endHold = Math.max(0, this.endHold - dt);

    // Confetti showers in spaced waves while the celebration lasts.
    if (this.celebrateLeft > 0) {
      this.celebrateLeft = Math.max(0, this.celebrateLeft - dt);
      this.nextWaveIn -= dt;
      if (this.nextWaveIn <= 0) {
        this.particles.confettiRain(this.k.width(), 50);
        this.nextWaveIn = WIN_WAVE_GAP;
      }
    }

    // Overlay pop-in ramp; only climbs once the linger is over and the modal is
    // about to show. A one-shot celebratory pop fires on the first ramp frame.
    if (this.won && this.endHold <= 0) {
      if (this.overlayPop === 0)
        this.particles.confettiPop(this.k.width() / 2, this.k.height() / 2, 40);
      this.overlayPop = Math.min(1, this.overlayPop + dt * 3.5);
    }
  }

  /** Whether the result overlay should be drawn (linger elapsed). */
  showOverlay(): boolean {
    return this.started && this.endHold <= 0;
  }

  /** The raw 0→1 overlay pop-in ramp (the Hud eases it for the win modal). */
  overlayRamp(): number {
    return this.overlayPop;
  }
}
