// 人读输出。所有数字/路径都来自 summary，这里不做推断。

export function renderList(out = {}) {
  if (!out.project) return out.hint || "不在 Hypit 项目里";
  const p = out.project;
  const lines = [];
  lines.push(`${p.name} · ${p.root}`);
  if (p.runtime) lines.push(`runtime: ${p.runtime}`);
  lines.push("");
  lines.push(`Productions (${out.productions.length}):`);
  if (!out.productions.length) lines.push("  (none)");
  for (const prod of out.productions) {
    const marks = [prod.files.brief ? "BRIEF ✓" : "BRIEF ✗", prod.files.treatment ? "TREATMENT ✓" : "TREATMENT ✗"]
      .join(" · ");
    lines.push(`  ${prod.name}  ${marks} · runs ${prod.runs.length}`);
    for (const r of prod.runs) lines.push(`    - ${r.relPath}  ${kb(r.bytes)}`);
  }
  lines.push("");
  lines.push(`References (${out.references.length}): ${out.references.map((r) => r.name).join(", ") || "(none)"}`);
  return lines.join("\n");
}

export function renderPlan(s = {}) {
  const lines = [];
  lines.push(`run ${s.run || "?"} · plan ${s.ok ? "ok" : "NOT ok"}`);
  lines.push(`targets: ${s.targets.join(", ") || "(none)"}`);
  const q = s.requests;
  lines.push(`requests: ${q.total} total · ${q.provider} provider · ${q.local} local · ${q.unresolved} unresolved · ${q.issues} issues`);
  lines.push(`providers (${s.providers.length}):`);
  if (!s.providers.length) lines.push("  (none)");
  for (const p of s.providers) {
    const price = p.pricingKind === "page" ? ` [page ${p.pricingUrl || "?"}]` : ` [${p.pricingKind || "?"}]`;
    const bind = p.binding ? `  binding=${p.binding}` : "";
    lines.push(`  ${p.capability} → ${p.endpoint}${price}${bind}`);
  }
  lines.push(`needs (${s.needs.length}):`);
  if (!s.needs.length) lines.push("  (none)");
  s.needs.forEach((n, i) => {
    const f = n.fields;
    const bits = [];
    if (f.duration != null) bits.push(`${f.duration}s`);
    if (f.resolution) bits.push(String(f.resolution));
    if (f.prompt) bits.push(`"${clip(String(f.prompt), 60)}"`);
    lines.push(`  ${i + 1}. ${n.capability}${bits.length ? "  " + bits.join(" · ") : ""}`);
  });
  for (const f of s.producerFailures || []) lines.push(`! producer failure: ${String(f?.message || f)}`);
  return lines.join("\n");
}

export function renderPricing(s = {}) {
  const lines = [];
  lines.push(`run ${s.run || "?"} · ${s.requests} request(s) · ${s.noCharge} no charge`);
  if (!s.groups.length) {
    lines.push("no chargeable requests (all local or free)");
  } else {
    lines.push(`groups (${s.groups.length}):`);
    for (const g of s.groups) {
      const price = g.pricingKind === "page" ? `page ${g.pricingUrl || "?"}` : g.pricingKind || "?";
      lines.push(`  ${g.capability} → ${g.endpoint}  [${price}]  ×${g.requests}${g.binding ? `  binding=${g.binding}` : ""}`);
      for (const d of g.documents) if (d.summary) lines.push(`    - ${d.summary} (${d.source})`);
    }
  }
  for (const f of s.producerFailures || []) lines.push(`! producer failure: ${String(f?.message || f)}`);
  return lines.join("\n");
}

function clip(text, n) {
  return text.length > n ? text.slice(0, n - 1) + "…" : text;
}

function kb(bytes) {
  const n = Number(bytes) || 0;
  return n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`;
}

export function renderStatus(s = {}) {
  if (!s.found) return "build 不存在（status --json 没有返回 build）";
  const b = s.build;
  const lines = [];
  lines.push(`${b.id}${b.title ? ` · ${b.title}` : ""}`);
  lines.push(`work: ${b.work.state}${b.work.outcome ? ` (${b.work.outcome})` : ""}${b.work.requests ? ` · requests ${b.work.requests.completed}/${b.work.requests.total}` : ""}`);
  lines.push(`result: ${b.result.state}${b.result.outputCount ? ` · ${b.result.outputCount} output(s)` : ""}`);
  if (b.targets.length) lines.push(`targets: ${b.targets.join(", ")}`);
  if (b.failure) lines.push(`failure: ${b.failure}`);
  if (b.attention) lines.push(`attention: ${b.attention}`);
  for (const o of b.operations) lines.push(`  ${o.endpoint}: ${o.state}${o.count == null ? "" : ` ×${o.count}`}${o.failure ? ` — ${o.failure}` : ""}`);
  return lines.join("\n");
}

export function renderGate(g = {}) {
  const lines = [];
  if (g.ok) {
    lines.push(`gate ok · 预算 ¥${g.budgetCny} · 估算 ¥${g.estimateCny ?? 0} · 付费请求 ${g.providerRequests}`);
    return lines.join("\n");
  }
  lines.push(`gate 拒绝（${g.code}）`);
  for (const r of g.reasons) lines.push(`  - ${r}`);
  return lines.join("\n");
}

export function renderLedger(s = {}) {
  const lines = [];
  lines.push(`${s.production} · ${s.totals.count} 条 · 估算 ¥${s.totals.estimateCny} · 实付 ¥${s.totals.actualCny} · 待填 ${s.totals.open}`);
  for (const e of s.entries) {
    const id = e.buildId || "(未 build)";
    const pay = `估算 ${e.estimateCny == null ? "?" : `¥${e.estimateCny}`} / 实付 ${e.actualCny == null ? "?" : `¥${e.actualCny}`}`;
    lines.push(`  ${e.at}  ${id}  ${pay}${e.note ? `  ${e.note}` : ""}`);
  }
  return lines.join("\n");
}

export function renderNew(out = {}) {
  return [`已建 productions/${out.production}（预算 ¥${out.budgetCny}）`, ...out.created.map((c) => `  + ${c}`)].join("\n");
}
