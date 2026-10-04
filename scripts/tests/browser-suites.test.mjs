import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import {
  browserGroupNames,
  parseBrowserOptions,
  selectBrowserGroups,
} from "../lib/browser-suites.mjs";

const root = new URL("../../", import.meta.url);
const scripts = (groups) => groups.flatMap((group) => group.checks.map((check) => check.script));

void test("core retains critical workflows and full retains every browser variant exactly once", () => {
  const core = selectBrowserGroups();
  const full = selectBrowserGroups({ suite: "full" });
  assert.deepEqual(
    core.map(({ name, checks }) => [name, checks.length]),
    [
      ["workspace", 12],
      ["quant", 12],
      ["reader", 8],
    ],
  );
  assert.equal(scripts(full).length, 87);
  assert.equal(new Set(scripts(full)).size, 87);
  for (const script of scripts(core)) assert.ok(scripts(full).includes(script), script);
  for (const script of scripts(full)) assert.ok(existsSync(new URL(script, root)), script);
  for (const critical of [
    "jsg-clickhouse-fixture",
    "binance-trend",
    "binance-kdj",
    "binance-price-action",
    "binance-structured-pullback",
    "research-recovery",
    "knowledge-attachments",
    "session-isolation",
    "content",
    "content-agent",
  ]) {
    assert.ok(scripts(core).includes(`scripts/verify-${critical}.mjs`), critical);
  }
});

void test("independent matrix groups partition both suites without dropping checks", () => {
  for (const suite of ["core", "full"]) {
    const separate = browserGroupNames.flatMap((group) =>
      scripts(selectBrowserGroups({ suite, group })),
    );
    assert.deepEqual(separate, scripts(selectBrowserGroups({ suite })));
  }
  const live = scripts(selectBrowserGroups({ liveMarkets: true }));
  assert.equal(live.filter((script) => script === "scripts/verify-market-atlas.mjs").length, 1);
  assert.equal(live.length, 33);
  assert.ok(
    !scripts(selectBrowserGroups({ group: "reader", liveMarkets: true })).includes(
      "scripts/verify-market-atlas.mjs",
    ),
  );
});

void test("CLI rejects invalid selections rather than silently skipping verification", () => {
  assert.throws(() => parseBrowserOptions(["--suite=fast"]), /Unknown browser suite/);
  assert.throws(() => parseBrowserOptions(["--group=typo"]), /Unknown browser group/);
  assert.throws(() => parseBrowserOptions(["--group="]), /Unknown browser group/);
  assert.throws(() => parseBrowserOptions(["--unknown"]));
  assert.throws(() => parseBrowserOptions(["full"]));
});

void test("CLI can list a CI group without starting servers or browsers", () => {
  const listed = spawnSync(
    process.execPath,
    ["scripts/verify-ci.mjs", "--suite=full", "--group=quant", "--list"],
    {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, BCR_VERIFY_LIVE_MARKETS: "0" },
    },
  );
  assert.equal(listed.status, 0, listed.stderr);
  assert.deepEqual(
    JSON.parse(listed.stdout),
    selectBrowserGroups({ suite: "full", group: "quant" }),
  );
});
