/**
 * Harness for the gameplay tests: a bot that plays by reading the same data the renderer
 * does, plus the fixed-step driver. It lives in `tests/` on purpose — if a bot can survive a
 * kilometre of `RunWorld`, the level generator is not producing unfair layouts, and if the
 * bot dies the diff is a rule, not a flake.
 */
import type { GameAction } from "../../src/core/Input";
import type { Obstacle, ClearKind } from "../../src/game/entities/Spawner";
import { Spawner } from "../../src/game/entities/Spawner";
import { isThreat } from "../../src/game/systems/Collision";
import type { RunWorld } from "../../src/game/systems/RunWorld";

export const STEP = 1 / 60;

/**
 * The bot's input buffer. Mirrors `InputController`: newest press wins, an unconsumed action
 * expires after the same 160 ms window, so a bot cannot bank a queue of taps during a stagger
 * and fire them all on recovery.
 */
export class ActionQueue {
  private head: GameAction | null = null;
  private age = 0;
  static readonly TTL_STEPS = 10; // 0.16 s at the fixed step

  push(action: GameAction | null): void {
    if (action) {
      this.head = action;
      this.age = 0;
    }
  }

  expire(): void {
    if (this.head !== null && ++this.age > ActionQueue.TTL_STEPS) this.head = null;
  }

  /** Matches `RunWorld`'s expectation: an action is consumed once, by whoever asks for it. */
  readonly take = (action: GameAction): boolean => {
    if (this.head !== action) return false;
    this.head = null;
    this.age = 0;
    return true;
  };

  get size(): number {
    return this.head === null ? 0 : 1;
  }
}

/** Hazards whose body is in front of us and within `ahead` metres, by lane, nearest first. */
export function threatsByLane(world: RunWorld, ahead: number): Map<number, Obstacle[]> {
  const map = new Map<number, Obstacle[]>();
  for (const obstacle of world.obstacles) {
    if (obstacle.hit) continue;
    if (!isThreat(obstacle, ahead)) continue;
    const list = map.get(obstacle.lane) ?? [];
    list.push(obstacle);
    map.set(obstacle.lane, list);
  }
  for (const list of map.values()) list.sort((a, b) => a.meters - b.meters);
  return map;
}

/** What a lane demands: an action, "none" when it is empty, null when it cannot be beaten. */
export function answerFor(world: RunWorld, lane: number, ahead: number): ClearKind | "none" | null {
  const list = threatsByLane(world, ahead).get(lane) ?? [];
  return Spawner.answerForLane(list);
}

/**
 * The policy, which is also the design contract: answer the row with the one action that
 * beats everything in your lane; if no action does, move to a lane where one does. A bot that
 * can only play this way and still die means the generator produced an unfair row.
 */
export function botAction(world: RunWorld): GameAction | null {
  const hero = world.hero;
  // About a second of look-ahead: enough to commit a lane change (0.16 s) with margin, short
  // enough that it never reads a hazard it could not have reacted to.
  const reach = Math.max(10, world.speed * 1.1);
  const answer = answerFor(world, hero.lane, reach);

  if (answer === "jump") {
    const next = (threatsByLane(world, reach).get(hero.lane) ?? [])[0];
    if (!next || hero.airborne) return null;
    return next.meters < world.speed * 0.2 + 1.35 ? "jump" : null;
  }
  if (answer === "slide" || answer === "roll") {
    const next = (threatsByLane(world, reach).get(hero.lane) ?? [])[0];
    if (!next) return null;
    if (hero.airborne) return answer === "roll" ? "slide" : null; // dive out of a bad jump
    return next.meters < world.speed * 0.4 + 1.8 ? "slide" : null;
  }

  if (answer === null) {
    // This lane cannot be survived: step towards the nearest one that can.
    for (const delta of [-1, 1, -2, 2]) {
      const lane = hero.lane + delta;
      if (lane < 0 || lane > 2) continue;
      if (answerFor(world, lane, reach) !== null) return delta < 0 ? "left" : "right";
    }
    return null;
  }

  // The lane in front of us is empty for the whole look-ahead. Do nothing: wandering into
  // another lane to "look nicer" is how a naive bot walks into a flatbed, and it is how a
  // greedy player dies too. Coins are picked up by the rows that put them through the answer.
  return null;
}

/** Step the world with the bot driving until `seconds` are up or the run ends. */
export function drive(world: RunWorld, queue: ActionQueue, seconds: number): void {
  for (let t = 0; t < seconds; t += STEP) {
    if (world.phase === "over") break;
    queue.expire();
    queue.push(botAction(world));
    world.step(STEP);
  }
}
