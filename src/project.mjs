// 项目发现与只读盘点：全部从磁盘派生，不缓存、不写盘。
// 官方约定：项目根 = 含 package.json 且 "hypit": { "project": true } 的目录。

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";

const SKIP = new Set(["node_modules", ".git", ".hypit", "results"]);

export function findProject(start = "") {
  let dir = resolve(start || process.cwd());
  for (;;) {
    const pkg = join(dir, "package.json");
    if (existsSync(pkg)) {
      try {
        const data = JSON.parse(readFileSync(pkg, "utf8"));
        if (data?.hypit?.project === true) {
          return { root: dir, name: String(data.name || basename(dir)) };
        }
      } catch {
        // 坏 package.json 不算项目根，继续向上
      }
    }
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

function safeDirs(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && !SKIP.has(d.name)).map((d) => d.name);
  } catch {
    return [];
  }
}

/** 递归收集 *.svrun，跳过 node_modules / .git / .hypit / results。 */
export function collectRuns(dir, root, out = [], limit = 400) {
  if (out.length >= limit) return out;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (out.length >= limit) break;
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP.has(e.name)) collectRuns(p, root, out, limit);
    } else if (e.isFile() && e.name.endsWith(".svrun")) {
      try {
        const st = statSync(p);
        out.push({ relPath: toRel(root, p), bytes: st.size, mtime: st.mtime.toISOString() });
      } catch {}
    }
  }
  return out;
}

function toRel(root, p) {
  return relative(root, p).split("\\").join("/");
}

export function listProject({ project = "", start = "" } = {}) {
  const found = findProject(project || start);
  if (!found) {
    return {
      format: "twb.list@1",
      project: null,
      productions: [],
      references: [],
      hint: "不在 Hypit 项目里：进入含 package.json（hypit.project=true）的目录，或加 --project <目录>",
    };
  }
  const { root, name } = found;
  const prodDir = join(root, "productions");
  const productions = safeDirs(prodDir).map((n) => {
    const dir = join(prodDir, n);
    const has = (f) => existsSync(join(dir, f));
    return {
      name: n,
      dir: toRel(root, dir),
      files: { brief: has("BRIEF.md"), treatment: has("TREATMENT.md"), progress: has("PROGRESS.md") },
      runs: collectRuns(dir, root).sort((a, b) => a.relPath.localeCompare(b.relPath)),
    };
  });

  const refDir = join(root, "references");
  const references = safeDirs(refDir).map((n) => {
    const dir = join(refDir, n);
    const files = existsSync(join(dir, "ANALYSIS.md")) ? ["ANALYSIS.md"] : [];
    if (existsSync(join(dir, "TIMELINE.md"))) files.push("TIMELINE.md");
    return { name: n, dir: toRel(root, dir), files };
  });

  return {
    format: "twb.list@1",
    project: {
      root,
      name,
      runtime: existsSync(join(root, "hypit.runtime.json")) ? "hypit.runtime.json" : "",
      productionsDir: existsSync(prodDir) ? "productions" : "",
    },
    productions,
    references,
  };
}
