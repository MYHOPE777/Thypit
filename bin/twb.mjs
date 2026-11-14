// twb · Hypit Workbench CLI（M0–M1）
// 只做官方命令的封装与四个自有小文件（review/ledger/workbench.json + .twb 状态快照）。
// 不生成、不代理、不缓存官方结果。

import { isAbsolute, join, relative, resolve } from "node:path";
import { existsSync, statSync } from "node:fs";
import { findProject, listProject } from "../src/project.mjs";
import { runHypit, runHypitStream, resolveHypit } from "../src/hypit.mjs";
import { planSummary, pricingSummary, statusSummary, ledgerSummary } from "../src/report.mjs";
import { renderList, renderPlan, renderPricing, renderStatus, renderGate, renderLedger, renderNew } from "../src/format.mjs";
import { evaluateGate, readState, stampPlan, stampPricing, statRun } from "../src/gate.mjs";
import {
  appendLedger, budgetOf, newProduction, patchLedgerBuildId, productionByBuild, productionOfRun,
  readLedger, resultTarget, setBudget, writeReview,
} from "../src/actions.mjs";

const VERSION = "0.3.0";

const VALUE_FLAGS = new Set([
  "project", "hypit", "estimate", "budget", "verdict", "note", "reviewer",
  "output", "to", "production", "add", "title", "build", "port",
]);
const BOOL_FLAGS = new Set(["json", "help", "version", "force", "watch", "no-follow"]);

function camel(flag) {
  return flag.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

function parseArgs(argv) {
  const out = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      out._.push(a);
      continue;
    }
    const name = a.slice(2);
    if (VALUE_FLAGS.has(name)) {
      const v = argv[++i];
      if (v === undefined) throw usageError(`${a} 需要一个值`);
      out.flags[camel(name)] = v;
    } else if (BOOL_FLAGS.has(name)) {
      out.flags[camel(name)] = true;
    } else {
      throw usageError(`未知参数 ${a}`);
    }
  }
  return out;
}

function usageError(msg) {
  const err = new Error(msg);
  err.status = 2;
  return err;
}

function need(value, msg) {
  if (value === undefined || value === null || value === "" || value === false) throw usageError(msg);
  return value;
}

const USAGE = `twb ${VERSION} · Hypit Workbench

用法: twb <命令> [参数] [--project <目录>] [--json]

命令:
  list                                 列出项目 / productions / runs
  new <production>                     建官方骨架（BRIEF/TREATMENT/PROGRESS + 四个空目录）
  check <run>                          hypit check（免费，原样透传）
  plan  <run>                          hypit plan --json（免费，落状态快照）
  price <run>                          hypit pricing --json（只读网络，落状态快照）
  build <run> [--estimate <cny>]       过 gate → build → status --watch
  status <buildId> [--watch]           hypit status --json
  get <buildId> --output <名>          取回到 productions/<t>/results/
  review <buildId> <output> --verdict  写 review.json（approved|rejected|pending）
  ledger <production> [--add <cny>]    花费汇总 / 手工记实付
  studio <run>                         官方 Studio
  serve [--port 4790]                  本地 Web 工作台（127.0.0.1）

全局:
  --project <目录>   项目根（默认向上找 package.json 的 hypit.project）
  --hypit <文件>     指定 hypit 可执行文件
  --json             稳定机器输出
  --budget <cny>     本次覆盖 production 预算（写入 workbench.json）
`;

async function main(argv) {
  const { _, flags } = parseArgs(argv);
  const cmd = _[0] || (flags.help ? "help" : "");

  if (flags.version) return void console.log(VERSION);
  if (!cmd || cmd === "help" || flags.help) return void console.log(USAGE);

  const project = findProject(flags.project);

  if (cmd === "list") {
    const out = listProject({ project: flags.project });
    console.log(flags.json ? JSON.stringify(out, null, 2) : renderList(out));
    return;
  }

  if (cmd === "new") {
    const name = _[1];
    if (!name) throw usageError("new 需要 <production> 名");
    const root = project?.root || resolve(flags.project || process.cwd());
    const budget = flags.budget !== undefined ? Number(flags.budget) : undefined;
    const out = newProduction(root, name, { budgetCny: budget, title: flags.title });
    console.log(flags.json ? JSON.stringify(out, null, 2) : renderNew(out));
    return;
  }

  if (cmd === "serve") {
    const root = project?.root || flags.project;
    if (!root) throw usageError("serve 需要在 Hypit 项目里，或加 --project <目录>");
    const port = Number(flags.port || process.env.TWB_PORT || 4790);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) throw usageError(`端口不合法：${flags.port}`);
    const { serve } = await import("../src/server.mjs");
    serve({ root, port });
    return;
  }

  if (!project) throw usageError("不在 Hypit 项目里：加 --project <目录>，或在含 hypit.project 的目录下执行");
  const root = project.root;
  const hypit = resolveHypit(root, flags.hypit);

  if (cmd === "check" || cmd === "plan" || cmd === "price") {
    const runRel = relRun(root, need(_[1], `${cmd} 需要 <run> 路径`));
    if (cmd === "check") {
      const r = await runHypit(hypit, ["check", runRel], { cwd: root, timeoutMs: 120000 });
      if (r.stdout.trim()) console.log(r.stdout.trim());
      if (r.stderr.trim()) console.error(r.stderr.trim());
      if (r.code !== 0) process.exitCode = 1;
      return;
    }
    const json = await officialJson(root, hypit, [cmd === "plan" ? "plan" : "pricing", runRel, "--json"]);
    const summary = cmd === "plan" ? planSummary(json) : pricingSummary(json);
    const stat = statRun(root, runRel);
    if (stat) {
      if (cmd === "plan") stampPlan(root, runRel, stat, summary);
      else stampPricing(root, runRel, stat, summary);
    }
    console.log(flags.json ? JSON.stringify(summary, null, 2) : cmd === "plan" ? renderPlan(summary) : renderPricing(summary));
    return;
  }

  if (cmd === "build") {
    const runRel = relRun(root, need(_[1], "build 需要 <run> 路径"));
    if (flags.budget !== undefined && flags.budget !== "") {
      const prod = flags.production || productionOfRun(runRel);
      if (!prod) throw usageError("--budget 需要 run 在 productions/<name>/ 下，或加 --production");
      setBudget(root, prod, Number(flags.budget));
    }
    return void buildFlow(root, hypit, runRel, flags);
  }

  if (cmd === "status") {
    const id = need(_[1], "status 需要 <buildId>");
    if (flags.watch) {
      const r = await runHypitStream(hypit, ["status", id, "--watch"], { cwd: root });
      if (r.code !== 0) process.exitCode = 1;
    }
    const json = await officialJson(root, hypit, ["status", id, "--json"]);
    const s = statusSummary(json);
    console.log(flags.json ? JSON.stringify(s, null, 2) : renderStatus(s));
    const outcome = s.build?.work?.outcome;
    if (outcome === "failed" || outcome === "cancelled") process.exitCode = 1;
    return;
  }

  if (cmd === "get") {
    const id = need(_[1], "get 需要 <buildId>");
    const output = need(flags.output || _[2], "get 需要 <output名>（位置参数或 --output）");
    const production = flags.production || productionByBuild(root, id);
    if (!production) throw usageError("找不到这个 build 属于哪个 production：加 --production <名>");
    let targetPath;
    let renamed = false;
    if (flags.to) {
      const wanted = resolve(flags.to);
      targetPath = existsSync(wanted) && statSync(wanted).isDirectory() ? join(wanted, output) : wanted;
    } else {
      const target = resultTarget(root, production, output, id, { force: !!flags.force });
      targetPath = target.path;
      renamed = target.renamed === true;
    }
    const json = await officialJson(root, hypit, ["get", id, "--output", output, "--to", targetPath, "--json"]);
    const out = {
      format: "twb.get@1",
      buildId: id,
      production,
      output,
      path: json.path || targetPath,
      renamed,
    };
    console.log(flags.json ? JSON.stringify(out, null, 2) : `已取回 ${out.path}${out.renamed ? "（目标已存在，改用了带 build id 的文件名）" : ""}`);
    return;
  }

  if (cmd === "review") {
    const id = need(_[1], "review 需要 <buildId>");
    const output = need(_[2], "review 需要 <output>");
    const verdict = need(flags.verdict, "review 需要 --verdict approved|rejected|pending");
    const production = flags.production || productionByBuild(root, id);
    if (!production) throw usageError("找不到这个 build 属于哪个 production：加 --production <名>");
    const out = writeReview(root, production, { buildId: id, output, verdict, note: flags.note, reviewer: flags.reviewer });
    console.log(flags.json ? JSON.stringify(out, null, 2) : `已写 review：${id} / ${output} = ${verdict}（${out.path}）`);
    return;
  }

  if (cmd === "ledger") {
    const production = need(_[1], "ledger 需要 <production>");
    if (flags.add !== undefined) {
      if (!flags.build) throw usageError("ledger --add 需要 --build <buildId>");
      const entry = {
        buildId: flags.build,
        run: "",
        plannedRequests: 0,
        providerRequests: 0,
        estimateCny: null,
        pricingDocs: [],
        actualCny: Number(flags.add),
        note: flags.note || "",
        at: new Date().toISOString(),
      };
      appendLedger(root, production, entry);
    }
    const s = ledgerSummary(production, readLedger(root, production));
    console.log(flags.json ? JSON.stringify(s, null, 2) : renderLedger(s));
    return;
  }

  if (cmd === "studio") {
    const runRel = relRun(root, need(_[1], "studio 需要 <run> 路径"));
    const r = await runHypitStream(hypit, ["studio", "--run", runRel], { cwd: root });
    if (r.code !== 0) process.exitCode = 1;
    return;
  }

  throw usageError(`未知命令 ${cmd}`);
}

async function buildFlow(root, hypit, runRel, flags) {
  const production = flags.production || productionOfRun(runRel);
  if (!production) throw usageError("run 必须在 productions/<name>/ 下才能记账；或加 --production <名>");

  const stat = statRun(root, runRel);
  const state = readState(root, runRel);
  const budget = budgetOf(root, production);
  const gate = evaluateGate({
    runRel,
    runStat: stat,
    state,
    budgetCny: budget.budgetCny,
    estimateCny: flags.estimate ?? null,
  });
  if (!gate.ok) {
    console.log(flags.json ? JSON.stringify({ format: "twb.build@1", ok: false, gate }, null, 2) : renderGate(gate));
    process.exitCode = 1;
    return;
  }

  const entry = {
    buildId: "",
    run: runRel,
    plannedRequests: gate.planned?.requests?.total ?? 0,
    providerRequests: gate.providerRequests,
    estimateCny: gate.estimateCny ?? (gate.paidRequests === 0 ? 0 : null),
    pricingDocs: (gate.priced?.groups || []).map((g) => g.pricingUrl).filter(Boolean),
    actualCny: null,
    note: "",
    at: new Date().toISOString(),
  };
  appendLedger(root, production, entry);

  const args = ["build", runRel];
  if (flags.title) args.push("--title", flags.title);
  args.push("--json");
  const submitted = await runHypit(hypit, args, { cwd: root, timeoutMs: 180000, json: true });
  if (submitted.code !== 0) {
    patchLedgerBuildId(root, production, entry.at, "", { note: "提交失败" });
    console.error(submitted.stderr.trim() || submitted.stdout.trim() || `hypit build 退出码 ${submitted.code}`);
    process.exitCode = 1;
    return;
  }
  const buildId = submitted.json?.build?.id;
  if (!buildId) {
    patchLedgerBuildId(root, production, entry.at, "", { note: "hypit build 没有返回 build id" });
    throw new Error("hypit build 没有返回 build id");
  }
  patchLedgerBuildId(root, production, entry.at, buildId);
  const est = entry.estimateCny;
  console.log(`build 已提交：${buildId}（ledger 已记估算 ¥${est ?? 0}${gate.paidRequests === 0 && !est ? "，服务商免费" : ""}）`);

  if (flags.noFollow || flags.json) {
    const json = await officialJson(root, hypit, ["status", buildId, "--json"]);
    const s = statusSummary(json);
    const out = { format: "twb.build@1", ok: true, buildId, gate, entry: { ...entry, buildId }, status: s };
    console.log(flags.json ? JSON.stringify(out, null, 2) : renderStatus(s));
    return;
  }

  const follow = await runHypitStream(hypit, ["status", buildId, "--watch"], { cwd: root });
  const json = await officialJson(root, hypit, ["status", buildId, "--json"]);
  const s = statusSummary(json);
  console.log(renderStatus(s));
  if (follow.code !== 0 || s.build?.work?.outcome === "failed" || s.build?.work?.outcome === "cancelled") {
    process.exitCode = 1;
  }
}

async function officialJson(root, hypit, args) {
  const r = await runHypit(hypit, args, { cwd: root, timeoutMs: 180000, json: true });
  if (r.code !== 0) throw new Error(r.stderr.trim() || r.stdout.trim() || `hypit ${args[0]} 退出码 ${r.code}`);
  return r.json;
}

function relRun(root, p) {
  const abs = isAbsolute(p) ? p : join(root, p);
  return relative(root, resolve(abs)).split("\\").join("/");
}

main(process.argv.slice(2)).catch((err) => {
  if (process.env.TWB_DEBUG) console.error(err.stack);
  console.error(err.status === 2 ? `twb: ${err.message}\n\n${USAGE}` : `twb: ${err.message}`);
  process.exitCode = err.status || 1;
});
