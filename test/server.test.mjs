// M2 server：只测 HTTP 边界与路径限制，不真跑 hypit（deps 注入）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAppServer } from "../src/server.mjs";

function makeProject() {
  const root = mkdtempSync(join(tmpdir(), "twb-srv-"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "demo", type: "module", hypit: { project: true } }, null, 2));
  const prod = join(root, "productions", "promo");
  for (const d of ["authors", "recipes", "runs", "assets", "results"]) mkdirSync(join(prod, d), { recursive: true });
  writeFileSync(join(prod, "BRIEF.md"), "# 简要\n\n一条 5s 片子。\n");
  writeFileSync(join(prod, "TREATMENT.md"), "# 处理\n");
  writeFileSync(join(prod, "PROGRESS.md"), "# 进度\n");
  writeFileSync(join(prod, "workbench.json"), JSON.stringify({ format: "workbench.production@1", budgetCny: 2 }));
  writeFileSync(join(prod, "runs", "build.svrun"), `<author source="../authors/a.svml"/>\n<target output="gen.video"/>\n`);
  writeFileSync(join(prod, "authors", "a.svml"), `<h3:TextVideo id="gen" prompt={p} duration="5"/>\n`);
  return root;
}

async function listen(root) {
  const server = createAppServer({
    root,
    deps: {
      hypit: async () => ({ code: 0, stdout: "", stderr: "", json: { format: "hypit.cli-builds@1", builds: [] } }),
      studio: async () => ({})
    },
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { server, base };
}

test("GET /api/state 从磁盘派生", async () => {
  const root = makeProject();
  const { server, base } = await listen(root);
  try {
    const res = await fetch(`${base}/api/state`);
    assert.equal(res.status, 200);
    const s = await res.json();
    assert.equal(s.project.name, "demo");
    assert.equal(s.productions.length, 1);
    const p = s.productions[0];
    assert.equal(p.name, "promo");
    assert.equal(p.budgetCny, 2);
    assert.equal(p.runs[0].relPath, "productions/promo/runs/build.svrun");
    assert.deepEqual(p.results, []);
  } finally {
    server.close();
  }
});

test("GET /api/file 预览文本，越界返回 400", async () => {
  const root = makeProject();
  const { server, base } = await listen(root);
  try {
    const ok = await fetch(`${base}/api/file?path=productions/promo/BRIEF.md`);
    assert.equal(ok.status, 200);
    assert.match((await ok.json()).text, /一条 5s 片子/);

    const escape = await fetch(`${base}/api/file?path=${encodeURIComponent("../../etc/passwd")}`);
    assert.equal(escape.status, 400);
    assert.match((await escape.json()).error.message, /路径越界/);

    const abs = await fetch(`${base}/api/file?path=${encodeURIComponent("/etc/passwd")}`);
    assert.equal(abs.status, 400);
  } finally {
    server.close();
  }
});

test("POST /api/review 写 review.json 并幂等", async () => {
  const root = makeProject();
  const { server, base } = await listen(root);
  try {
    const body = { buildId: "bld_test1", output: "gen.video", verdict: "pending", note: "待看", production: "promo" };
    const first = await fetch(`${base}/api/review`, { method: "POST", body: JSON.stringify(body) });
    assert.equal(first.status, 200);
    body.verdict = "rejected";
    const second = await fetch(`${base}/api/review`, { method: "POST", body: JSON.stringify(body) });
    assert.equal(second.status, 200);

    const saved = JSON.parse(readFileSync(join(root, "productions/promo/review.json"), "utf8"));
    assert.equal(saved.items.length, 1);
    assert.equal(saved.items[0].verdict, "rejected");
  } finally {
    server.close();
  }
});

test("POST /api/build 没过闸门 → 409 且没有 ledger 记录", async () => {
  const root = makeProject();
  const { server, base } = await listen(root);
  try {
    const res = await fetch(`${base}/api/build`, { method: "POST", body: JSON.stringify({ run: "productions/promo/runs/build.svrun", estimateCny: 1 }) });
    assert.equal(res.status, 409);
    const out = await res.json();
    assert.equal(out.gate.code, "NO_PLAN");
    assert.equal(existsSync(join(root, "productions/promo/ledger.json")), false);
  } finally {
    server.close();
  }
});

test("POST /api/new 建官方骨架", async () => {
  const root = makeProject();
  const { server, base } = await listen(root);
  try {
    const res = await fetch(`${base}/api/new`, { method: "POST", body: JSON.stringify({ production: "second", budgetCny: 3 }) });
    assert.equal(res.status, 200);
    assert.ok(existsSync(join(root, "productions/second/BRIEF.md")));
    const prod = JSON.parse(readFileSync(join(root, "productions/second/workbench.json"), "utf8"));
    assert.equal(prod.budgetCny, 3);
  } finally {
    server.close();
  }
});

test("POST /api/get 落盘并返回相对路径（get 不是 JSON 也不崩）", async () => {
  const root = makeProject();
  const server = createAppServer({
    root,
    deps: {
      hypit: async (args) => {
        if (args[0] === "get") {
          const to = args[args.indexOf("--to") + 1];
          writeFileSync(to, Buffer.alloc(2048, 7));
          return { code: 0, stdout: `+ Exported gen.video → ${to}\n`, stderr: "", json: null };
        }
        return { code: 0, stdout: "", stderr: "", json: { format: "hypit.cli-builds@1", builds: [] } };
      },
    },
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const res = await fetch(`${base}/api/get`, { method: "POST", body: JSON.stringify({ buildId: "bld_x", output: "gen.video", production: "promo" }) });
    assert.equal(res.status, 200);
    const out = await res.json();
    assert.equal(out.path, "productions/promo/results/gen.video");
    assert.ok(existsSync(join(root, out.path)));
  } finally {
    server.close();
  }
});

test("POST /api/get 不填 output 时用 status 的 targets[0]", async () => {
  const root = makeProject();
  const server = createAppServer({
    root,
    deps: {
      hypit: async (args) => {
        if (args[0] === "status") {
          return { code: 0, stdout: "", stderr: "", json: { format: "hypit.cli-status@1", build: { id: "bld_x", targets: ["gen.video"], work: {}, result: {} } } };
        }
        if (args[0] === "get") {
          writeFileSync(args[args.indexOf("--to") + 1], Buffer.alloc(2048, 1));
          return { code: 0, stdout: "+ Exported gen.video\n", stderr: "", json: null };
        }
        return { code: 0, stdout: "", stderr: "", json: { builds: [] } };
      },
    },
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const res = await fetch(`${base}/api/get`, { method: "POST", body: JSON.stringify({ buildId: "bld_x", production: "promo" }) });
    assert.equal(res.status, 200);
    const out = await res.json();
    assert.equal(out.output, "gen.video");
    assert.ok(existsSync(join(root, out.path)));
  } finally {
    server.close();
  }
});

test("价目拿不到 → 502 PRICE_UNKNOWN（不是「免费」）", async () => {
  const root = makeProject();
  const server = createAppServer({
    root,
    deps: { hypit: async (args) => (args[0] === "pricing"
      ? { code: 1, stdout: "", stderr: "network unreachable", json: null }
      : { code: 0, stdout: "", stderr: "", json: { format: "hypit.cli-builds@1", builds: [] } }) },
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const res = await fetch(`${base}/api/price`, { method: "POST", body: JSON.stringify({ run: "productions/promo/runs/build.svrun" }) });
    assert.equal(res.status, 502);
    const out = await res.json();
    assert.equal(out.error.code, "PRICE_UNKNOWN");
    assert.match(out.error.message, /network unreachable/);
  } finally {
    server.close();
  }
});

test("GET /api/media 越界被拒，静态页存在", async () => {
  const root = makeProject();
  const { server, base } = await listen(root);
  try {
    const idx = await fetch(`${base}/`);
    assert.equal(idx.status, 200);
    assert.match(await idx.text(), /Hypit Workbench/);
    const bad = await fetch(`${base}/api/media?path=${encodeURIComponent("../x.mp4")}`);
    assert.equal(bad.status, 400);

    // 官方 output 常无扩展名：按文件头给 video/mp4
    const fake = Buffer.alloc(64);
    fake.writeUInt32BE(24, 0);
    fake.write("ftypisom", 4, "latin1");
    writeFileSync(join(root, "productions/promo/results/gen.video"), fake);
    const media = await fetch(`${base}/api/media?path=productions/promo/results/gen.video`);
    assert.equal(media.status, 200);
    assert.equal(media.headers.get("content-type"), "video/mp4");

    // 页面靠 kind 选播放器：无扩展名的官方产物也要标成 video
    const st = await (await fetch(`${base}/api/state`)).json();
    const res = st.productions[0].results.find((r) => r.name === "gen.video");
    assert.equal(res.kind, "video");
  } finally {
    server.close();
  }
});
