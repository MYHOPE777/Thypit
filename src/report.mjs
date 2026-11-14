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
  const groups = (json.groups || []).map((g) => ({
    capability: String(g.capability || ""),
    endpoint: String(g.endpoint || ""),
    use: String(g.use || ""),
    status: String(g.status || ""),
    binding: String(g.binding || ""),
    pricingKind: String(g.pricing?.kind || ""),
    pricingUrl: String(g.pricing?.url || ""),
    requests: Array.isArray(g.requests) ? g.requests.length : 0,
    documents: (g.pricingDocuments || []).map((d) => ({
      source: String(d.source || ""),
      summary: String(d.summary || ""),
    })),
  }));
  return {
    format: "twb.pricing@1",
    run: String(json.run || ""),
    requests: num(json.requestCount),
    noCharge: num(json.noChargeRequestCount),
    groups,
    producerFailures: Array.isArray(json.producerFailures) ? json.producerFailures : [],
  };
}

function num(v) {
  return Number.isFinite(Number(v)) ? Number(v) : 0;
}
