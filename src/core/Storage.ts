/**
 * Versioned, namespaced local storage.
 *
 * Everything DiliRun persists (coins bank, best score, leaderboard, settings) goes
 * through this: one prefix, one schema version, and safe failure in private
 * browsing where `localStorage` throws on write.
 */
export interface StorageDriver {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  keys(): string[];
}

class WebStorageDriver implements StorageDriver {
  constructor(private readonly backing: Storage) {}
  getItem(key: string): string | null {
    try {
      return this.backing.getItem(key);
    } catch {
      return null;
    }
  }
  setItem(key: string, value: string): void {
    this.backing.setItem(key, value);
  }
  removeItem(key: string): void {
    try {
      this.backing.removeItem(key);
    } catch {
      /* ignore */
    }
  }
  keys(): string[] {
    try {
      return Object.keys(this.backing);
    } catch {
      return [];
    }
  }
}

/** Test harness + a fallback for environments without storage (SSR, sandboxed iframes). */
export class MemoryDriver implements StorageDriver {
  private map = new Map<string, string>();
  get size(): number {
    return this.map.size;
  }
  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  keys(): string[] {
    return [...this.map.keys()];
  }
  clear(): void {
    this.map.clear();
  }
}

export function defaultDriver(): StorageDriver {
  try {
    if (typeof localStorage !== "undefined" && localStorage !== null) {
      return new WebStorageDriver(localStorage);
    }
  } catch {
    /* SecurityError in some privacy modes */
  }
  return new MemoryDriver();
}

export interface StoreOptions {
  prefix?: string;
  version?: number;
  driver?: StorageDriver;
}

export class Store {
  readonly prefix: string;
  readonly version: number;
  private readonly driver: StorageDriver;

  constructor(options: StoreOptions = {}) {
    this.prefix = options.prefix ?? "dilirun";
    this.version = options.version ?? 1;
    this.driver = options.driver ?? defaultDriver();
  }

  private qualify(key: string): string {
    return `${this.prefix}.v${this.version}.${key}`;
  }

  read<T>(key: string, fallback: T): T {
    const raw = this.driver.getItem(this.qualify(key));
    if (raw === null) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      // Corrupt payload: keep the game running, drop the bad entry.
      this.driver.removeItem(this.qualify(key));
      return fallback;
    }
  }

  write<T>(key: string, value: T): boolean {
    try {
      this.driver.setItem(this.qualify(key), JSON.stringify(value));
      return true;
    } catch {
      return false; // quota exceeded or storage disabled
    }
  }

  remove(key: string): void {
    this.driver.removeItem(this.qualify(key));
  }

  keys(): string[] {
    const head = `${this.prefix}.v${this.version}.`;
    return this.driver
      .keys()
      .filter((k) => k.startsWith(head))
      .map((k) => k.slice(head.length));
  }

  clearNamespace(): number {
    const names = this.keys();
    for (const key of names) this.remove(key);
    return names.length;
  }
}
