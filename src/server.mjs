// 本地 Web 工作台的 HTTP 层：只做「读盘 + 调官方 CLI + 写 review/ledger」，
// 不缓存状态、不起后台任务。所有路径都限制在项目根内。

import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createReadStream, existsSync } from "node:fs";
import { open, readFile, readdir, stat } from "node:fs/promises";
import { extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveHypit, runHypit } from "./hypit.mjs";
import { findProject, listProject } from "./project.mjs";
import { ledgerSummary, planSummary, pricingSummary, statusSummary } from "./report.mjs";
import * as gate from "./gate.mjs";
import * as actions from "./actions.mjs";

const WEB_DIR = fileURLToPath(new URL("../web/", import.meta.url));
const STATIC = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/styles.css": ["styles.css", "text/css; charset=utf-8"],
};
const TEXT = new Set([".md", ".svml", ".svrun", ".json", ".txt", ".yaml", ".yml", ".mjs", ".js", ".css", ".html"]);
const MEDIA = {
  ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp",
  ".wav": "audio/wav", ".mp3": "audio/mpeg", ".m4a": "audio/mp4",
};

/** 把请求里的相对路径限制在项目根内；越界直接 400。 */
function inRoot(root, rel) {
  const abs = resolve(root, rel || ".");
  const inside = abs === root || abs.startsWith(root + sep);
  if (!inside) {
    const err = new Error(`路径越界：${rel}`);
    err.status = 400;
    throw err;
  }
  return abs;
}

async function body(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) {
      const err = new Error("请求体超过 1MB");
      err.status = 413;
      throw err;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const err = new Error("请求体不是合法 JSON");
    err.status = 400;
    throw err;
  }
}

function send(res, status, data, type = "application/json; charset=utf-8") {
  const text = type.startsWith("application/json") ? JSON.stringify(data) : String(data);
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(text);
}

/** 官方 output 常常没有扩展名（gen.video），按文件头猜播放类型。 */
async function sniffType(abs) {
  const fh = await open(abs, "r");
  try {
    const buf = Buffer.alloc(16);
    const { bytesRead } = await fh.read(buf, 0, 16, 0);
    const head = buf.subarray(0, bytesRead);
    if (head.length >= 8 && head.subarray(4, 8).toString("latin1") === "ftyp") {
      const brand = head.subarray(8, 12).toString("latin1");
      return brand === "qt  " ? "video/quicktime" : "video/mp4";
    }
    if (head.length >= 4 && head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return "video/webm";
    if (head.length >= 8 && head.subarray(0, 8).toString("hex") === "89504e470d0a1a0a") return "image/png";
    if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
    if (head.length >= 12 && head.subarray(0, 4).toString("latin1") === "RIFF" && head.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
    if (head.length >= 12 && head.subarray(0, 4).toString("latin1") === "RIFF" && head.subarray(8, 12).toString("latin1") === "WAVE") return "audio/wav";
    return "";
  } finally {
    await fh.close();
  }
}

/** 产物按实际类型分类：官方 output 常无扩展名，靠文件头。 */
async function mediaKind(abs, type) {
  const t = type || MEDIA[extname(abs).toLowerCase()] || (await sniffType(abs));
  if (t.startsWith("video/")) return "video";
  if (t.startsWith("audio/")) return "audio";
  if (t.startsWith("image/")) return "image";
  return "file";
}

async function listResults(root, production) {
  const dir = join(root, "productions", production, "results");
  let names = [];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const out = [];
  for (const name of names.sort()) {
    const path = join(dir, name);
    try {
      const s = await stat(path);
      if (!s.isFile()) continue;
      const type = MEDIA[extname(path).toLowerCase()] || (await sniffType(path));
      out.push({
        name,
        rel: relative(root, path).split(sep).join("/"),
        bytes: s.size,
        mtime: s.mtime.toISOString(),
        kind: await mediaKind(path, type),
      });
    } catch {
      // 读不到就跳过
    }
  }
  return out;
}

/** deps 可注入，测试里不真跑官方 CLI。 */
export function createAppServer({ root, deps = {} } = {}) {
  if (!root) throw new Error("createAppServer 需要 root");
  const hypit = deps.hypit || ((args, opts) => runHypit(resolveHypit(root), args, { cwd: root, ...opts }));
  const studio = deps.studio || ((args) => spawn(resolveHypit(root), args, { cwd: root, detached: true, stdio: "ignore" }).unref());

  const routes = {
    "GET /api/state": async () => {
      const lp = listProject({ project: root });
      const productions = [];
      for (const p of lp.productions) {
        productions.push({
          ...p,
          budgetCny: actions.budgetOf(root, p.name).budgetCny,
          review: actions.readReview(root, p.name),
          ledger: ledgerSummary(p.name, actions.readLedger(root, p.name)),
          results: await listResults(root, p.name),
        });
      }
      const builds = await hypit(["builds", "--json"], { json: true });
      return {
        project: lp.project,
        hint: lp.hint || "",
        productions,
        builds: builds.json?.builds || [],
        buildsError: builds.code === 0 ? "" : (builds.stderr || "builds 失败").trim().split("\n")[0],
      };
    },

    "GET /api/file": async (_req, url) => {
      const rel = url.searchParams.get("path") || "";
      const abs = inRoot(root, rel);
      if (!TEXT.has(extname(abs).toLowerCase())) {
        const err = new Error(`不支持预览的类型：${extname(abs) || "无扩展名"}`);
        err.status = 415;
        throw err;
      }
      const s = await stat(abs).catch(() => null);
      if (!s || !s.isFile()) {
        const err = new Error(`没有这个文件：${rel}`);
        err.status = 404;
        throw err;
      }
      if (s.size > 256 * 1024) {
        const err = new Error("文件超过 256KB，命令行里看吧");
        err.status = 413;
        throw err;
      }
      return { path: rel, bytes: s.size, text: await readFile(abs, "utf8") };
    },

    "POST /api/check": async (_req, _url, data) => {
      const r = await hypit(["check", data.run], {});
      return { ok: r.code === 0, code: r.code, output: (r.stdout || r.stderr || "").trim() };
    },

    "POST /api/plan": async (_req, _url, data) => {
      const r = await hypit(["plan", data.run, "--json"], { json: true });
      if (r.code !== 0 || !r.json) {
        const err = new Error((r.stderr || "plan 失败").trim().split("\n").slice(-3).join(" "));
        err.status = 502;
        throw err;
      }
      const summary = planSummary(r.json);
      gate.stampPlan(root, data.run, gate.statRun(root, data.run), summary);
      return summary;
    },

    "POST /api/price": async (_req, _url, data) => {
      const r = await hypit(["pricing", data.run, "--json"], { json: true });
      if (r.code !== 0 || !r.json) {
        const err = new Error((r.stderr || "pricing 失败").trim().split("\n").slice(-3).join(" "));
        err.status = 502;
        throw err;
      }
      const summary = pricingSummary(r.json);
      gate.stampPricing(root, data.run, gate.statRun(root, data.run), summary);
      return summary;
    },

    "POST /api/build": async (_req, _url, data) => {
      const runRel = String(data.run || "");
      const production = actions.productionOfRun(runRel);
      const runStat = gate.statRun(root, runRel);
      const state = gate.readState(root, runRel);
      const budgetCny = actions.budgetOf(root, production).budgetCny;
      const estimateCny = data.estimateCny == null || data.estimateCny === "" ? null : Number(data.estimateCny);
      const g = gate.evaluateGate({ runRel, runStat, state, budgetCny, estimateCny });
      if (!g.ok) {
        const err = new Error(g.reasons.join("；"));
        err.status = 409;
        err.payload = g;
        throw err;
      }
      const at = new Date().toISOString();
      const entry = {
        buildId: "",
        run: runRel,
        plannedRequests: g.planned?.requests?.total || 0,
        providerRequests: g.providerRequests,
        estimateCny: g.estimateCny,
        pricingDocs: g.priced?.groups ? g.priced.groups.map((x) => x.pricingUrl).filter(Boolean) : [],
        actualCny: null,
        note: "",
        at,
      };
      actions.appendLedger(root, production, entry);
      const args = ["build", runRel, "--json"];
      if (data.title) args.push("--title", String(data.title));
      const r = await hypit(args, { json: true });
      const buildId = r.json?.build?.id || "";
      if (!buildId) {
        actions.patchLedgerBuildId(root, production, at, "", { note: `提交失败：${(r.stderr || "").trim().slice(0, 200)}` });
        const err = new Error((r.stderr || "build 提交失败").trim().split("\n").slice(-3).join(" "));
        err.status = 502;
        throw err;
      }
      actions.patchLedgerBuildId(root, production, at, buildId);
      return { buildId, gate: g, status: statusSummary(r.json) };
    },

    "GET /api/status": async (_req, url) => {
      const id = url.searchParams.get("id") || "";
      const r = await hypit(["status", id, "--json"], { json: true });
      return r.json ? statusSummary(r.json) : { format: "twb.status@1", found: false, build: null, error: (r.stderr || "").trim() };
    },

    "POST /api/get": async (_req, _url, data) => {
      const buildId = String(data.buildId || "");
      const output = String(data.output || "");
      const production = data.production || actions.productionByBuild(root, buildId);
      if (!production) {
        const err = new Error("找不到这个 build 属于哪个 production");
        err.status = 404;
        throw err;
      }
      const target = actions.resultTarget(root, production, output, buildId, { force: !!data.force });
      // get 的人话输出（"+ Exported ..."）不是 JSON，别按 JSON 解析
      const r = await hypit(["get", buildId, "--output", output, "--to", target.path], {});
      if (r.code !== 0) {
        const err = new Error((r.stderr || "get 失败").trim().split("\n").slice(-3).join(" "));
        err.status = 502;
        throw err;
      }
      return { production, output, path: relative(root, target.path).split(sep).join("/"), renamed: target.renamed };
    },

    "POST /api/review": async (_req, _url, data) => {
      const buildId = String(data.buildId || "");
      const production = data.production || actions.productionByBuild(root, buildId);
      if (!production) {
        const err = new Error("找不到这个 build 属于哪个 production");
        err.status = 404;
        throw err;
      }
      const out = actions.writeReview(root, production, data);
      return { production, item: out.item, path: relative(root, out.path).split(sep).join("/") };
    },

    "POST /api/ledger": async (_req, _url, data) => {
      const production = String(data.production || "");
      const buildId = String(data.buildId || "");
      const ledger = actions.readLedger(root, production);
      const entry = ledger.entries.find((e) => e.buildId === buildId);
      if (!entry) {
        const err = new Error(`ledger 里没有 build ${buildId}`);
        err.status = 404;
        throw err;
      }
      entry.actualCny = data.actualCny === "" || data.actualCny == null ? null : Number(data.actualCny);
      if (data.note != null) entry.note = String(data.note);
      actions.writeJson(ledger.path, { format: "workbench.ledger@1", entries: ledger.entries });
      return ledgerSummary(production, ledger);
    },

    "POST /api/new": async (_req, _url, data) => {
      const out = actions.newProduction(root, String(data.production || ""), {
        budgetCny: data.budgetCny == null || data.budgetCny === "" ? actions.DEFAULT_BUDGET_CNY : Number(data.budgetCny),
        title: String(data.title || ""),
      });
      return { ok: true, production: String(data.production).trim(), dir: relative(root, out.dir).split(sep).join("/") };
    },

    "POST /api/studio": async (_req, _url, data) => {
      studio(["studio", String(data.run || "")]);
      return { started: true, run: String(data.run || "") };
    },
  };

  return createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    try {
      if (req.method === "GET" && url.pathname === "/api/media") {
        const abs = inRoot(root, url.searchParams.get("path") || "");
        const s = await stat(abs).catch(() => null);
        if (!s || !s.isFile()) return send(res, 404, { error: { code: "NOT_FOUND", message: "没有这个文件" } });
        const type = MEDIA[extname(abs).toLowerCase()] || (await sniffType(abs)) || "application/octet-stream";
        res.writeHead(200, {
          "content-type": type,
          "content-length": s.size,
          "cache-control": "no-store",
        });
        return createReadStream(abs).pipe(res);
      }
      const staticHit = req.method === "GET" && STATIC[url.pathname];
      if (staticHit) {
        const [name, type] = staticHit;
        const abs = join(WEB_DIR, name);
        if (!existsSync(abs)) return send(res, 404, { error: { code: "NO_WEB", message: "web/ 还没建好" } });
        return send(res, 200, await readFile(abs, "utf8"), type);
      }
      const key = `${req.method} ${url.pathname}`;
      const handler = routes[key];
      if (!handler) return send(res, 404, { error: { code: "NOT_FOUND", message: `${key} 不存在` } });
      const data = req.method === "POST" ? await body(req) : {};
      const out = await handler(req, url, data);
      return send(res, 200, out);
    } catch (err) {
      const status = err.status || 500;
      const payload = { error: { code: err.code || (status === 500 ? "INTERNAL" : "ERROR"), message: String(err.message || err) } };
      if (err.payload) payload.gate = err.payload;
      return send(res, status, payload);
    }
  });
}

/** `twb serve`：127.0.0.1 回环，默认 4790。 */
export function serve({ root, port = 4790 } = {}) {
  const project = root || findProject(process.cwd())?.root;
  if (!project) throw new Error("不在 Hypit 项目里（找不到 package.json 的 hypit.project）");
  const server = createAppServer({ root: project });
  server.listen(port, "127.0.0.1", () => {
    console.log(`twb serve · http://127.0.0.1:${port} · ${project}`);
  });
  return server;
}
