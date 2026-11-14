# Thypit

Hypit 官方项目目录的薄工作台：文件是唯一真相，生成/报价/构建/取回全部走官方 CLI，交付只走官方 `film`/`html` 作者。

设计见 [DESIGN.md](DESIGN.md)。

## 现在能做什么（M0–M2）

```bash
node bin/twb.mjs list [--project <目录>] [--json]   # 项目 / productions / runs 盘点
node bin/twb.mjs new <production> [--budget 10]     # 官方骨架（BRIEF/TREATMENT/PROGRESS + 四个空目录）
node bin/twb.mjs check <run>                        # hypit check，原样透传（免费）
node bin/twb.mjs plan  <run> [--json]               # hypit plan --json，汇总请求与 provider（免费，落状态快照）
node bin/twb.mjs price <run> [--json]               # hypit pricing --json，价目与文档摘要（只读网络）
node bin/twb.mjs build <run> --estimate 0.55        # 过闸门 → build → status --watch
node bin/twb.mjs status <buildId> [--watch]         # hypit status --json
node bin/twb.mjs get <buildId> --output gen.video   # 取回 productions/<t>/results/
node bin/twb.mjs review <buildId> gen.video --verdict approved --note "..."  # 写 review.json
node bin/twb.mjs ledger <production> [--add 3.9 --build <id>]                # 花费汇总 / 记实付
node bin/twb.mjs serve [--port 4790]                                         # 本地 Web 工作台（127.0.0.1）
```

## 本地 Web（M2）

`twb serve` 在本机回环起一个页面（默认 `http://127.0.0.1:4790`），不写任何新状态：

- 左侧：项目树（`BRIEF/TREATMENT/PROGRESS`、runs、每个 run 的 检查/计划/报价/审片/构建）。
- 文件：点 `.md`/`.svml`/`.svrun`/`.json` 预览原文。
- Builds：`hypit builds --json` 列表；提交后轮询 `status --json`；填输出名点「取回」落到 `results/`。
- 产物：`results/` 里的 mp4/图片直接播放（走 `/api/media`）。
- 花费：`ledger.json` 表格，实付人工核对后填。
- 审片：调 `hypit studio <run>`（官方界面）；`review.json` 结论在 Builds 行里写。

页面不做的事：不缓存 build 状态、不起后台任务、不合并 review 与官方 Result 生命周期。

## 规则

- 项目根 = 含 `package.json` 且 `"hypit": {"project": true}` 的目录；`--project` 可指定，否则从当前目录向上找。
- hypit 可执行文件查找顺序：`--hypit` → `HYPIT_BIN` → 项目内 `node_modules/.bin/hypit` → 向上逐级 → `PATH`。
- **预算闸门**（`src/gate.mjs`）：必须先 `plan` + `price`，run 改过就作废；有付费请求必须 `--estimate <cny>`（官方不合计总价，工作台也不替你估）；估算 > `productions/<t>/workbench.json` 的 `budgetCny`（缺省 10）则拒绝，并给出差额。
- 闸门通过后先写 `ledger.json`（含估算），再提交 build；失败也留痕。
- `get` 默认写 `productions/<t>/results/<output>`；目标已存在时改用 `<output>.<buildId 末 8 位>`（同名再取回继续加 `-2`），不覆盖旧文件（`--force` 才覆盖）。
- `review.json` 只记「某个 build 的某个 output」的结论（`approved|rejected|pending`），不引入项目级审核状态。
- `.twb/state/` 只是 plan/price 的派生快照（含 run 的 mtime），可随时删；真事实在官方文件与 `ledger.json`。

## 开发

```bash
npm test    # node --test，零依赖
```
