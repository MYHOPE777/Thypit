# Hypit Workbench · 设计（v1，待核对）

> 一句话：**给 Hypit 官方项目目录做一层薄工作台**——文件是唯一真相，生成/报价/构建/取回全部走官方 CLI，交付只走官方 `film`/`html` 作者。不放模型池、不写 prompt、不拼成片。

- 状态：设计稿，**未写代码**
- 旧仓库 `/Users/tangsir/hypit`：只停手、保持现状，不回改、不复用代码（只复用经验与教训）
- 本仓库：`~/Thypit`，远端 `https://github.com/MYHOPE777/Thypit`
- 形态：**先 CLI（M0–M1），Web 留到 M2**

---

## 1. 目标

1. 用官方目录结构管理多个 Hypit 视频项目（Brief / Treatment / Analysis / Timeline / authors / recipes / runs / assets）。
2. 一条命令走完：`check → plan → pricing → build --follow → status → get`，每步都有结构化结果。
3. 报价先于花钱：没有 `plan + pricing` 与预算记录，不允许 `build`。
4. 交付只有一条路：官方 `film:Film` / `html:Video` 作者 → build → 导出 mp4。
5. 审片用官方 Studio（`hypit studio --run`），工作台只记「审的是哪个 build 的哪个 output」。

## 2. 非目标（v1 明确不做）

| 不做 | 原因 |
|---|---|
| 自写 prompt 编译器 | prompt 由 Agent 按 skill 写进 `recipes/`、`authors/`；工作台只读、只展示、缺文件就报 |
| 第二套成片/粗剪实现 | 只保留官方 film/html 一条交付路径；预览用官方 Studio 或 `get` 出来的片段 |
| 自有模型池 / 路由 / 比价引擎 | 模型与端点由 `hypit.runtime.json` + Provider 绑定决定；工作台只读 `plan` 与 `pricing` |
| 数据库 / ORM / 后台任务表 | 状态全部从磁盘与 `hypit builds/status` 派生，不存第二份 |
| 多用户 / 权限 / 团队 | 单机单用户 |
| 素材生成（首帧、配图） | 官方 Run/Recipe 里的生成请求；工作台提交，不代写创意 |

## 3. 官方契约（工作台只能依赖这些）

命令行（`hypit` 由项目依赖提供，不硬编码路径）：

| 用途 | 命令 | JSON 格式 |
|---|---|---|
| 语法校验 | `hypit check <source>` | 文本 + 退出码 |
| 执行计划 | `hypit plan <run> --json` | `hypit.cli-plan@1`（`targets / requestCount / providerRequestCount / providers[]`） |
| 现行价目 | `hypit pricing <run> --json` | 分组 `requests` + `pricingDocuments`（Provider 原文，Hypit 不合计） |
| 提交构建 | `hypit build <run> --title <t> --follow` | 进度文本；结束后用 status 取事实 |
| 构建列表 | `hypit builds --json` | `hypit.cli-builds@1`（`id/createdAt/outcome/run/targetCount/outputCount`） |
| 单次状态 | `hypit status <id> --json` | `hypit.cli-status@1`（`work.state/outcome`、`result.outputCount`） |
| 取回产物 | `hypit get <id> --output <name> --to <path>` | 文件 |
| 审片 | `hypit studio --run <run>` | 浏览器打开，工作台只负责启动 |
| 运行时就绪 | `hypit doctor`、`hypit programs prepare` | 文本 |

项目结构（官方 `project-files` 布局，原样采用）：

```text
<project>/
├── package.json                 # { "hypit": { "project": true } }
├── hypit.runtime.json           # Provider / binding / 真值来源
├── references/<ref>/{ANALYSIS.md,TIMELINE.md,source.*}
├── productions/<target>/
│   ├── BRIEF.md TREATMENT.md PROGRESS.md
│   ├── authors/ recipes/ runs/ assets/ drafts/
└── assets/
```

工作台自己只新增两类文件，且都在 production 目录内、名字固定、格式在 §6 定义：

- `review.json`：审核记录（哪个 build、哪个 output、结论、人、时间）
- `ledger.json`：花过的钱（plan 估算、pricing 依据、build id、实付、备注）

## 4. 架构：四层，无第五层

```text
┌ 界面（本地 Web，只读为主 + 6 个动作按钮）──────────────┐
│ 项目树 / 文件预览 / Builds / Results / Review / Ledger │
└───────────────┬────────────────────────────────────────┘
                │ HTTP（本地回环，仅 GET 与少量 POST）
┌ 驱动（src/hypit.mjs：唯一的 hypit 调用点）─────────────┐
│ check / plan / pricing / build / builds / status / get │
│ 统一超时、JSON 解析、错误映射、命令回显                  │
└───────────────┬────────────────────────────────────────┘
                │ execFile（不拼 shell 字符串）
┌ 事实（磁盘）───────────────────────────────────────────┐
│ 官方项目文件 · .hypit Results · review.json · ledger.json │
└────────────────────────────────────────────────────────┘
```

- **无数据库**：每次页面刷新重新读盘；build 状态用 `status --json` 现查，不缓存。
- **无后台任务**：`build --follow` 是前台流，工作台起子进程并把最后 N 行推进 SSE；断开只是停止观察（官方语义：build 继续在 Worker 跑）。
- **唯一写入口**：`src/actions.mjs`（新建 production、写 review、写 ledger、启动 build）。其他模块只读。

目录（代码 ≤ 6 个文件，预算 1200–1600 行）：

```text
Thypit/
├── bin/twb.mjs           # CLI 入口（≤120 行）：参数解析、命令分派、退出码
├── src/hypit.mjs         # CLI 封装（≤200 行）：唯一 execFile 调用点 + JSON 解析
├── src/project.mjs       # 发现项目 / 读官方文件 / 解析 builds 与 results（≤250 行）
├── src/gate.mjs          # 预算闸门：plan→pricing→确认→build（≤150 行）
├── src/actions.mjs       # 写动作：review / ledger / 新建 production（≤250 行）
├── src/server.mjs        # M2：http + 静态文件（≤250 行）
├── web/                  # M2：原生 ES module，无框架
└── test/*.test.mjs       # node --test
```

### CLI 命令表（M0–M1 的全部界面）

```bash
twb list                          # 列出项目 / productions / runs
twb new <production>              # 建官方骨架（M1）
twb check <run>                   # hypit check
twb plan <run>                    # plan --json，打印 targets / requests / providers 摘要
twb price <run>                   # pricing --json，打印价目分组与文档链接
twb build <run> --budget 10       # 过 gate 后 build --follow，流式打印
twb status <buildId>              # status --json
twb get <buildId> --output <名>   # get 到 productions/<t>/results/
twb review <buildId> <output>     # 写 review.json（approved|rejected|pending）
twb ledger <production>           # 打印花费汇总；--add 手工记实付
twb studio <run>                  # 拉起官方 studio
```

所有命令都有 `--json`，输出稳定结构，便于以后 Web 复用同一批函数。

## 5. 主流程（一条片子的时序）

```text
Agent（skill）写文件           工作台                        官方 CLI
─────────────────────────────────────────────────────────────────
BRIEF.md / TREATMENT.md
recipes/*.recipe.svml
runs/build.svrun   ────────►  发现 run
                              点「检查」      ──────────────►  hypit check
                              点「计划」      ──────────────►  hypit plan --json
                              点「报价」      ──────────────►  hypit pricing --json
                              闸门：预算内?     （读 ledger + 用户确认）
                              点「构建」      ──────────────►  hypit build --follow
                              流式日志（SSE）  ◄──────────────  stdout
                              结束查事实       ──────────────►  hypit status --json
                              点「取回」      ──────────────►  hypit get ... --to
                              点「审片」      ──────────────►  hypit studio --run
                              写 review.json（人工结论）
交付：film/html author build  ──────────────────────────────►  同上，输出 final.video
```

## 6. 两个自有文件的格式

`productions/<t>/review.json`

```json
{
  "format": "workbench.review@1",
  "items": [
    {
      "buildId": "bld_...",
      "output": "final.video",
      "verdict": "approved",
      "note": "第 3 镜产品角度不对",
      "reviewer": "tangsir",
      "at": "2026-11-15T02:00:00.000Z"
    }
  ]
}
```

`verdict` 只有 `approved | rejected | pending`，且**只针对某个 build 的具体 output**——不引入项目级「审核状态」，避免和官方 Result 生命周期打架。

`productions/<t>/ledger.json`

```json
{
  "format": "workbench.ledger@1",
  "entries": [
    {
      "buildId": "bld_...",
      "run": "runs/build.svrun",
      "plannedRequests": 6,
      "providerRequests": 6,
      "estimateCny": 4.2,
      "pricingDocs": ["https://..."],
      "actualCny": 3.9,
      "note": "人工核对 Provider 账单后填",
      "at": "2026-11-15T02:10:00.000Z"
    }
  ]
}
```

规则：`estimateCny` 由人填（官方不合计，工作台也不假装能合计）；`actualCny` 只在人核对后填；预算上限 `budgetCny` 存在 production 级 `workbench.json`（第三个小文件，见 §7）。

## 7. 预算闸门（gate.mjs）

```
build(run) 前置条件：
  1. 该 run 有 plan 记录（本次会话内 plan 成功，且 run 文件 mtime 未变）
  2. 有 pricing 记录，且 providerRequests 数 > 0 时，必须有人确认的 estimateCny
  3. estimateCny ≤ production 的 budgetCny（workbench.json，缺省 10）
  4. ledger 追加一条 entry（build 前写入，失败也留痕）
任一不满足 → 拒绝，返回可读原因（哪条、差多少）
```

反例（旧仓库踩过的）：先 build 后看价、价目格式不认识就静默跳过、估算和实付混在一起。

## 8. 状态从哪来

| 界面显示 | 来源 | 谁写 |
|---|---|---|
| 项目/参考/产出树 | 磁盘目录 | Agent |
| Brief/Treatment/Progress/Analysis/Timeline | 磁盘 .md | Agent |
| Runs 列表 | `authors|recipes|runs/**.svrun` | Agent |
| Build 列表 | `hypit builds --json` | 官方 |
| 单个 Build 状态 | `hypit status <id> --json` | 官方 |
| 产物 | `hypit get` 落到 `productions/<t>/results/<output>` | 官方 + 工作台 |
| 审核 | `review.json` | 人（工作台写） |
| 花费 | `ledger.json` | 人（工作台写） |

**禁止**：把 build 状态、产物清单、审核结论再存一份到别处；页面每次刷新重新派生。

## 9. 验收标准（v1 完成定义）

1. 空目录 → 「新建 production」→ 生成官方骨架（`package.json` 带 `hypit.project:true`、三个 .md、四个空目录），`hypit paths` 能识别项目根。
2. 把一条已有 5s h3 run 放进去：检查 → 计划 → 报价 → 构建 → 状态 → 取回，mp4 能在页面里播放。
3. 未 plan 直接点构建 → 被 gate 拒绝，理由可读；日志里没有 `hypit build` 调用。
4. 报价超过 `budgetCny` → 被拒绝，并显示差额与当前估算。
5. `hypit get` 成功后，Results 区出现该 build 与 output，可再次取回（不覆盖旧文件）。
6. 点「审片」能拉起官方 studio；写 review 后刷新页面结论还在。
7. 断网：`pricing` 失败但 `plan` 仍可用，页面明确区分「价目未知」与「免费」。
8. `node --test` 覆盖 gate 四条前置条件与 review/ledger 读写的幂等。

## 10. 里程碑

- **M0（半天）**：`twb list/check/plan/price` + 项目发现 + JSON 输出稳定。（已完成）
- **M1（半天）**：`twb build/status/get/review/ledger` + 预算闸门 + `twb new`。（已完成；真实 5s h3 冒烟一次，估算 ¥0.55）
- **M2（半天）**：本地 Web（`twb serve`）：项目树、文件预览、Builds/Results、Review、Ledger、studio 按钮。
- **M3（可选）**：参考片下载（`hypit download`）、`hypit media probe/frames` 预览、多项目切换。

每个里程碑结束跑 `node --test` 与一次真实官方调用（h3 5s，费用 ≤ ¥1，需你确认后才跑）。

## 11. 技术选型

- Node 22 ESM，**零运行时依赖**（HTTP 用 `node:http`，SSE 手写，测试用 `node:test`）。
- 前端原生 ES module + 一个 CSS 文件，无构建步骤。
- 密钥不进仓库：Provider 凭证由 `hypit auth` / Profile 管理，工作台不读不写。
- 仓库只存代码：`projects/`、`*.mp4`、`results/`、`.hypit/` 全部 `.gitignore`。

## 12. 已定 / 待定

已定：

1. 仓库：`~/Thypit`，远端 `https://github.com/MYHOPE777/Thypit`。
2. 形态：先 CLI（M0–M1），Web 在 M2。
3. 旧仓库只停手，不回改、不复用代码。

待定（不阻塞 M0）：

1. **视频项目放哪**：单仓 `projects/<name>/` 还是各自独立目录、用 `--project` 指过去。M0 先支持「任意目录 + 一个项目清单文件 `projects.json`」，两种都能覆盖。
2. 远端是否私有（推送时如果是公开仓库，先把 README 里的敏感信息清一遍）。
