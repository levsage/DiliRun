import { describe, expect, it, vi } from "vitest";
import { AssetLoader, joinUrl } from "../../src/core/Assets";

describe("joinUrl", () => {
  it("keeps absolute and data URLs untouched", () => {
    expect(joinUrl("./", "https://cdn.example/x.webp")).toBe("https://cdn.example/x.webp");
    expect(joinUrl("/base/", "data:image/png;base64,AAA")).toBe("data:image/png;base64,AAA");
  });

  it("resolves relative paths against the deploy base, including a sub-path", () => {
    expect(joinUrl("./", "assets/manifest.json")).toBe("./assets/manifest.json");
    expect(joinUrl("/dilirun/", "assets/manifest.json")).toBe("/dilirun/assets/manifest.json");
    expect(joinUrl("/dilirun", "/assets/manifest.json")).toBe("/dilirun/assets/manifest.json");
  });
});

describe("AssetLoader", () => {
  it("parses JSON, caches it and reports HTTP failures clearly", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ cell: 384 }) }) as unknown as typeof fetch;
    const loader = new AssetLoader("./", fetchImpl);
    await expect(loader.loadJson<{ cell: number }>("assets/x.json")).resolves.toEqual({ cell: 384 });
    await loader.loadJson("assets/x.json");
    expect(fetchImpl).toHaveBeenCalledTimes(1); // served from cache

    const failing = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 404, statusText: "Not Found" }) as unknown as typeof fetch;
    await expect(new AssetLoader("./", failing).loadJson("assets/missing.json")).rejects.toThrow(
      /404.*assets\/missing\.json/,
    );
  });

  it("loads images through the Image element and reuses them", async () => {
    const created: { src: string }[] = [];
    class FakeImage {
      decoding = "async";
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      private _src = "";
      set src(v: string) {
        this._src = v;
        created.push(this);
        queueMicrotask(() => this.onload?.());
      }
      get src(): string {
        return this._src;
      }
    }
    vi.stubGlobal("Image", FakeImage);
    const loader = new AssetLoader("./", vi.fn() as unknown as typeof fetch);
    const first = await loader.loadImage("assets/sprites/a.webp");
    const second = await loader.loadImage("assets/sprites/a.webp");
    expect(first).toBe(second);
    expect(created).toHaveLength(1);
    vi.unstubAllGlobals();
  });
});
