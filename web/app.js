// 原生 ES module，无框架。页面状态每次刷新都重新从 /api/state 派生，不在前端缓存事实。
const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmtTime = (iso) => (iso ? new Date(iso).toLocaleString("zh-CN", { hour12: false }) : "—");
const kb = (n) => (n == null ? "" : n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

const state = { data: null, tab: "files", file: "", timers: {} };

async function api(path, opts = {}) {
  const res = await fetch(path, { headers: { "content-type": "application/json" }, ...opts });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `${res.status} ${res.statusText}`);
  return data;
}
const post = (path, data) => api(path, { method: "POST", body: JSON.stringify(data) });

function log(line) {
  const box = $("#log");
  box.textContent = `${new Date().toLocaleTimeString("zh-CN", { hour12: false })}  ${line}\n${box.textContent}`.slice(0, 8000);
}

function setTab(name) {
  state.tab = name;
  for (const b of document.querySelectorAll("#tabs button")) b.classList.toggle("on", b.dataset.tab === name);
  for (const s of document.querySelectorAll(".tab")) s.classList.toggle("on", s.id === `tab-${name}`);
}

async function load() {
  state.data = await api("/api/state");
  $("#projName").textContent = state.data.project?.name || "（不在项目里）";
  $("#projRoot").textContent = state.data.project?.root || "";
  $("#buildsMsg").textContent = state.data.buildsError || "";
  renderTree();
  renderBuilds();
  renderResults();
  renderLedger();
}

function renderTree() {
  const box = $("#tree");
  const prods = state.data?.productions || [];
  if (!prods.length) {
    box.innerHTML = `<p class="dim">还没有 production。左边新建一个。</p>`;
    return;
  }
  box.innerHTML = prods.map((p) => {
    const files = ["BRIEF.md", "TREATMENT.md", "PROGRESS.md"].map((f) => {
      const rel = `productions/${p.name}/${f}`;
      return `<a class="file" data-file="${esc(rel)}">${f}</a>`;
    }).join("");
    const runs = p.runs.map((r) => `
      <div class="run">
        <a class="file" data-file="${esc(r.relPath)}">${esc(r.relPath.split("/").slice(-2).join("/"))}</a>
        <span class="dim">${kb(r.bytes)}</span>
        <div class="runacts">
          <button data-act="check" data-run="${esc(r.relPath)}" data-prod="${esc(p.name)}">检查</button>
          <button data-act="plan" data-run="${esc(r.relPath)}" data-prod="${esc(p.name)}">计划</button>
          <button data-act="price" data-run="${esc(r.relPath)}" data-prod="${esc(p.name)}">报价</button>
          <button data-act="studio" data-run="${esc(r.relPath)}">审片</button>
          <input class="est" data-est="${esc(r.relPath)}" type="number" min="0" step="0.5" placeholder="估算 ¥" />
          <button class="primary" data-act="build" data-run="${esc(r.relPath)}" data-prod="${esc(p.name)}">构建</button>
        </div>
      </div>`).join("");
    return `<div class="prod"><div class="prodhead"><b>${esc(p.name)}</b><span class="dim">预算 ¥${p.budgetCny}</span></div>
      <div class="files">${files}</div>${runs || `<p class="dim">没有 run</p>`}</div>`;
  }).join("");
}

function renderBuilds() {
  const tbody = $("#buildsTable tbody");
  const builds = state.data?.builds || [];
  tbody.innerHTML = builds.length
    ? builds.map((b) => `<tr data-build="${esc(b.id)}">
        <td><code>${esc(b.id)}</code></td>
        <td>${esc(fmtTime(b.createdAt))}</td>
        <td><span class="badge ${esc(b.outcome)}">${esc(b.outcome || "?")}</span></td>
        <td>${esc(b.outputCount ?? 0)} 个</td>
        <td class="ops">
          <button data-act="status">状态</button>
          <input class="out" placeholder="输出名，不填自动取 targets[0]" value="${esc(b.targets?.[0] || "")}" />
          <button data-act="get">取回</button>
          <select class="verdict"><option value="pending">pending</option><option value="approved">approved</option><option value="rejected">rejected</option></select>
          <button data-act="review">审</button>
        </td>
      </tr>`).join("")
    : `<tr><td colspan="5" class="dim">还没有 build（官方 builds 为空）</td></tr>`;
}

// 类型由服务端按文件头判定（kind），不能只看扩展名：官方 output 常是 gen.video 这种无后缀名。
function mediaBlock(item) {
  const src = `/api/media?path=${encodeURIComponent(item.rel)}`;
  if (item.kind === "video") return `<video src="${src}" controls preload="metadata"></video>`;
  if (item.kind === "image") return `<img src="${src}" alt="${esc(item.name)}" />`;
  if (item.kind === "audio") return `<audio src="${src}" controls></audio>`;
  return `<a href="${src}" target="_blank" rel="noreferrer">${esc(item.name)}</a>`;
}

function renderResults() {
  const box = $("#results");
  const prods = state.data?.productions || [];
  const rows = prods.flatMap((p) => p.results.map((r) => ({ ...r, prod: p.name })));
  box.innerHTML = rows.length
    ? rows.map((r) => `<figure class="res"><figcaption><b>${esc(r.name)}</b><span class="dim">${esc(r.prod)} · ${kb(r.bytes)} · ${esc(fmtTime(r.mtime))}</span></figcaption>${mediaBlock(r)}</figure>`).join("")
    : `<p class="dim">还没有取回的产物。Builds 里点「取回」。</p>`;
}

function renderLedger() {
  const box = $("#ledger");
  const prods = state.data?.productions || [];
  box.innerHTML = prods.map((p) => {
    const rows = p.ledger.entries.map((e) => `<tr data-entry="${esc(e.buildId || e.at)}" data-prod="${esc(p.name)}">
      <td><code>${esc(e.buildId || "（未回填）")}</code></td>
      <td>${esc(e.run)}</td>
      <td>${e.providerRequests}</td>
      <td>${e.estimateCny == null ? "—" : `¥${e.estimateCny}`}</td>
      <td><input class="actual" type="number" step="0.1" min="0" placeholder="实付" value="${e.actualCny ?? ""}" /></td>
      <td><button data-act="saveLedger">存</button></td>
    </tr>`).join("");
    return `<h4>${esc(p.name)} <span class="dim">估算 ¥${p.ledger.totals.estimateCny} · 实付 ¥${p.ledger.totals.actualCny} · 待核 ${p.ledger.totals.open}</span></h4>
      <table class="grid"><thead><tr><th>build</th><th>run</th><th>付费请求</th><th>估算</th><th>实付（人工核对）</th><th></th></tr></thead><tbody>${rows || `<tr><td colspan="6" class="dim">暂无</td></tr>`}</tbody></table>`;
  }).join("") || `<p class="dim">还没有 production。</p>`;
}

async function preview(rel) {
  try {
    const data = await api(`/api/file?path=${encodeURIComponent(rel)}`);
    state.file = rel;
    $("#fileTitle").textContent = rel;
    $("#fileBytes").textContent = kb(data.bytes);
    $("#fileBody").textContent = data.text;
    setTab("files");
  } catch (err) {
    $("#fileBody").textContent = `打不开：${err.message}`;
    setTab("files");
  }
}

async function runAction(act, runRel, prod, row) {
  const est = $(`input[data-est="${CSS.escape(runRel)}"]`)?.value;
  if (act === "build") {
    const estimateCny = est === "" ? null : Number(est);
    if (estimateCny == null) {
      log(`构建 ${runRel}：先填估算（人确认的 ¥）——官方不出总价`);
      return;
    }
    log(`构建 ${runRel}：估算 ¥${estimateCny}，过闸门中…`);
    const out = await post("/api/build", { run: runRel, estimateCny });
    log(`已提交 ${out.buildId}（预算 ¥${out.gate.budgetCny}，付费请求 ${out.gate.providerRequests}）。正在观察状态…`);
    await load();
    pollStatus(out.buildId);
    return;
  }
  if (act === "check") {
    const out = await post("/api/check", { run: runRel });
    log(`检查 ${runRel}：${out.ok ? "通过" : `失败（exit ${out.code}）`}\n${out.output}`);
    return;
  }
  if (act === "plan") {
    const s = await post("/api/plan", { run: runRel });
    log(`计划 ${runRel}：targets ${s.targets.length}、请求 ${s.requests.total}（provider ${s.providers.filter((p) => !p.local).length}）、待填输入 ${s.needs.length}\n` +
      s.providers.map((p) => `· ${p.capability} → ${p.endpoint || "(本地)"}${p.binding ? ` binding=${p.binding}` : ""}${p.pricingUrl ? ` ${p.pricingUrl}` : ""}`).join("\n"));
    return;
  }
  if (act === "price") {
    let s;
    try {
      s = await post("/api/price", { run: runRel });
    } catch (err) {
      log(`价目未知（不是免费）：${err.message}\nplan 仍可用；构建前必须有报价，否则闸门会拦。`);
      return;
    }
    if (!s.groups.length) {
      log(`报价 ${runRel}：全部本地，0 付费请求（${s.requests.total} 个请求，${s.noCharge} 个不收费）`);
      return;
    }
    log(`报价 ${runRel}：${s.groups.length} 组\n` + s.groups.map((g) => `· ${g.capability} ${g.pricingUrl || ""}\n  ${g.documents.map((d) => d.summary).join("\n  ")}`).join("\n"));
    return;
  }
  if (act === "studio") {
    await post("/api/studio", { run: runRel });
    log(`已拉起官方 studio（${runRel}），看终端里的地址。`);
  }
}

async function pollStatus(id, tries = 90) {
  const out = await api(`/api/status?id=${encodeURIComponent(id)}`);
  const b = out.build;
  if (!b) {
    if (tries > 0) state.timers[id] = setTimeout(() => pollStatus(id, tries - 1), 3000);
    return;
  }
  const done = ["complete", "failed", "cancelled"].includes(b.work.outcome);
  log(`状态 ${id}：${b.work.state}/${b.work.outcome || "…"}，产物 ${b.result.state}（${b.result.outputCount}）${b.failure ? `，失败：${b.failure}` : ""}`);
  if (done) {
    await load();
    if (b.result.outputCount > 0) log(`完成。到 Builds 里填输出名点「取回」，然后发给人看。`);
    return;
  }
  if (tries > 0) state.timers[id] = setTimeout(() => pollStatus(id, tries - 1), 3000);
}

document.addEventListener("click", async (ev) => {
  const btn = ev.target.closest("button[data-act]");
  if (btn) {
    const act = btn.dataset.act;
    try {
      if (act === "status") {
        const id = btn.closest("tr").dataset.build;
        const out = await api(`/api/status?id=${encodeURIComponent(id)}`);
        const target = out.build?.targets?.[0];
        if (target && !$(".out", btn.closest("tr")).value) $(".out", btn.closest("tr")).value = target;
        log(`状态 ${id}：${JSON.stringify(out.build?.work || out, null, 0)}${target ? ` · output ${target}` : ""}`);
      } else if (act === "get") {
        const tr = btn.closest("tr");
        const buildId = tr.dataset.build;
        const output = $(".out", tr).value.trim();
        if (!output) return log("先填输出名（run 里 target 的 output，如 gen.video）");
        const out = await post("/api/get", { buildId, output });
        log(`已取回 ${out.path}${out.renamed ? "（旧文件保留，新文件加 build 后缀）" : ""}`);
        await load();
        setTab("results");
      } else if (act === "review") {
        const tr = btn.closest("tr");
        const out = $(".out", tr);
        const review = await post("/api/review", {
          buildId: tr.dataset.build,
          output: out.value.trim() || "?",
          verdict: $(".verdict", tr).value,
          note: "",
        });
        log(`已写 review：${tr.dataset.build} → ${review.item.verdict}（${review.path}）`);
      } else if (act === "saveLedger") {
        const tr = btn.closest("tr");
        const production = tr.dataset.prod;
        const summary = await post("/api/ledger", { production, buildId: tr.dataset.entry, actualCny: $(".actual", tr).value });
        log(`已记实付：${production}（合计估算 ¥${summary.totals.estimateCny} / 实付 ¥${summary.totals.actualCny}）`);
        await load();
      } else {
        const runRel = btn.dataset.run;
        const prod = btn.dataset.prod;
        await runAction(act, runRel, prod);
      }
    } catch (err) {
      log(`失败：${err.message}`);
    }
    return;
  }
  const file = ev.target.closest("a[data-file]");
  if (file) preview(file.dataset.file);
});

$("#tabs").addEventListener("click", (ev) => {
  const b = ev.target.closest("button[data-tab]");
  if (b) setTab(b.dataset.tab);
});
$("#refresh").addEventListener("click", () => load().catch((e) => log(`刷新失败：${e.message}`)));
$("#newForm").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  try {
    const out = await post("/api/new", { production: $("#newName").value.trim(), budgetCny: $("#newBudget").value });
    $("#newMsg").textContent = `已建 ${out.dir}`;
    $("#newName").value = "";
    await load();
  } catch (err) {
    $("#newMsg").textContent = `失败：${err.message}`;
  }
});

setTab("files");
load().catch((e) => { $("#tree").innerHTML = `<p class="err">${esc(e.message)}</p>`; });
