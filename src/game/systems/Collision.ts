/**
 * Hit tests between the hero, the hazards and the coins.
 *
 * One rule per line, so a reviewer can argue with the physics without reading a render
 * loop. `clearWith` in `game/data/obstacles.json` is the contract: a stance only saves you
 * from a hazard that says it does.
 */
import type { Hero } from "../entities/Hero";
import type { Coin, Obstacle } from "../entities/Spawner";

export interface CollisionConfig {
  heroDepthMeters: number;
  coinWindowMeters: number;
  coinHeightWindow: number;
  /** How close a hazard must get, in our lane, before dodging it counts as a close call. */
  nearMissWindowMeters: number;
}

/**
 * A hazard is a threat while its *body* straddles the hero's z-range — the near face of a
 * 10 m train passes the feet long before the danger does, which is the single most common
 * way a runner feels cheated if you only look at the front edge.
 */
export function isThreat(obstacle: Obstacle, ahead: number): boolean {
  return obstacle.meters + obstacle.kind.lengthMeters > 0 && obstacle.meters < ahead;
}

export type Contact =
  | { type: "hit"; obstacle: Obstacle }
  | { type: "nearMiss"; obstacle: Obstacle }
  | { type: "coin"; coin: Coin };

/** Obstacle occupies [meters, meters + length] in front of the hero, which sits at 0. */
export function overlapsZ(nearMeters: number, lengthMeters: number, heroDepth: number): boolean {
  return nearMeters < heroDepth && nearMeters + lengthMeters > 0;
}

/** Does the hero's current stance beat this hazard? */
export function heroClears(hero: Hero, obstacle: Obstacle): boolean {
  const clears = hero.clears;
  return clears !== null && obstacle.kind.clearWith.includes(clears);
}

/**
 * Mutates the two entity lists (marks hits, clears and pickups) and returns what happened
 * this frame. Called once per simulation step from `RunWorld`, never from a render path.
 */
export function resolveContacts(
  hero: Hero,
  obstacles: Obstacle[],
  coins: Coin[],
  cfg: CollisionConfig,
): Contact[] {
  const out: Contact[] = [];

  for (const obstacle of obstacles) {
    const escaped = obstacle.meters + obstacle.kind.lengthMeters <= 0;
    if (escaped) {
      // Dodged: it was aimed at us, and it ended up behind us without a hit.
      if (!obstacle.scored && !obstacle.hit && obstacle.threatened) {
        obstacle.scored = true;
        out.push({ type: "nearMiss", obstacle });
      }
      continue;
    }
    if (obstacle.hit || obstacle.lane !== hero.lane) continue;

    obstacle.threatened = obstacle.meters <= cfg.nearMissWindowMeters ? true : obstacle.threatened;
    const inside = overlapsZ(obstacle.meters, obstacle.kind.lengthMeters, cfg.heroDepthMeters);
    if (!inside) continue;

    if (heroClears(hero, obstacle)) {
      // Cleared it from the same lane: that is the tightest, most valuable read.
      if (!obstacle.scored) {
        obstacle.scored = true;
        out.push({ type: "nearMiss", obstacle });
      }
      continue;
    }
    obstacle.hit = true;
    out.push({ type: "hit", obstacle });
  }

  for (const coin of coins) {
    if (coin.taken) continue;
    if (coin.lane !== hero.lane) continue;
    if (Math.abs(coin.meters) > cfg.coinWindowMeters) continue;
    if (Math.abs(coin.height - hero.heightMeters) > cfg.coinHeightWindow) continue;
    coin.taken = true;
    out.push({ type: "coin", coin });
  }

  return out;
}
