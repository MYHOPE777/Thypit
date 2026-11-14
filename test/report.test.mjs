import { test } from "node:test";
import assert from "node:assert/strict";
import { planSummary, pricingSummary } from "../src/report.mjs";

const PLAN = {
  format: "hypit.cli-plan@1",
  ok: true,
  run: ".gen/chk-h3.svrun",
  targets: ["final.video"],
  requestCount: 3,
  requestIssueCount: 0,
  producerFailureCount: 0,
  producerFailures: [],
  providerRequestCount: 1,
  localRequestCount: 2,
  unresolvedRequestCount: 0,
  unsupportedRequestCount: 0,
  providers: [
    {
      request: "need:x",
      capability: "@hypit/minimax-h3@1#minimax-h3",
      status: "resolved",
      endpoint: "metaso.minimax-h3",
      use: "@local/provider-metaso",
      pricing: { kind: "page", url: "https://metaso.cn" },
      binding: "metaso.minimax-h3",
    },
    {
      request: "need:y",
      capability: "@hypit/media-operations@1#render-timeline-audio",
      status: "resolved",
      endpoint: "media.local",
      use: "@hypit/media-local",
      pricing: { kind: "local" },
    },
  ],
  needs: [
    {
      capability: "@hypit/minimax-h3@1#minimax-h3",
      endpoint: "metaso.minimax-h3",
      port: "generation",
      summary: { fields: { prompt: "妈妈在厨房抬头看镜头", duration: 4, resolution: "768P" } },
    },
  ],
};

test("planSummary 计数与 provider 映射", () => {
  const s = planSummary(PLAN);
  assert.equal(s.format, "twb.plan@1");
  assert.equal(s.ok, true);
  assert.deepEqual(s.targets, ["final.video"]);
  assert.deepEqual(s.requests, { total: 3, provider: 1, local: 2, unresolved: 0, unsupported: 0, issues: 0 });
  assert.equal(s.providers[0].capability, "@hypit/minimax-h3@1#minimax-h3");
  assert.equal(s.providers[0].pricingKind, "page");
  assert.equal(s.providers[0].pricingUrl, "https://metaso.cn");
  assert.equal(s.providers[1].pricingKind, "local");
  assert.equal(s.needs[0].fields.prompt, "妈妈在厨房抬头看镜头");
});

test("planSummary 对空对象不炸", () => {
  const s = planSummary({});
  assert.equal(s.ok, false);
  assert.deepEqual(s.requests, { total: 0, provider: 0, local: 0, unresolved: 0, unsupported: 0, issues: 0 });
  assert.deepEqual(s.providers, []);
});

const PRICING = {
  format: "hypit.cli-pricing@1",
  run: ".gen/chk-h3.svrun",
  requestCount: 1,
  noChargeRequestCount: 0,
  groups: [
    {
      capability: "@hypit/minimax-h3@1#minimax-h3",
      status: "resolved",
      endpoint: "metaso.minimax-h3",
      use: "@local/provider-metaso",
      pricing: { kind: "page", url: "https://metaso.cn" },
      binding: "metaso.minimax-h3",
      pricingDocuments: [
        { source: "https://metaso.cn", data: {}, summary: "Metaso MiniMax H3 credits: 768P=10.2/s" },
      ],
      requests: [{ request: "need:x" }],
    },
  ],
  producerFailureCount: 0,
  producerFailures: [],
};

test("pricingSummary 保留文档摘要与请求数", () => {
  const s = pricingSummary(PRICING);
  assert.equal(s.format, "twb.pricing@1");
  assert.equal(s.requests, 1);
  assert.equal(s.noCharge, 0);
  assert.equal(s.groups.length, 1);
  assert.equal(s.groups[0].requests, 1);
  assert.equal(s.groups[0].pricingKind, "page");
  assert.deepEqual(s.groups[0].documents, [
    { source: "https://metaso.cn", summary: "Metaso MiniMax H3 credits: 768P=10.2/s", free: false },
  ]);
});

test("pricingSummary 全本地 run 为 0 组", () => {
  const s = pricingSummary({ run: "x.svrun", requestCount: 15, noChargeRequestCount: 15, groups: [] });
  assert.equal(s.groups.length, 0);
  assert.equal(s.noCharge, 15);
});

test("pricingSummary 识别服务商声明免费（fish voice-clone）", () => {
  const s = pricingSummary({
    format: "hypit.cli-pricing@1",
    run: "runs/voice.svrun",
    requestCount: 9,
    noChargeRequestCount: 0,
    groups: [
      {
        capability: "@hypit/fishaudio-speech@1#voice-clone",
        endpoint: "hypihub.default",
        use: "@hypit/provider-hypihub",
        status: "resolved",
        pricing: { kind: "page", url: "https://hypit.ai/commercial/pricing/" },
        binding: "hypihub.default",
        pricingDocuments: [
          {
            source: "https://hypit.ai/v1/pricing?model=fishaudio%2Fvoice-clone",
            data: { model: "fishaudio/voice-clone", pricing: { currency: "usd", free: true, mode: "per_request" } },
          },
        ],
        requests: [{}, {}, {}, {}, {}, {}, {}, {}, {}],
      },
    ],
  });
  assert.equal(s.free, true);
  assert.equal(s.freeRequests, 9);
  assert.equal(s.groups[0].free, true);
  assert.equal(s.groups[0].documents[0].free, true);
});

test("pricingSummary 付费价目不算免费", () => {
  const s = pricingSummary({
    format: "hypit.cli-pricing@1",
    requestCount: 1,
    noChargeRequestCount: 0,
    groups: [
      {
        capability: "@hypit/minimax-h3@1#minimax-h3",
        pricingDocuments: [{ source: "https://metaso.cn", data: { creditsPerSec: { "768P": 10.2 } } }],
        requests: [{}],
      },
    ],
  });
  assert.equal(s.free, false);
  assert.equal(s.freeRequests, 0);
});
