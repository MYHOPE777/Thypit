# AGENTS.md · Thypit 工作规则

> 接手前先读这一页。只写「不了解背景容易做反」的事。

## 1. 这个仓库是什么

Hypit 官方项目目录的薄工作台。文件是唯一真相；生成、报价、构建、取回、审片全部走官方 CLI（`hypit ...`）。设计见 `DESIGN.md`。

**不要**把引擎逻辑、provider 适配、prompt 编译器搬进来；也不要克隆官方源码进仓库——官方发行版自带源码，读 `node_modules/@hypit/hypit/packages/*/src` 即可。

## 2. 每次生成的文件必须先给用户看

- 任何 `hypit build` / `twb get` 产出的视频、图片、音频、成片，**每次都要发给用户检查**（给绝对路径 + 文件，或 `present`），并说清时长/分辨率/用了哪个 build。
- **AI 不自判通过**：`review.json` 的 `verdict` 默认 `pending`，只有用户明确说「通过/可以」才写 `approved`，说「不行/重做」才写 `rejected`。
- 检查通过之前，不要继续下一步（换镜、拼版、投放包、发布）。

## 3. 预算与闸门

- `plan` → `price` → `build` 顺序不可颠倒；有付费请求必须 `--estimate <cny>`；估算超 `budgetCny` 拒绝。
- 闸门在 `src/gate.mjs`；`build` 前必须写 `ledger.json`（失败也留痕）。
- 真实花钱的验证（哪怕 ¥0.5）先跟用户确认，再跑。

## 4. 改动后至少跑

```bash
npm test        # node --test，零依赖
```

改完跑绿后 commit + push `origin master`；只提交代码（`.gitignore` 已挡 `node_modules/`、`.hypit/`、`.gen/`、`.twb/`、媒体文件、`projects/`、`results/`）。

## 5. 状态从哪来

- Build 状态、产物：现查官方（`hypit status --json` / `hypit get`），不缓存副本。
- 审核：`productions/<t>/review.json`（只记某个 build 的某个 output）。
- 花费：`productions/<t>/ledger.json`（估算人填，实付人工核对后填）。
- 预算：`productions/<t>/workbench.json` 的 `budgetCny`（缺省 10）。
- `.twb/state/` 只是 plan/price 的派生快照（含 run mtime），可随时删。
