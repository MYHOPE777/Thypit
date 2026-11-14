import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseJsonOutput, resolveHypit, runHypit } from "../src/hypit.mjs";

function fakeBin(dir, body) {
  const p = join(dir, "hypit");
  writeFileSync(p, `#!/bin/sh\n${body}\n`);
  chmodSync(p, 0o755);
  return p;
}

test("resolveHypit 优先项目内 node_modules/.bin/hypit", () => {
  const root = mkdtempSync(join(tmpdir(), "thypit-bin-"));
  const binDir = join(root, "node_modules", ".bin");
  mkdirSync(binDir, { recursive: true });
  const bin = fakeBin(binDir, "exit 0");
  assert.equal(resolveHypit(root), bin);
});

test("resolveHypit 显式路径不存在时报错", () => {
  assert.throws(() => resolveHypit("/tmp", "/tmp/definitely-not-here-hypit"), /不存在/);
});

test("parseJsonOutput 容忍前置提示行", () => {
  assert.deepEqual(parseJsonOutput('warn: something\n{"ok":true}\n'), { ok: true });
  assert.throws(() => parseJsonOutput(""), /没有返回 JSON/);
});

test("runHypit 汇总 stdout/stderr/退出码，json 仅在成功时解析", async () => {
  const dir = mkdtempSync(join(tmpdir(), "thypit-run-"));
  const ok = fakeBin(dir, "echo '{\"ok\":true}'");
  const r1 = await runHypit(ok, ["x", "--json"], { cwd: dir, json: true });
  assert.equal(r1.code, 0);
  assert.deepEqual(r1.json, { ok: true });

  const bad = fakeBin(dir, "echo oops >&2; exit 3");
  const r2 = await runHypit(bad, ["x", "--json"], { cwd: dir, json: true });
  assert.equal(r2.code, 3);
  assert.equal(r2.json, null);
  assert.match(r2.stderr, /oops/);
});
