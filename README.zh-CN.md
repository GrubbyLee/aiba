<p align="center">
  <img src="docs/assets/aiba-logo.svg" width="760" alt="AIBA - 面向 AI Agent 的应用构建基础设施">
</p>

<p align="center">
  <strong>AI 构建软件的控制面。</strong>
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

AIBA 就是为应对这三道墙而存在的基础设施层。

## 切入方式

AIBA 是**面向 AI Agent 的能力基础设施**。它不是管理后台模板，
不是可视化页面搭建器，不是固定全栈框架，也不是提示词集合。

它不强制你用某一套技术栈，而是给 AI Agent 一套稳定、带版本的软件行为定义：
Agent 按你项目现有的技术栈和设计语言去适配实现，确定性的 Core 负责
检查、验证、溯源和升级。生成代码始终归项目所有。

一句话：**AIBA 把 AI 生成的代码，变成可治理、可溯源、可升级的生产级软件。**

## 第一天就能拿到的产出

- **用你自己的技术栈和设计体系，搭出可信任的管理后台或内部工具**，而不是被某套模板锁死。
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

AIBA 内置 **23 个能力包**（可安装的行为契约），以及 **1 个应用组合方案**
（一组经过验证、按依赖顺序排列的能力包集合）。能力包定义"必须满足什么"，
组合方案定义"经过验证的搭配是什么"。

能力包按五层组织：

| 层级 | 核心能力 |
| --- | --- |
| 应用基础能力 | `identity`、`authorization`、`users`、`audit`、`file-assets`、`notification`，以及 data-dict、i18n、feature-flags、inbox、verification-challenge、scheduled-jobs、organization、search、review-access |
| 平台集成能力 | `webhooks`、`wechat-miniprogram-auth` |
| 业务通用能力 | `form-engine`、`import-export`、`reporting`、`workflow-approval`，以及 tags、comments-activity |
| 工程治理能力 | `audit`（同时作为基础能力层使用时归入基础层） |
| 应用组合方案 | `secure-workspace` — 将六个基础能力按依赖顺序组合的方案 |

用 `aiba list` 浏览完整目录，用 `aiba show <id>` 查看任意能力详情。

AIBA 目前支持 Agent 辅助安装、确定性的证据与来源验证、漂移检查、感知定制的升级、
签名能力包、私有 Registry 认证下载、验证缓存和防回滚解析。可选的项目治理机制
还能为安装和升级的最终确认增加带签名、绑定证据的团队审批。

## 三种最快看到价值的方式

1. **一次 CLI 命令得到 Blueprint 计划。** 在 YAML 里描述一次你的应用，
   立刻得到确定性的能力依赖图和有边界的 Agent 任务列表——不需要做 prompt 工程。
2. **第一次上手就能落地一个可验证能力。** 选一个能力模块，让 Agent 适配到你的技术栈，
   再用 Core 验证证据与来源，验证通过再上线。
3. **升级不覆盖你的定制。** 当能力发布新版本时，AIBA 会区分新增、破坏性、
   安全敏感和定制冲突——你只需要适配真正需要改的部分。

[历史外部演示](https://grubbylee.github.io/aiba/video/)展示了 AIBA 和 Codex
如何从空目录完成一个真实项目。演示中的具体业务只属于文档，不属于 AIBA
协议或官方能力目录。

## 从这里开始

安装（需要 Node.js 22+）：

```bash
npm install --global @grubbylee/aiba
aiba --version
```

然后试试最短闭环：

```bash
aiba init
aiba create app my-app
aiba plan applications/my-app/app.yaml
aiba add identity
aiba add identity --finalize --agent codex
aiba verify .
```

更多路径：

- **一步步引导：** [快速上手](docs/QUICKSTART.zh-CN.md)
- **生产级方案：** [五步最佳实践](docs/BEST_PRACTICE.zh-CN.md)
- **了解底层机制：** [能力模型](docs/CAPABILITY_MODEL.zh-CN.md)
- **团队使用：** 私有 Registry、治理、行为证明——从
  [自托管指南](docs/SELF_HOSTING.md)开始

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


## 工作方式

最核心的闭环：描述、规划、适配、验证、升级。

```bash
aiba init
aiba create app my-app
aiba plan applications/my-app/app.yaml
aiba add identity
aiba add identity --finalize --agent codex
aiba verify .
```

`add` 和 `upgrade` 只准备有边界的操作计划——不会静默生成代码，
也不会执行能力包里的内容。Agent 按项目的技术栈和设计体系去适配实现；
Core 在验证通过后才计算证据哈希并记录来源。能力包是不可信数据，
Core 永远不会执行能力包提供的命令。

`compose` 是只读的证据与来源验证。Solution 把每个组成能力绑定到精确版本和
Manifest 哈希，要求完整依赖闭包和正确安装顺序，并对每个能力重新执行其自身的
项目验证。Solution 永远不能削弱不变量，也不能掩盖失败的组成能力。

存在治理策略时，审批默认失败关闭。每份审批都绑定到准确的计划、策略、
能力版本和证据文件哈希；最终收据保留策略与审批哈希，供后续验证。

运行时行为声明走独立的签名 `test`、`attest`、`verify-behavior` 流程。
Core 永远不执行测试，但它可以验证可信执行者是否针对正确的源码快照运行了测试。

更多细节：[能力模型](docs/CAPABILITY_MODEL.zh-CN.md)、
[自托管指南](docs/SELF_HOSTING.md)、[路线图](docs/ROADMAP.md)。

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


## 许可证

CLI、Core、Registry Server、能力契约、配方和迁移采用 AGPL-3.0-only。
协议包采用 Apache-2.0。部分应用输出可以使用
[生成输出附加许可](GENERATED_OUTPUT_EXCEPTION.md)；该许可不会改变 AIBA 本身或
第三方材料的许可证。
