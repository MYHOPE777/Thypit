// 唯一的 hypit 调用点：解析可执行文件、execFile、超时、JSON 解析、错误映射。
// 不拼 shell 字符串，不读密钥，不改环境。

import { execFile } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";

const DEFAULT_TIMEOUT = 180000;
const MAX_BUFFER = 64 * 1024 * 1024;

/** 从 root 向上找 node_modules/.bin/hypit，再退回 PATH。 */
export function resolveHypit(root, explicit = "") {
  if (explicit) {
    const p = resolve(explicit);
    if (!existsSync(p)) throw new Error(`--hypit 指向的文件不存在：${p}`);
    return p;
  }
  if (process.env.HYPIT_BIN) {
    const p = resolve(process.env.HYPIT_BIN);
    if (existsSync(p)) return p;
  }
  let dir = resolve(root || process.cwd());
  for (;;) {
    const p = join(dir, "node_modules", ".bin", "hypit");
    if (existsSync(p)) return p;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  for (const d of (process.env.PATH || "").split(delimiter)) {
    if (!d) continue;
    const p = join(d, "hypit");
    if (existsSync(p)) {
      try {
        if (statSync(p).isFile()) return p;
      } catch {}
    }
  }
  const err = new Error(
    "找不到 hypit 可执行文件：先在项目里安装官方发行版（node_modules/.bin/hypit），或用 --hypit / HYPIT_BIN 指定",
  );
  err.status = 2;
  throw err;
}

/** 取 stdout 里的 JSON 对象（容忍前置提示行）。 */
export function parseJsonOutput(stdout, stderr = "") {
  const text = String(stdout || "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error(`hypit 没有返回 JSON。stdout=${text.slice(0, 200) || "(空)"} stderr=${String(stderr).slice(0, 200)}`);
  }
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch (e) {
    throw new Error(`hypit 返回的 JSON 无法解析：${e.message}；开头=${text.slice(0, 160)}`);
  }
}

/**
 * 执行一次 hypit。永不抛「命令失败」——失败以 code/stdout/stderr 返回，
 * 只有「起不来」（ENOENT/EACCES）才抛，方便调用方区分。
 */
export function runHypit(bin, args, { cwd = process.cwd(), timeoutMs = DEFAULT_TIMEOUT, json = false } = {}) {
  return new Promise((done, reject) => {
    execFile(
      bin,
      args,
      { cwd, timeout: timeoutMs, maxBuffer: MAX_BUFFER, env: process.env },
      (error, stdout, stderr) => {
        if (error && (error.code === "ENOENT" || error.code === "EACCES")) {
          reject(new Error(`无法执行 hypit（${bin}）：${error.message}`));
          return;
        }
        const code = error ? (typeof error.code === "number" ? error.code : 1) : 0;
        const out = { code, stdout: String(stdout || ""), stderr: String(stderr || ""), json: null };
        if (json && code === 0) out.json = parseJsonOutput(out.stdout, out.stderr);
        else if (json && code !== 0) out.json = null;
        done(out);
      },
    );
  });
}
