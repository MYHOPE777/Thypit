// twb · Hypit Workbench CLI（M0）
// 只做官方命令的薄封装：check / plan / price，加上项目发现。不生成、不构建。

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { findProject, listProject } from "../src/project.mjs";
import { runHypit, resolveHypit } from "../src/hypit.mjs";
import { planSummary, pricingSummary } from "../src/report.mjs";
import { renderList, renderPlan, renderPricing } from "../src/format.mjs";

const VERSION = "0.1.0";

function parseArgs(argv) {
  const out = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") out.flags.json = true;
    else if (a === "--project") out.flags.project = argv[++i];
    else if (a === "--hypit") out.flags.hypit = argv[++i];
    else if (a === "--help" || a === "-h") out.flags.help = true;
    else if (a === "--version" || a === "-v") out.flags.version = true;
    else if (a.startsWith("--")) throw usageError(`未知参数 ${a}`);
    else out._.push(a);
  }
  return out;
}

function usageError(msg) {
  const err = new Error(msg);
  err.status = 2;
  return err;
}

const USAGE = `twb ${VERSION} · Hypit Workbench

用法: twb <命令> [参数] [--project <目录>] [--json]

命令:
  list                         列出项目、productions 与 runs
  check <run>                  校验一个 Run（hypit check，免费）
  plan  <run>                  执行计划（hypit plan --json，免费）
  price <run>                  价目（hypit pricing --json，只读网络）
  studio <run>                 打开官方 Studio（M2）
  help                         这份帮助

全局:
  --project <目录>             项目根目录（默认从当前目录向上找 hypit.project）
  --hypit <可执行文件>         指定 hypit（默认项目 node_modules/.bin/hypit）
  --json                       稳定机器输出
`;

async function main(argv) {
  const { _, flags } = parseArgs(argv);
  const cmd = _[0] || (flags.help ? "help" : "");

  if (flags.version) {
    console.log(VERSION);
    return;
  }
  if (!cmd || cmd === "help" || flags.help) {
    console.log(USAGE);
    return;
  }

  const project = findProject(flags.project);
  if (!project && cmd !== "list") throw usageError("不在 Hypit 项目里：加 --project <目录>，或在含 hypit.project 的目录下执行");

  if (cmd === "list") {
    const out = listProject({ project: flags.project });
    console.log(flags.json ? JSON.stringify(out, null, 2) : renderList(out));
    return;
  }

  const run = _[1];
  if (!run) throw usageError(`${cmd} 需要 <run> 路径`);

  const hypit = resolveHypit(project.root, flags.hypit);

  if (cmd === "check") {
    const r = await runHypit(hypit, ["check", run], { cwd: project.root, timeoutMs: 120000 });
    if (r.stdout.trim()) console.log(r.stdout.trim());
    if (r.stderr.trim()) console.error(r.stderr.trim());
    if (r.code !== 0) process.exitCode = 1;
    return;
  }

  if (cmd === "plan") {
    const r = await runHypit(hypit, ["plan", run, "--json"], { cwd: project.root, timeoutMs: 180000, json: true });
    if (r.code !== 0) {
      console.error(r.stderr.trim() || r.stdout.trim() || `hypit plan 退出码 ${r.code}`);
      process.exitCode = 1;
      return;
    }
    const s = planSummary(r.json);
    console.log(flags.json ? JSON.stringify(s, null, 2) : renderPlan(s));
    return;
  }

  if (cmd === "price") {
    const r = await runHypit(hypit, ["pricing", run, "--json"], { cwd: project.root, timeoutMs: 180000, json: true });
    if (r.code !== 0) {
      console.error(r.stderr.trim() || r.stdout.trim() || `hypit pricing 退出码 ${r.code}`);
      process.exitCode = 1;
      return;
    }
    const s = pricingSummary(r.json);
    console.log(flags.json ? JSON.stringify(s, null, 2) : renderPricing(s));
    return;
  }

  if (cmd === "studio") {
    console.log("studio 在 M2 提供；现在可直接跑：hypit studio --run " + run);
    return;
  }

  throw usageError(`未知命令 ${cmd}`);
}

main(process.argv.slice(2)).catch((err) => {
  console.error(err.status === 2 ? `twb: ${err.message}\n\n${USAGE}` : `twb: ${err.message}`);
  process.exitCode = err.status || 1;
});
