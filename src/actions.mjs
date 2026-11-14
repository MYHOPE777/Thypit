// 唯一写入口：新建 production、预算文件、review.json、ledger.json。
// 只写项目内的小文件，不碰官方文件、不写结果目录之外的东西。

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

export const DEFAULT_BUDGET_CNY = 10;
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

export function writeJson(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
  renameSync(tmp, path);
}

export function productionOfRun(runRel) {
  const parts = String(runRel || "").split("/").filter(Boolean);
  return parts[0] === "productions" && parts.length > 2 ? parts[1] : "";
}

export function checkName(name) {
  if (!name || !NAME_RE.test(name)) {
    const err = new Error(`production 名不合法：${JSON.stringify(name)}（字母数字开头，允许 . _ -）`);
    err.status = 2;
    throw err;
  }
  return name;
}

/** 新建官方骨架；已存在则拒绝（不覆盖）。 */
export function newProduction(root, name, { budgetCny = DEFAULT_BUDGET_CNY, title = "" } = {}) {
  checkName(name);
  const prodDir = join(root, "productions", name);
  if (existsSync(prodDir)) {
    const err = new Error(`production 已存在：productions/${name}`);
    err.status = 2;
    throw err;
  }
  const created = [];
  for (const d of ["authors", "recipes", "runs", "assets"]) {
    mkdirSync(join(prodDir, d), { recursive: true });
    created.push(`productions/${name}/${d}/`);
  }
  const label = title || name;
  const files = {
    "BRIEF.md": `# ${label} · Brief\n\n## 目标\n\n（一句话：给谁看、要什么结果）\n\n## 约束\n\n- 时长：\n- 画幅：\n- 素材：\n`,
    "TREATMENT.md": `# ${label} · Treatment\n\n## 结构\n\n1. 钩子（0–3s）\n2. 展开\n3. 收尾\n\n## 镜头表\n\n| # | 时长 | 画面 | 参考 |\n|---|---|---|---|\n`,
    "PROGRESS.md": `# ${label} · Progress\n\n- ${new Date().toISOString().slice(0, 10)} 骨架建立\n`,
  };
  for (const [name2, body] of Object.entries(files)) {
    writeFileSync(join(prodDir, name2), body);
    created.push(`productions/${name}/${name2}`);
  }
  writeJson(join(prodDir, "workbench.json"), { format: "workbench.production@1", budgetCny });
  created.push(`productions/${name}/workbench.json`);

  const pkgPath = join(root, "package.json");
  const pkg = readJson(pkgPath, null);
  if (!pkg) {
    writeJson(pkgPath, { name: basename(root), private: true, type: "module", hypit: { project: true } });
    created.push("package.json");
  } else if (pkg.hypit?.project !== true) {
    writeJson(pkgPath, { ...pkg, hypit: { ...(pkg.hypit || {}), project: true } });
    created.push("package.json (hypit.project=true)");
  }
  return { root, production: name, dir: `productions/${name}`, budgetCny, created };
}

export function budgetOf(root, production = "") {
  const candidates = [];
  if (production) candidates.push(join(root, "productions", production, "workbench.json"));
  candidates.push(join(root, "workbench.json"));
  for (const p of candidates) {
    const data = readJson(p, null);
    if (data && Number.isFinite(Number(data.budgetCny))) {
      return { budgetCny: Number(data.budgetCny), path: p, source: data };
    }
  }
  return { budgetCny: DEFAULT_BUDGET_CNY, path: "", source: null };
}

export function setBudget(root, production, budgetCny) {
  const n = Number(budgetCny);
  if (!Number.isFinite(n) || n < 0) {
    const err = new Error(`预算必须是 ≥0 的数字：${budgetCny}`);
    err.status = 2;
    throw err;
  }
  const path = join(root, "productions", production, "workbench.json");
  const prev = readJson(path, { format: "workbench.production@1" });
  writeJson(path, { ...prev, format: "workbench.production@1", budgetCny: n });
  return { path, budgetCny: n };
}

export function readLedger(root, production) {
  const path = join(root, "productions", production, "ledger.json");
  const data = readJson(path, null);
  if (!data || !Array.isArray(data.entries)) return { format: "workbench.ledger@1", entries: [], path };
  return { format: "workbench.ledger@1", entries: data.entries, path };
}

export function appendLedger(root, production, entry) {
  const ledger = readLedger(root, production);
  ledger.entries.push(entry);
  writeJson(ledger.path, { format: "workbench.ledger@1", entries: ledger.entries });
  return entry;
}

/** build 拿到 id 后回填到刚写的那条（按 at 匹配）。 */
export function patchLedgerBuildId(root, production, at, buildId, extra = {}) {
  const ledger = readLedger(root, production);
  const hit = ledger.entries.find((e) => e.at === at);
  if (!hit) return false;
  Object.assign(hit, { buildId }, extra);
  writeJson(ledger.path, { format: "workbench.ledger@1", entries: ledger.entries });
  return true;
}

export function readReview(root, production) {
  const path = join(root, "productions", production, "review.json");
  const data = readJson(path, null);
  if (!data || !Array.isArray(data.items)) return { format: "workbench.review@1", items: [], path };
  return { format: "workbench.review@1", items: data.items, path };
}

export const VERDICTS = ["approved", "rejected", "pending"];

/** 幂等：同一 build+output 只保留一条，后写覆盖前写。 */
export function writeReview(root, production, { buildId, output, verdict, note = "", reviewer = "" }) {
  if (!VERDICTS.includes(verdict)) {
    const err = new Error(`verdict 只能是 ${VERDICTS.join("|")}：${verdict}`);
    err.status = 2;
    throw err;
  }
  const review = readReview(root, production);
  const item = { buildId, output, verdict, note: String(note || ""), reviewer: String(reviewer || ""), at: new Date().toISOString() };
  const idx = review.items.findIndex((i) => i.buildId === buildId && i.output === output);
  if (idx >= 0) review.items[idx] = item;
  else review.items.push(item);
  writeJson(review.path, { format: "workbench.review@1", items: review.items });
  return { item, path: review.path };
}

/**
 * 取回目标路径：默认 productions/<t>/results/<output>；
 * 已存在时改成 <output>.<buildId8>，除非 force。
 */
const MEDIA_EXT = { video: ".mp4", audio: ".mp3", image: ".png" };
function mediaFileName(output) {
  const dot = output.lastIndexOf(".");
  if (dot < 0) return output;
  const ext = output.slice(dot + 1);
  return MEDIA_EXT[ext] ? output.slice(0, dot) + MEDIA_EXT[ext] : output;
}

export function resultTarget(root, production, output, buildId, { force = false } = {}) {
  const base = join(root, "productions", production, "results");
  mkdirSync(base, { recursive: true });
  const wanted = join(base, mediaFileName(output));
  if (!existsSync(wanted) || force) return { path: wanted, renamed: false };
  const tag = String(buildId || "again").replace(/^bld_/, "").replace(/[^A-Za-z0-9]/g, "").slice(-8) || "again";
  // 同名 build 反复取回时也要能找到空位，不覆盖、不报错；tag 放在扩展名之前
  const dot = wanted.lastIndexOf(".");
  const stem = dot > 0 ? wanted.slice(0, dot) : wanted;
  const ext = dot > 0 ? wanted.slice(dot) : "";
  let candidate = `${stem}-${tag}${ext}`;
  for (let i = 2; existsSync(candidate); i++) candidate = `${stem}-${tag}-${i}${ext}`;
  return { path: candidate, renamed: true };
}

/** 从 ledger 反查 build 属于哪个 production。 */
export function productionByBuild(root, buildId) {
  let names = [];
  try {
    names = readdirSync(join(root, "productions"), { withFileTypes: true })
      .filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return "";
  }
  for (const name of names) {
    if (readLedger(root, name).entries.some((e) => e.buildId === buildId)) return name;
  }
  return "";
}
