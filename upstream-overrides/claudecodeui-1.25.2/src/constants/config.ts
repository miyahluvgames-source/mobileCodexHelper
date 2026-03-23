/**
 * Environment Flag: Is Platform
 * Indicates if the app is running in Platform mode (hosted) or OSS mode (self-hosted)
 */
export const IS_PLATFORM = import.meta.env.VITE_IS_PLATFORM === 'true';

/**
 * Environment Flag: Codex-only hardened mode
 * Keeps the UI aligned with the reduced backend surface for a single-user remote Codex panel.
 */
export const IS_CODEX_ONLY_HARDENED = import.meta.env.VITE_CODEX_ONLY_HARDENED_MODE !== 'false';

/**
 * Environment Flag: Codex Desktop bridge mode
 * Indicates the web UI is a remote control surface for the local Codex Desktop app,
 * not an independent Codex session creator.
 */
export const IS_CODEX_DESKTOP_BRIDGE = import.meta.env.VITE_CODEX_DESKTOP_BRIDGE_MODE !== 'false';
