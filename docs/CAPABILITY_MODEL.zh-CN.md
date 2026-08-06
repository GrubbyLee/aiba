# AIBA 能力模型

[English](CAPABILITY_MODEL.md) | [中文](CAPABILITY_MODEL.zh-CN.md)

## AIBA 是什么

AIBA 是面向 AI Agent 的低代码基础设施。它不是管理后台模板、可视化页面搭建器、
固定的全栈框架，也不是提示词集合。AIBA 向 Agent 提供稳定、有版本的软件行为定义；
Agent 按项目已有的技术栈和设计语言完成适配；确定性的 Core 命令负责检查、验证、
追踪和升级结果。

它把“应用必须保证什么”与“代码和界面如何实现”分开。生成代码归项目所有。

## 三种基本构件

1. **通用协议**定义分页查询、不透明游标、幂等键、乐观并发版本等有边界、语言无关的
   数据语义，避免不同能力重复发明不兼容的规则。
2. **能力包**通过接口、依赖、不变量、证据要求、实现配方、迁移和攻击测试指导，定义一项
   可复用行为。能力包是不可信数据，Core 永远不执行能力包提供的命令。
3. **行业 Solution**精确绑定一组能力的版本、内容哈希和依赖顺序。每项能力仍须独立通过
   验证，Solution 不能削弱不变量，也不能掩盖失败的组成能力。

## 五层能力体系

| 层级 | 作用 | 当前目录 |
| --- | --- | --- |
| 应用基础能力 | 跨项目复用的应用边界 | `identity`、`authorization`、`users`、`notification`、`verification-challenge`、`file-assets`、`i18n`、`scheduled-jobs`、`feature-flags`、`organization`、`search`、`review-access` |
| 平台集成能力 | 服务商和外部系统边界 | `webhooks`、`wechat-miniprogram-auth` |
| 业务通用能力 | 可跨行业复用的业务行为 | `comments-activity`、`import-export`、`reporting`、`workflow-approval`、`vehicle-records` |
| 工程治理能力 | 运行、安全和风险控制 | `audit` |
| 行业解决方案 | 面向具体产品领域的精确组合 | `vehicle-management` |

目录层级只用于发现和理解，不是验证依据。前四层是可独立安装的能力包，第五层是能力组合。

## 能力契约

一项官方能力拥有稳定 ID 和语义化版本，并声明：

- 可移植接口以及必需的能力依赖；
- 可测试的不变量、严重级别和可接受证据；
- 不绑定框架的实现配方和安全测试计划；
- 公共数据对应的严格 JSON Schema 与 TypeScript 绑定；
- 可执行参考行为、成功测试和攻击测试；
- 升级需要重新适配项目时使用的迁移说明。

一项功能如果在无关项目中反复出现、跨越信任或数据边界、具有确定的验收规则、需要来源
追踪或存在有意义的升级路径，就适合进入能力目录。主题、控件和一次性页面仍归项目自己管理。

## Agent 工作流

```bash
aiba init
aiba list
aiba show reporting
aiba add reporting
# Agent 实现有边界的计划并补充证据。
aiba add reporting --finalize --agent codex
aiba inspect
aiba verify
```

`add` 只准备计划，不会静默生成代码，也不会执行能力包中的内容。Agent 把契约映射到项目
自己的框架、存储、服务商和界面。Core 验证通过后，最终确认才会计算证据哈希并记录来源。
`diff` 和 `upgrade` 会比较已记录的生成来源与当前代码，不会把项目定制当成可随意覆盖的产物。

安装组合方案时使用 `aiba add vehicle-management --solution`，然后运行
`aiba status vehicle-management` 和 `aiba continue vehicle-management`。AIBA 按依赖顺序，
每次只推进一项能力。

## 选择与组合

先从业务目标出发，通过 `aiba show <id>` 检查依赖和不变量，只安装足够解决问题的最小集合。
共享行为应依赖通用协议或基础能力，不应重复实现；服务商细节留在平台集成层；产品特有规则在
满足目录准入条件之前，应保留为项目代码。

只有当某个精确组合本身具有长期稳定的行业含义时，才应制作 Solution。把一批无关功能打包
在一起，不是行业解决方案。

## 信任与验证

AIBA 有意区分不同层次的结论：

- Schema 和依赖图验证证明契约与依赖结构有效。
- 证据与来源验证证明项目文件、哈希、回执、生成历史和审批记录完整且未漂移。
- 可信行为证明把外部执行的测试绑定到精确源码快照；Core 不执行测试命令。
- 发布者和 Registry 签名证明制品身份与完整性，不证明运行时一定正确。

调用方指定的租户范围、凭据、服务商地址、原始查询语言、能力包可执行内容和不可验证的成功
声明，都会在相应边界被拒绝。无论使用哪个 Agent 或分发渠道，离线 AGPL Core 始终是本地
最终验证者。

## 扩展能力目录

创建和检查候选能力不需要改变 Core 的语义：

```bash
aiba create capability appointment-booking
aiba lint capabilities/appointment-booking
aiba test-pack capabilities/appointment-booking
```

新的官方能力包应补齐 Schema、类型绑定、框架无关的实现配方、参考行为、攻击测试、必要的
迁移指导和目录依赖顺序测试。详见[能力包创作指南](AUTHORING.md)与
[RFC 0012](rfcs/0012-capability-taxonomy.md)。
