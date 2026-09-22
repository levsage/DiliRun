/**
 * Entry point. Thin on purpose: everything worth testing lives in the modules it
 * wires together.
 */
import { bootWithFailureUI } from "./app/Boot";
import { APP_VERSION } from "./version";

const params = new URLSearchParams(location.search);

void bootWithFailureUI({ lab: params.get("lab") === "1", run: params.get("run") === "1" }).then((result) => {
  if (!result) return;
  // Handy for debugging from the console and for the (future) e2e harness.
  (window as unknown as { DILI: unknown }).DILI = {
    shell: result.shell,
    manifest: result.manifest,
    version: APP_VERSION,
  };
});
