// 预算闸门：先 plan、再 price、再确认估算，四条前置条件全过才允许 build。
// 状态快照放项目 .twb/state/（派生缓存，可随时删；真事实仍在官方文件与 ledger.json）。

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const STATE_DIR = join(".twb", "state");

export function runKey(root, runRel) {
  return createHash("sha1").update(String(runRel)).digest("hex").slice(0, 12);
}

export function statePath(root, runRel) {
  return join(root, STATE_DIR, `${runKey(root, runRel)}.json`);
}

export function readState(root, runRel) {
  const p = statePath(root, runRel);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

export function writeState(root, runRel, patch = {}) {
  const p = statePath(root, runRel);
  const prev = readState(root, runRel) || { format: "twb.run-state@1", run: runRel };
  const next = { ...prev, ...patch, format: "twb.run-state@1", run: runRel };
  mkdirSync(join(root, STATE_DIR), { recursive: true });
  atomicWrite(p, JSON.stringify(next, null, 2) + "\n");
  return next;
}

/** 记一次 plan 成功：run 的 mtime/size 一起冻结。 */
export function stampPlan(root, runRel, runStat, summary) {
  return writeState(root, runRel, {
    runMtime: runStat.mtimeMs,
    runBytes: runStat.size,
    plannedAt: new Date().toISOString(),
    plan: summary,
  });
}

/** 记一次 pricing 成功。 */
export function stampPricing(root, runRel, runStat, summary) {
  return writeState(root, runRel, {
    runMtime: runStat.mtimeMs,
    runBytes: runStat.size,
    pricedAt: new Date().toISOString(),
    pricing: summary,
  });
}

/**
 * @returns {{ok:boolean, code:string, reasons:string[], estimateCny:number|null,
 *            providerRequests:number, budgetCny:number, planned:object|null, priced:object|null}}
 */
export function evaluateGate({ runRel, runStat = null, state = null, budgetCny = 10, estimateCny = null } = {}) {
  const reasons = [];
  let code = "";
  const planned = state?.plan || null;
  const priced = state?.pricing || null;

  if (!runStat) {
    reasons.push("run 文件不存在");
    code ||= "NO_RUN";
  }
  if (!state || !planned) {
    reasons.push("没有 plan 记录：先跑 twb plan <run>");
    code ||= "NO_PLAN";
  } else if (runStat && state.runMtime !== runStat.mtimeMs) {
    reasons.push("run 在 plan 之后被改过：重新跑 twb plan / twb price");
    code ||= "STALE_PLAN";
  }
  if (!priced) {
    reasons.push("没有价目记录：先跑 twb price <run>");
    code ||= "NO_PRICE";
  } else if (runStat && state.runMtime !== runStat.mtimeMs) {
    code ||= "STALE_PRICE";
  }

  const providerRequests = priced ? Math.max(0, (priced.requests || 0) - (priced.noCharge || 0)) : 0;
  const estimate = estimateCny === null || estimateCny === undefined || estimateCny === "" ? null : Number(estimateCny);
  if (estimate !== null && (!Number.isFinite(estimate) || estimate < 0)) {
    reasons.push(`--estimate 不是有效金额：${estimateCny}`);
    code ||= "BAD_ESTIMATE";
  }
  if (providerRequests > 0 && estimate === null) {
    reasons.push(`有 ${providerRequests} 次付费请求：必须用 --estimate <cny> 写明你确认的估算（官方不合计总价）`);
    code ||= "NO_ESTIMATE";
  }
  if (providerRequests === 0 && estimate === null) {
    // 全本地/免费：估算记 0，不要求用户填
  }
  const effective = estimate === null ? 0 : estimate;
  if (estimate !== null && effective > budgetCny) {
    reasons.push(`估算 ¥${effective} 超过预算 ¥${budgetCny}（超 ¥${round2(effective - budgetCny)}）`);
    code ||= "OVER_BUDGET";
  }

  return {
    ok: reasons.length === 0,
    code: reasons.length ? code || "BLOCKED" : "OK",
    reasons,
    estimateCny: estimate,
    providerRequests,
    budgetCny,
    planned,
    priced,
  };
}

export function statRun(root, runRel) {
  const p = join(root, runRel);
  if (!existsSync(p)) return null;
  const st = statSync(p);
  if (!st.isFile()) return null;
  return { mtimeMs: st.mtimeMs, size: st.size, rel: relative(root, p).split("\\").join("/") };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function atomicWrite(path, text) {
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}
