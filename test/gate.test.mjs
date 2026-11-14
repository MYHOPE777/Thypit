import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateGate } from "../src/gate.mjs";

const RUN_STAT = { mtimeMs: 1000, size: 10 };
const PLAN = { format: "twb.plan@1", requests: { total: 3, provider: 2, local: 1 } };
const PRICE_PAID = { format: "twb.pricing@1", requests: 3, noCharge: 1, groups: [{ pricingUrl: "https://metaso.cn" }] };
const PRICE_FREE = { format: "twb.pricing@1", requests: 5, noCharge: 5, groups: [] };

function state(overrides = {}) {
  return { format: "twb.run-state@1", runMtime: RUN_STAT.mtimeMs, plan: PLAN, pricing: PRICE_PAID, ...overrides };
}

test("没有 plan 记录 → NO_PLAN", () => {
  const g = evaluateGate({ runRel: "runs/a.svrun", runStat: RUN_STAT, state: null, budgetCny: 10 });
  assert.equal(g.ok, false);
  assert.equal(g.code, "NO_PLAN");
  assert.match(g.reasons[0], /twb plan/);
});

test("run 改了 → STALE_PLAN", () => {
  const g = evaluateGate({ runRel: "runs/a.svrun", runStat: { ...RUN_STAT, mtimeMs: 2000 }, state: state(), budgetCny: 10, estimateCny: 1 });
  assert.equal(g.ok, false);
  assert.equal(g.code, "STALE_PLAN");
});

test("有付费请求但没填估算 → NO_ESTIMATE", () => {
  const g = evaluateGate({ runRel: "runs/a.svrun", runStat: RUN_STAT, state: state(), budgetCny: 10 });
  assert.equal(g.ok, false);
  assert.equal(g.code, "NO_ESTIMATE");
  assert.equal(g.providerRequests, 2);
});

test("估算超预算 → OVER_BUDGET 且给出差额", () => {
  const g = evaluateGate({ runRel: "runs/a.svrun", runStat: RUN_STAT, state: state(), budgetCny: 3, estimateCny: 4.5 });
  assert.equal(g.ok, false);
  assert.equal(g.code, "OVER_BUDGET");
  assert.match(g.reasons.join("\n"), /超 ¥1\.5/);
});

test("估算在预算内 → 放行", () => {
  const g = evaluateGate({ runRel: "runs/a.svrun", runStat: RUN_STAT, state: state(), budgetCny: 10, estimateCny: 0.44 });
  assert.equal(g.ok, true);
  assert.equal(g.estimateCny, 0.44);
});

test("全免费 run 不要求估算", () => {
  const g = evaluateGate({
    runRel: "runs/a.svrun", runStat: RUN_STAT,
    state: state({ pricing: PRICE_FREE }), budgetCny: 10,
  });
  assert.equal(g.ok, true);
  assert.equal(g.providerRequests, 0);
  assert.equal(g.estimateCny, null);
});

test("缺少价目记录 → NO_PRICE", () => {
  const g = evaluateGate({ runRel: "runs/a.svrun", runStat: RUN_STAT, state: state({ pricing: null }), budgetCny: 10, estimateCny: 1 });
  assert.equal(g.ok, false);
  assert.equal(g.code, "NO_PRICE");
});

test("服务商声明免费（pricing.free）→ 不要求估算直接放行", () => {
  const freePrice = { format: "twb.pricing@1", requests: 9, noCharge: 0, freeRequests: 9, free: true, groups: [] };
  const g = evaluateGate({ runRel: "runs/a.svrun", runStat: RUN_STAT, state: state({ pricing: freePrice }), budgetCny: 10 });
  assert.equal(g.ok, true);
  assert.equal(g.code, "OK");
  assert.equal(g.providerRequests, 9);
  assert.equal(g.freeRequests, 9);
  assert.equal(g.paidRequests, 0);
});

test("部分免费 → 仍要求付费部分的估算", () => {
  const mixed = { format: "twb.pricing@1", requests: 3, noCharge: 0, freeRequests: 1, groups: [] };
  const g = evaluateGate({ runRel: "runs/a.svrun", runStat: RUN_STAT, state: state({ pricing: mixed }), budgetCny: 10 });
  assert.equal(g.ok, false);
  assert.equal(g.code, "NO_ESTIMATE");
  assert.equal(g.paidRequests, 2);
  assert.match(g.reasons.join("\n"), /2 次付费请求/);
});
