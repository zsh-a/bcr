import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { chromium } from "playwright";

/**
 * Shared harness for the `verify-*.mjs`走查 scripts.
 *
 * These scripts run against a dev server (or a built bundle) in a real
 * Chromium, so they need a common way to locate the target, keep one browser
 * profile per app, and report failures without throwing away the exit code.
 */

/** Repository root, derived from this file's location. */
export const scriptsDir = fileURLToPath(new URL("../", import.meta.url));
export const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

/** Canonical screenshot/log directory shared by every走查 script. */
export const shotsDir = path.join(scriptsDir, "shots");

/** Default dev-server origins, keyed by the app whose profile they belong to. */
const defaultOrigins = {
  studio: "http://localhost:5199/studio",
  media: "http://localhost:5180",
};

/**
 * Resolve the surface under test.
 *
 * `BASE_URL` always wins so `verify-ci.mjs` can point several scripts at one
 * running dev server. Otherwise the caller supplies the app's default.
 */
export function baseUrl(fallback = defaultOrigins.studio) {
  return process.env.BASE_URL ?? fallback;
}

/** `baseUrl()` parsed, for scripts that need to build absolute paths. */
export function baseOrigin(fallback = defaultOrigins.studio) {
  return new URL(baseUrl(fallback)).origin;
}

/** Ensure a directory exists and return its path. */
export function ensureDir(directory) {
  mkdirSync(directory, { recursive: true });
  return directory;
}

/** Ensure {@link shotsDir} exists and return it. */
export function ensureShots() {
  return ensureDir(shotsDir);
}

/**
 * Mark the run as failed without throwing.
 *
 * Scripts keep asserting their own way (`assert`, `expect`, manual checks);
 * this only records the failure so the process exits non-zero at the end.
 */
export function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
}

/** First page of a persistent context, creating one if the profile had none. */
export async function firstPage(context, options) {
  return context.pages()[0] ?? (await context.newPage(options));
}

/**
 * Launch a persistent Chromium profile for `app`.
 *
 * Cache API / OPFS are per-origin (scheme + host + port), so a fixed dev port
 * plus a reused `userDataDir` means model weights download once and走查 runs
 * share cache and project data. Do not run two scripts for the same app in
 * parallel — Chromium holds a single-instance lock on the profile.
 *
 * Set `BCR_VERIFY_PROFILE` to share or separate a profile explicitly.
 */
export async function launchVerifyBrowser(app, options = {}) {
  const profileName = process.env.BCR_VERIFY_PROFILE ?? app;
  const profileDir = path.join(scriptsDir, `.pw-profile-${profileName}`);
  ensureDir(profileDir);
  ensureShots();
  return chromium.launchPersistentContext(profileDir, {
    viewport: { width: 1440, height: 900 },
    args: ["--disable-dev-shm-usage"],
    ...options,
  });
}

/**
 * Launch an ephemeral browser (no shared profile) for viewport/device sweeps
 * and other runs that must start from a clean storage state.
 */
export async function launchEphemeralBrowser(options = {}) {
  ensureShots();
  return chromium.launch(options);
}

/**
 * Collect uncaught page errors for the lifetime of a page.
 *
 * Returns the live array, so `expect(errors).toEqual([])` at the end of a
 * script reports exactly what the page threw.
 */
export function collectPageErrors(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}
