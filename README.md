# Thypit

Hypit 官方项目目录的薄工作台：文件是唯一真相，生成/报价/构建/取回全部走官方 CLI，交付只走官方 `film`/`html` 作者。

设计见 [DESIGN.md](DESIGN.md)。

## 现在能做什么（M0）

```bash
node bin/twb.mjs list [--project <目录>] [--json]   # 项目 / productions / runs 盘点
node bin/twb.mjs check <run>                        # hypit check，原样透传（免费）
node bin/twb.mjs plan  <run> [--json]               # hypit plan --json，汇总请求与 provider（免费）
node bin/twb.mjs price <run> [--json]               # hypit pricing --json，价目与文档摘要（只读网络）
```

约定：

- 项目根 = 含 `package.json` 且 `"hypit": {"project": true}` 的目录；`--project` 可指定，否则从当前目录向上找。
- hypit 可执行文件查找顺序：`--hypit` → `HYPIT_BIN` → 项目内 `node_modules/.bin/hypit` → 向上逐级 → `PATH`。
- `plan` / `price` 只做摘要，不换算总价、不读密钥、不写盘。
- 所有命令都支持 `--json`，格式以 `twb.*@1` 开头。

## 开发

```bash
npm test    # node --test，零依赖
```
