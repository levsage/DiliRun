/** Build-time constants injected by Vite (see vite.config.ts `define`). */
declare const __DILI_VERSION__: string;

export const APP_VERSION: string = typeof __DILI_VERSION__ === "undefined" ? "0.0.0-dev" : __DILI_VERSION__;
export const APP_NAME = "DiliRun";
