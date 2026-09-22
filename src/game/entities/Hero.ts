/**
 * The hero's lane + vertical state machine.
 *
 * Deliberately free of canvas, DOM and sheet knowledge: it owns *where the runner is*
 * (lane, hop height, stance) and how long each action lasts, which makes the whole feel
 * of the game unit-testable. `src/app/RunScene.ts` maps its output onto sprite states.
 */
import balance from "../data/balance.json";

export type HeroAction = "run" | "jump" | "slide" | "roll";

/** What the current stance can beat, matched against `obstacle.clearWith`. */
export type ClearKind = "jump" | "slide" | "roll";

export interface HeroConfig {
  laneCount: number;
  laneChangeSeconds: number;
  jumpSeconds: number;
  jumpPeakMeters: number;
  slideSeconds: number;
  slideHeightMeters: number;
  rollSeconds: number;
  rollHeightMeters: number;
  coyoteSeconds: number;
  heroHeightMeters: number;
}

const cfg = balance as unknown as { run: HeroConfig & { lanes?: never } } & {
  lanes: { count: number };
};

export const HERO_CONFIG: HeroConfig = { ...cfg.run, laneCount: cfg.lanes.count };

export interface HeroHooks {
  onLand?: (airSeconds: number) => void;
  onLaneChange?: (from: number, to: number) => void;
}

/**
 * A runner that is always moving forward: `meters` is the world's job, this class only
 * knows lateral + vertical position. All timers are in seconds and step forward by dt.
 */
export class Hero {
  /** Discrete lane the collision box uses — flips at the midpoint of a lane change. */
  lane: number;
  /** Lane the sprite is easing from/towards while `laneT < 1`. */
  laneFrom: number;
  laneTarget: number;
  laneT = 1;
  action: HeroAction = "run";
  actionT = 0;
  /** Seconds left of the post-crash stagger; forces the `stumble` sprite state. */
  stumbleT = 0;
  /** Seconds spent airborne this jump, for the land event. */
  private airTime = 0;
  /** Counts down right after a real touchdown, so the sheet can show the impact frame. */
  private landT = 0;
  private coyote = 0;
  private grounded = true;
  /** Seconds spent crouching, so chaining a slide never opens a 2-frame hole under a beam. */
  private duckTime = 0;

  constructor(
    private readonly config: HeroConfig = HERO_CONFIG,
    private readonly hooks: HeroHooks = {},
    startLane?: number,
  ) {
    this.lane = startLane ?? Math.floor(config.laneCount / 2);
    this.laneFrom = this.lane;
    this.laneTarget = this.lane;
  }

  get laneEased(): number {
    const t = Math.max(0, Math.min(1, this.laneT));
    return this.laneFrom + (this.laneTarget - this.laneFrom) * easeOut(t);
  }

  /** 0 on the ground, up to 1 at the jump apex. Drives sprite offset and shadows. */
  get hop(): number {
    if (!this.airborne) return 0;
    const t = this.actionT / this.config.jumpSeconds;
    return 4 * t * (1 - t);
  }

  get airborne(): boolean {
    return this.action === "jump" && this.actionT < this.config.jumpSeconds;
  }

  get crouching(): boolean {
    return this.action === "slide" || this.action === "roll";
  }

  /** Feet height above the track, in metres. */
  get heightMeters(): number {
    if (this.airborne) return this.hop * this.config.jumpPeakMeters;
    if (this.action === "slide") return this.config.slideHeightMeters;
    if (this.action === "roll") return this.config.rollHeightMeters;
    return 0;
  }

  /** Top of the hitbox, in metres — what overhead hazards compare against. */
  get topMeters(): number {
    if (this.action === "slide") return this.config.slideHeightMeters;
    if (this.action === "roll") return this.config.rollHeightMeters;
    return this.heightMeters + this.config.heroHeightMeters;
  }

  /** The hazard-clearing ability this stance currently grants, if any. */
  get clears(): ClearKind | null {
    if (this.action === "roll" && this.duckingEnough) return "roll";
    if (this.action === "slide" && this.duckingEnough) return "slide";
    if (this.airborne && this.hop >= 0.25) return "jump";
    return null;
  }

  /**
   * A slide only protects you once the crouch is in — the first frames of a dive still clip a
   * beam, which is the "I pressed too late" feedback the genre depends on. Chaining a slide
   * (a second tap before the first expires) does not reset that clock, so holding down
   * reads as holding down.
   */
  private get duckingEnough(): boolean {
    return this.duckTime >= 0.04;
  }

  get busy(): boolean {
    return this.action !== "run";
  }

  /** Sprite state name from the baked sheet manifest. */
  get spriteState(): string {
    if (this.stumbleT > 0) return "stumble";
    if (this.action === "slide") return "slide";
    if (this.action === "roll") return "roll";
    if (this.airborne) {
      return this.hop < 0.5 && this.actionT > this.config.jumpSeconds * 0.5 ? "fall" : "jump";
    }
    if (this.landT > 0) return "land";
    return "run";
  }

  private commitLane(to: number): void {
    if (to === this.lane) return;
    const from = this.lane;
    this.lane = to;
    this.hooks.onLaneChange?.(from, to);
  }

  move(direction: -1 | 1): boolean {
    const to = clampLane(this.laneTarget + direction, this.config.laneCount);
    if (to === this.laneTarget) return false;
    this.laneFrom = this.laneEased;
    this.laneTarget = to;
    if (this.laneT >= 1) this.laneT = 0;
    else this.laneT = Math.min(this.laneT, 0.55); // a second tap cuts the current slide short
    return true;
  }

  jump(): boolean {
    if (this.airborne) return false;
    const canTakeoff = this.grounded || this.coyote > 0;
    if (!canTakeoff) return false;
    this.action = "jump";
    this.actionT = 0;
    this.airTime = 0;
    this.grounded = false;
    this.coyote = 0;
    return true;
  }

  /**
   * Slides cancel a jump (dive) and override a run; that is the genre's get-out-of-jail move.
   * Re-triggering late in a slide chains into another one — that is how a held-down player
   * stays under a gantry without mashing.
   */
  slide(): boolean {
    if (this.action === "slide" && this.actionT < this.config.slideSeconds * 0.6) return false;
    this.action = "slide";
    this.actionT = 0;
    return true;
  }

  /** Crashed: brief loss of control, no stances, then back to running. */
  stumble(seconds: number): void {
    this.stumbleT = seconds;
    this.action = "run";
    this.actionT = 0;
  }

  roll(): boolean {
    this.action = "roll";
    this.actionT = 0;
    return true;
  }

  step(dt: number): void {
    if (this.landT > 0) this.landT = Math.max(0, this.landT - dt);
    this.duckTime = this.crouching ? this.duckTime + dt : 0;
    if (this.stumbleT > 0) this.stumbleT = Math.max(0, this.stumbleT - dt);
    if (this.laneT < 1) {
      this.laneT = Math.min(1, this.laneT + dt / this.config.laneChangeSeconds);
      // The hitbox follows the sprite but only commits when it is more than half out of the
      // old lane — that is what makes a last-second swerve feel honest instead of lucky.
      const landed = Math.round(this.laneFrom + (this.laneTarget - this.laneFrom) * this.laneT);
      if (landed !== this.lane) this.commitLane(landed);
      if (this.laneT >= 1) this.commitLane(this.laneTarget);
    }

    this.actionT += dt;
    switch (this.action) {
      case "jump": {
        this.airTime += dt;
        if (this.actionT >= this.config.jumpSeconds) {
          this.action = "run";
          this.actionT = 0;
          this.grounded = true;
          this.coyote = this.config.coyoteSeconds;
          this.landT = 0.18;
          this.hooks.onLand?.(this.airTime);
        }
        break;
      }
      case "slide":
        if (this.actionT >= this.config.slideSeconds) {
          this.action = "run";
          this.actionT = 0;
        }
        break;
      case "roll":
        if (this.actionT >= this.config.rollSeconds) {
          this.action = "run";
          this.actionT = 0;
        }
        break;
      default:
        this.grounded = true;
        this.coyote = Math.max(0, this.coyote - dt);
        break;
    }
  }

  /** Where the renderer puts the sprite: eased lane, hop offset in logical px per metre. */
  reset(): void {
    this.lane = Math.floor(this.config.laneCount / 2);
    this.laneFrom = this.lane;
    this.laneTarget = this.lane;
    this.laneT = 1;
    this.action = "run";
    this.actionT = 0;
    this.airTime = 0;
    this.coyote = 0;
    this.grounded = true;
    this.stumbleT = 0;
    this.duckTime = 0;
    this.landT = 0;
  }

  snapshot() {
    return {
      lane: this.lane,
      laneEased: round3(this.laneEased),
      action: this.action,
      hop: round3(this.hop),
      heightMeters: round3(this.heightMeters),
      clears: this.clears,
    };
  }
}

export function clampLane(lane: number, count: number): number {
  return Math.max(0, Math.min(count - 1, Math.round(lane)));
}

const easeOut = (t: number): number => 1 - (1 - t) * (1 - t);
const round3 = (v: number): number => Math.round(v * 1000) / 1000;
