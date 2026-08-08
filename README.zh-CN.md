<p align="center">
  <img src="docs/assets/aiba-logo.svg" width="760" alt="AIBA - 面向 AI Agent 的应用构建基础设施">
</p>

<p align="center">
  <strong>AI 时代的软件治理与交付控制面。</strong>
</p>

<p align="center">
  <a href="README.md">English</a> · <strong>中文</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@grubbylee/aiba"><img src="https://img.shields.io/npm/v/@grubbylee/aiba?color=ff4a2b" alt="npm 版本"></a>
  <a href="https://github.com/GrubbyLee/aiba/actions/workflows/ci.yml"><img src="https://github.com/GrubbyLee/aiba/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0--only-151412" alt="AGPL-3.0-only"></a>
</p>

# AIBA

## 痛点

AI 写代码很快，但每个项目依然在重复造轮子：登录、权限、审计、文件、通知、
审核入口、审批、表单、报表、租户、多语言……每个团队都要从头再来一遍。

到最后都会撞上三道墙：

- **不敢信**：AI 生成的代码，你无法证明它是安全的、合规的、可升级的。
- **不够快**：从模板开始改，改到能上线那天，模板已经面目全非，再也升不上去。
- **管不住**：没有一套系统记录 Agent 改了什么、为什么改、证据还在不在、
  是谁批的、出问题怎么回滚。

AIBA 就是为了解决这三道墙而存在的基础设施层。

## 切入方式

AIBA 是**面向 AI Agent 的低代码基础设施**。它不是管理后台模板，
不是可视化页面搭建器，不是固定全栈框架，也不是提示词集合。

它不强制你用某一套技术栈，而是给 AI Agent 一套稳定、带版本的软件行为定义：
Agent 按你项目现有的技术栈和设计语言去适配实现，确定性的 Core 负责
检查、验证、溯源和升级。生成代码始终归项目所有。

一句话：**AIBA 把 AI 生成的代码，变成可治理、可溯源、可升级的生产级软件。**

## 第一天就能拿到的产出

- **几天上线一个可信任的管理后台或内部工具**，而不是被某套模板锁死。
- **23 个可验证的能力模块**：身份、权限、用户、通知、站内信、验证码、
  数据字典、文件、国际化、定时任务、功能开关、组织、搜索、审核入口、
  Webhook、微信小程序认证、评论活动、动态表单、导入导出、报表、标签、
  审批工作流、审计。
- **确定性的证据与来源验证**：每一次能力安装都有哈希、有回执、可复现。
- **感知定制的升级**：你改过的代码不会被覆盖，升级时只改需要改的部分。
- **带签名的团队治理**：审批绑定到精确的计划与证据哈希，篡改即失败。
- **私有 Registry 与可控分发**：企业团队可以完整掌控自己安装的每一个能力。

## 面向谁

- **独立开发者与小团队**：用 Codex、Claude Code 等 Agent 写代码，
  想更快上线，又不想留下一堆不可维护的 AI 屎山。
- **产品团队**：要同时做多个内部工具或管理后台，又想统一安全、
  合规和升级策略。
- **平台与安全团队**：需要一个 AI 生成应用代码的治理层——
  改了什么、谁批的、现在还能不能过验证、怎么安全升级。

AIBA 从 Agent 开发者工作流切入，但架构天然能向上扩展到企业控制面。
同一个 Core、同一套契约、同一个验证引擎，既服务单人项目，也服务合规团队。

## 能力层级

AIBA 现有 23 项可复用能力，按下面顺序组织，便于发现和理解：

| 层级 | 当前目录 |
| --- | --- |
| 应用基础能力 | `identity`、`authorization`、`users`、`notification`、`inbox`、`verification-challenge`、`data-dict`、`file-assets`、`i18n`、`scheduled-jobs`、`feature-flags`、`organization`、`search`、`review-access` |
| 平台集成能力 | `webhooks`、`wechat-miniprogram-auth` |
| 业务通用能力 | `comments-activity`、`form-engine`、`import-export`、`reporting`、`tags`、`workflow-approval` |
| 工程治理能力 | `audit` |
| 应用组合方案 | `secure-workspace` |

前四层是可独立安装的能力包。最后一层是可复用的组合方案，不计入 23 项能力包。

AIBA 目前支持 Agent 辅助安装、确定性的证据与来源验证、漂移检查、感知定制的升级、
签名能力包、私有 Registry 认证下载、验证缓存和防回滚解析。可选的项目治理机制
还能为安装和升级的最终确认增加带签名、绑定证据的团队审批。

## 三种最快看到价值的方式

1. **10 分钟出 Blueprint 计划。** 描述一次你的应用，立刻得到确定性的
   能力依赖图和有边界的 Agent 任务列表——不需要再做 prompt 工程。
2. **1 小时内完成第一个可验证的能力。** 选一个能力模块，让 Agent 适配实现，
   再用 Core 验证证据与来源，验证通过再上线。
3. **升级不会打断你的定制。** 当能力发布新版本时，AIBA 会区分新增、破坏性、
   安全敏感和定制冲突，你只需要适配真正需要改的部分。

[历史外部演示](https://grubbylee.github.io/aiba/video/)展示了 AIBA 和 Codex
如何从空目录完成一个真实项目。演示中的具体业务只属于文档，不属于 AIBA
协议或官方能力目录。

## 开始使用

- **最佳实践**：[五步生产级上线法](docs/BEST_PRACTICE.zh-CN.md)
  —— 在真实项目中落地 AIBA 的推荐路径。
- **快速上手**：[十分钟入门](docs/QUICKSTART.zh-CN.md)
  —— 在全新项目中验证 npm CLI，并把第一个有边界的计划交给 Agent。
- **深入理解**：[能力模型](docs/CAPABILITY_MODEL.zh-CN.md)
  —— 完整目录、组合规则、Agent 工作流和信任边界。
- **团队版**：[企业与治理路径](docs/BEST_PRACTICE.zh-CN.md#企业路径)
  —— 签名审批、私有 Registry、可审计的来源追踪。

## 原则

- 能力语义稳定，实现方式灵活。
- 确定性的证据与来源验证，AI 辅助适配。
- 生成代码归项目所有。
- 变更可追踪，能力可升级。
- Core 保持独立，Agent Skill 只做轻量适配。

## 仓库结构

- `docs/`：愿景、架构、RFC、路线图和任务进度。
- `packages/spec`：语言无关的 Schema 和 TypeScript 协议类型。
- `packages/core`：项目检查、能力加载、来源追踪和验证。
- `packages/cli`：`aiba` 命令行界面。
- `packages/registry-server`：带认证的只读参考 Registry。
- `capabilities/`：官方能力包。
- `solutions/`：绑定精确版本并按依赖顺序排列的应用能力组合。
- `integrations/`：Agent 专用适配器。
- `fixtures/`：一致性与攻击测试参考项目，包括原生微信小程序和集成核心能力的
  安全测试语料。

## 安装

需要 Node.js 22 或更高版本：

```bash
npm install --global @grubbylee/aiba
aiba --version
```

作用域包同样会安装 `aiba` 可执行命令，官方能力包和应用组合方案都在发行包里。
作为库使用时，也可以分别安装 `aiba-core`、`aiba-spec` 或
`aiba-registry-server`。

最短上手路径：

```bash
aiba init
aiba create app my-app
aiba plan applications/my-app/app.yaml
aiba add identity
aiba add identity --finalize --agent codex
aiba verify .
```

更多入口：

- 搭建完整安全基座：`aiba add secure-workspace --solution`
- 浏览能力目录：`aiba list`、`aiba show <id>`
- 按五步生产级路径落地：
  [最佳实践](docs/BEST_PRACTICE.zh-CN.md)
- 团队使用：签名治理、私有 Registry、行为证明、自托管——
  从[能力模型](docs/CAPABILITY_MODEL.zh-CN.md)和
  [自托管指南](docs/SELF_HOSTING.md)开始。

## 开发

给在本仓库内做贡献的开发者：

```bash
pnpm install
pnpm check
pnpm aiba -- inspect .
```

`pnpm check` 会一次性跑类型检查、测试、构建、冒烟测试、发布元数据校验、
工作流校验，以及干净 tarball 消费者测试。

用 `pnpm aiba -- <command>` 在任意路径运行本地编译好的 CLI。
Registry 操作、签名、治理、行为证明等流程都在 `docs/` 下的专门文档里，
这里不再重复。

## 工作方式

最简产品流程是：

```bash
aiba init
aiba agent-protocol --json
aiba create app work-hub
aiba plan applications/work-hub/app.yaml
aiba list
aiba show secure-workspace
aiba add secure-workspace --solution
aiba inspect
aiba verify
aiba compose secure-workspace
```

完整的 M3 安全基座需要依次安装并适配 `identity`、`audit`、`authorization`、
`users` 和 `notification`；依赖检查会拒绝错误顺序。每次 `add` 先生成 Agent
计划，项目测试通过后再由 `--finalize` 记录 Core 计算出的来源信息。

`add` 和 `upgrade` 默认只准备有边界的操作计划。Agent 负责适配项目并提交证据或
冲突处理结果；Core 在 `--finalize` 阶段计算哈希并验证。能力包始终作为数据处理，
不能向 Core 提供待执行命令。

`compose` 是只读的证据与来源检查。方案把每个组成能力绑定到精确版本和 Manifest
哈希，要求完整依赖闭包和正确安装顺序，并对每个能力执行原有项目验证。方案不能把
必需依赖改成可选，也不能忽略任何组成能力的不变量。

`add <solution> --solution` 是分步安装入口。每次调用只准备或完成一个组成能力。
Agent 实现返回的计划并填写证据后，先运行 `--finalize --agent <name>`，再请求下一步。
Core 在前进前会重新验证所有已安装组成能力，最后一个能力完成后还会自动执行整套
Solution 证据与来源验证。

AIBA 返回 `ok` 不代表项目测试已经运行，也不等于运行时行为得到证明。它表示声明的
证据、来源哈希、回执、血缘、依赖和治理记录有效且没有变化。需要证明运行时行为时，
使用独立的 `test`、`attest`、`verify-behavior` 签名证明流程；Core 不执行测试命令。

`registry-index` 会先验证所有发布者能力包，再创建不可变的签名快照。`resolve`
会验证最新 Registry 快照、有效期、本地防回滚状态和所选能力包，之后才返回路径；
它不会安装代码、执行命令或发起网络请求。`fetch` 在此基础上增加带认证的 HTTPS
传输和验证缓存，并拒绝重定向、超大响应、过期索引和未经验证的缓存内容。默认的
`.aiba/registry-cache/` 是派生产物，不应提交；请把
`.aiba/registry-state.json` 保存在可信的持久存储中。

`registry-add` 只导入经过发布者完整验证的能力包，且不会覆盖冲突版本。
`registry-serve` 会在监听端口前验证最新签名索引及全部能力包，之后只暴露带认证的
`GET`/`HEAD` 路由，不提供远程修改或签名 API。完整流程见
[自托管指南](docs/SELF_HOSTING.md)。

当 `.aiba/governance-policy.json` 存在时，`add --finalize` 和
`upgrade --finalize` 会采用失败关闭策略：只有满足阈值的有效审批才能继续。每份审批
都绑定准确的计划、策略、能力版本和当前证据文件哈希；最终收据会保留策略与审批哈希，
供后续验证。

当前实现状态见 [路线图](docs/ROADMAP.md) 和 [任务清单](docs/TASKS.md)。兼容性与
发行规则见 [版本策略](docs/VERSIONING.md) 和 [发行指南](docs/RELEASING.md)，跨表面
适配证据见 [可移植性说明](docs/PORTABILITY.md)。

## 许可证

CLI、Core、Registry Server、能力契约、配方和迁移采用 AGPL-3.0-only。
协议包采用 Apache-2.0。部分应用输出可以使用
[生成输出附加许可](GENERATED_OUTPUT_EXCEPTION.md)；该许可不会改变 AIBA 本身或
第三方材料的许可证。
