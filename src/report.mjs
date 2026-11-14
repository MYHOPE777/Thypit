// 把官方 --json 收敛成我们自己的稳定格式（twb.plan@1 / twb.pricing@1）。
// 只做搬运与计数，不做价格换算——Hypit 不算总价，我们也不发明总价。

export function planSummary(json = {}) {
  const providers = (json.providers || []).map((p) => ({
    capability: String(p.capability || ""),
    endpoint: String(p.endpoint || ""),
    use: String(p.use || ""),
    status: String(p.status || ""),
    binding: String(p.binding || ""),
    pricingKind: String(p.pricing?.kind || ""),
    pricingUrl: String(p.pricing?.url || ""),
  }));
  const needs = (json.needs || []).map((n) => ({
    capability: String(n.capability || ""),
    endpoint: String(n.endpoint || ""),
    port: String(n.port || ""),
    fields: n.summary?.fields && typeof n.summary.fields === "object" ? n.summary.fields : {},
  }));
  return {
    format: "twb.plan@1",
    run: String(json.run || ""),
    ok: json.ok === true,
    targets: Array.isArray(json.targets) ? json.targets.map(String) : [],
    requests: {
      total: num(json.requestCount),
      provider: num(json.providerRequestCount),
      local: num(json.localRequestCount),
      unresolved: num(json.unresolvedRequestCount),
      unsupported: num(json.unsupportedRequestCount),
      issues: num(json.requestIssueCount),
    },
    providers,
    needs,
    producerFailures: Array.isArray(json.producerFailures) ? json.producerFailures : [],
  };
}

export function pricingSummary(json = {}) {
  const groups = (json.groups || []).map((g) => {
    const documents = (g.pricingDocuments || []).map((d) => ({
      source: String(d.source || ""),
      summary: String(d.summary || ""),
      free: d?.data?.pricing?.free === true,
    }));
    return {
      capability: String(g.capability || ""),
      endpoint: String(g.endpoint || ""),
      use: String(g.use || ""),
      status: String(g.status || ""),
      binding: String(g.binding || ""),
      pricingKind: String(g.pricing?.kind || ""),
      pricingUrl: String(g.pricing?.url || ""),
      requests: Array.isArray(g.requests) ? g.requests.length : 0,
      free: documents.length > 0 && documents.every((d) => d.free),
      documents,
    };
  });
  const free = groups.length > 0 && groups.every((g) => g.free);
  return {
    format: "twb.pricing@1",
    run: String(json.run || ""),
    requests: num(json.requestCount),
    noCharge: num(json.noChargeRequestCount),
    free,
    freeRequests: groups.filter((g) => g.free).reduce((n, g) => n + g.requests, 0),
    groups,
    producerFailures: Array.isArray(json.producerFailures) ? json.producerFailures : [],
  };
}

function num(v) {
  return Number.isFinite(Number(v)) ? Number(v) : 0;
}

export function statusSummary(json = {}) {
  const b = json?.build;
  if (!b) return { format: "twb.status@1", found: false, build: null };
  return {
    format: "twb.status@1",
    found: true,
    build: {
      id: String(b.id || ""),
      title: String(b.title || ""),
      targets: Array.isArray(b.targets) ? b.targets.map(String) : [],
      work: {
        state: String(b.work?.state || "unknown"),
        outcome: String(b.work?.outcome || ""),
        requests: b.work?.requests ? { total: num(b.work.requests.total), completed: num(b.work.requests.completed) } : null,
      },
      result: { state: String(b.result?.state || "missing"), outputCount: num(b.result?.outputCount) },
      failure: String(b.failure || ""),
      attention: String(b.attention?.message || ""),
      operations: (b.operations || []).map((o) => ({
        endpoint: String(o.endpoint || ""),
        state: String(o.state || ""),
        count: o.count == null ? null : num(o.count),
        failure: String(o.failure?.message || ""),
      })),
    },
  };
}

export function ledgerSummary(production, ledger = {}) {
  const entries = (ledger.entries || []).map((e) => ({
    buildId: String(e.buildId || ""),
    run: String(e.run || ""),
    plannedRequests: num(e.plannedRequests),
    providerRequests: num(e.providerRequests),
    estimateCny: e.estimateCny == null ? null : Number(e.estimateCny),
    actualCny: e.actualCny == null ? null : Number(e.actualCny),
    note: String(e.note || ""),
    at: String(e.at || ""),
  }));
  const estimateCny = round2(entries.reduce((s, e) => s + (e.estimateCny || 0), 0));
  const actualCny = round2(entries.reduce((s, e) => s + (e.actualCny || 0), 0));
  const open = entries.filter((e) => e.actualCny == null).length;
  return { format: "twb.ledger@1", production, entries, totals: { count: entries.length, estimateCny, actualCny, open } };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
