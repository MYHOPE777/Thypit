import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendLedger, budgetOf, newProduction, patchLedgerBuildId, productionByBuild,
  productionOfRun, readLedger, readReview, resultTarget, writeReview,
} from "../src/actions.mjs";
import { ledgerSummary } from "../src/report.mjs";

function tmp() {
  return mkdtempSync(join(tmpdir(), "thypit-act-"));
}

test("newProduction 建官方骨架与预算文件", () => {
  const root = tmp();
  const out = newProduction(root, "promo", { budgetCny: 5 });
  assert.ok(existsSync(join(root, "package.json")));
  assert.ok(existsSync(join(root, "productions", "promo", "BRIEF.md")));
  assert.ok(existsSync(join(root, "productions", "promo", "runs")));
  const wb = JSON.parse(readFileSync(join(root, "productions", "promo", "workbench.json"), "utf8"));
  assert.equal(wb.budgetCny, 5);
  assert.equal(out.production, "promo");
});

test("newProduction 重复调用拒绝覆盖", () => {
  const root = tmp();
  newProduction(root, "promo");
  assert.throws(() => newProduction(root, "promo"), /已存在/);
});

test("newProduction 保留已有 package.json 并补 hypit.project", () => {
  const root = tmp();
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "keep-me" }));
  newProduction(root, "p2");
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  assert.equal(pkg.name, "keep-me");
  assert.equal(pkg.hypit.project, true);
});

test("budgetOf 读 production 级预算，缺省 10", () => {
  const root = tmp();
  newProduction(root, "promo", { budgetCny: 7.5 });
  assert.equal(budgetOf(root, "promo").budgetCny, 7.5);
  assert.equal(budgetOf(root, "nope").budgetCny, 10);
});

test("writeReview 同一 build+output 幂等覆盖", () => {
  const root = tmp();
  newProduction(root, "promo");
  writeReview(root, "promo", { buildId: "bld_1", output: "final.video", verdict: "pending" });
  writeReview(root, "promo", { buildId: "bld_1", output: "final.video", verdict: "approved", note: "ok" });
  const review = readReview(root, "promo");
  assert.equal(review.items.length, 1);
  assert.equal(review.items[0].verdict, "approved");
  assert.equal(review.items[0].note, "ok");
});

test("writeReview 拒绝非法 verdict", () => {
  const root = tmp();
  newProduction(root, "promo");
  assert.throws(() => writeReview(root, "promo", { buildId: "b", output: "o", verdict: "maybe" }), /approved\|rejected\|pending/);
});

test("ledger 追加、回填 buildId、汇总", () => {
  const root = tmp();
  newProduction(root, "promo");
  const at = new Date().toISOString();
  appendLedger(root, "promo", { buildId: "", run: "runs/a.svrun", plannedRequests: 2, providerRequests: 2, estimateCny: 0.44, pricingDocs: [], actualCny: null, note: "", at });
  assert.equal(patchLedgerBuildId(root, "promo", at, "bld_x"), true);
  const s = ledgerSummary("promo", readLedger(root, "promo"));
  assert.equal(s.entries[0].buildId, "bld_x");
  assert.equal(s.totals.estimateCny, 0.44);
  assert.equal(s.totals.open, 1);
  assert.equal(productionByBuild(root, "bld_x"), "promo");
});

test("resultTarget 已存在时改名而不覆盖，force 则覆盖", () => {
  const root = tmp();
  newProduction(root, "promo");
  const first = resultTarget(root, "promo", "final.video", "bld_abcdef123");
  assert.equal(first.renamed, false);
  writeFileSync(first.path, "x");
  const second = resultTarget(root, "promo", "final.video", "bld_abcdef123");
  assert.equal(second.renamed, true);
  assert.match(second.path, /final\.video\.[A-Za-z0-9]{8}$/);
  const forced = resultTarget(root, "promo", "final.video", "bld_abcdef123", { force: true });
  assert.equal(forced.renamed, false);
});

test("productionOfRun 只认 productions/<name>/...", () => {
  assert.equal(productionOfRun("productions/promo/runs/a.svrun"), "promo");
  assert.equal(productionOfRun("runs/a.svrun"), "");
});
