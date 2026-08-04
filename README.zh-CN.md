<p align="center">
  <img src="docs/assets/aiba-logo.svg" width="760" alt="AIBA - 面向 AI Agent 的应用构建基础设施">
</p>

<p align="center">
  <strong>面向 AI Agent 的应用构建基础设施。</strong>
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

**Agent Infrastructure for Building Applications。**

AIBA 是一套面向 AI Agent 的应用构建基础设施。它帮助 Agent 为项目添加、验证、
追踪和升级完整的软件能力，同时不把项目锁定在固定的应用框架、服务商或视觉体系中。

首批能力包括 `review-access`、`identity`、`audit`、`authorization`、
`users`、`notification`、`file-assets`、`import-export` 和 `vehicle-records`。
`wechat-miniprogram-auth` 是首个平台服务商集成能力。
能力目录按五层扩展：
应用基础能力、平台集成能力、业务通用能力、工程治理能力和行业组合方案。AIBA
目前支持 Agent 辅助安装、确定性的证据与来源验证、漂移检查、感知定制的升级、签名能力包、
私有 Registry 认证下载、验证缓存和防回滚解析。可选的项目治理机制还能为安装和
升级的最终确认增加带签名、绑定证据的团队审批。

[在线观看车辆管理后台演示](https://grubbylee.github.io/aiba/video/)，了解 AIBA 和 Codex 如何从空目录
开始，完成一个可操作、可独立验证的管理后台。

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
- `solutions/`：绑定精确版本并按依赖顺序排列的行业能力组合。
- `integrations/`：Agent 专用适配器。
- `fixtures/`：一致性与攻击测试参考项目，包括原生微信小程序和集成核心能力的
  安全测试语料。

## 开发

```bash
pnpm install
pnpm check
node packages/cli/dist/index.js init /path/to/project
node packages/cli/dist/index.js inspect .
node packages/cli/dist/index.js add review-access --root /path/to/project
node packages/cli/dist/index.js add review-access --finalize --root /path/to/project
node packages/cli/dist/index.js diff review-access --root /path/to/project
node packages/cli/dist/index.js upgrade review-access \
  --root /path/to/project --packs-dir /path/to/target-packs
node packages/cli/dist/index.js upgrade review-access --finalize \
  --root /path/to/project --packs-dir /path/to/target-packs
node packages/cli/dist/index.js verify review-access \
  --root fixtures/review-access-reference \
  --packs-dir capabilities
node packages/cli/dist/index.js compose vehicle-management \
  --root fixtures/identity-reference --packs-dir capabilities
node packages/cli/dist/index.js add vehicle-management --solution \
  --root /path/to/project
node packages/cli/dist/index.js add vehicle-management --solution --finalize \
  --agent codex --root /path/to/project
node packages/cli/dist/index.js add wechat-miniprogram-auth \
  --root /path/to/project
aiba keygen aiba-official --out ../aiba-publisher-keys
aiba pack identity --publisher aiba-official --key-id root-1 \
  --private-key ../aiba-publisher-keys/private.pem --out identity.aiba
aiba verify-bundle identity.aiba --trust trust-policy.json
aiba registry-add identity.aiba --registry ./registry \
  --publisher-trust publisher-trust.json
aiba registry-index ./registry --id local-registry \
  --publisher registry-operator --key-id root-1 \
  --private-key ../registry-keys/private.pem \
  --publisher-trust publisher-trust.json --sequence 1 \
  --expires-at 2026-07-27T00:00:00Z
aiba resolve identity --registry ./registry \
  --registry-trust registry-trust.json \
  --publisher-trust publisher-trust.json
AIBA_REGISTRY_TOKEN=... aiba registry-serve ./registry \
  --registry-trust registry-trust.json \
  --publisher-trust publisher-trust.json \
  --tls-cert fullchain.pem --tls-key private.pem
AIBA_REGISTRY_TOKEN=... aiba fetch identity \
  --registry-url https://registry.example.com \
  --registry-trust registry-trust.json \
  --publisher-trust publisher-trust.json
aiba policy-init --id product-team --approver release-manager \
  --key-id root-1 --public-key ../approver-keys/public.pem \
  --capability identity review-access
aiba approve identity --approver release-manager --key-id root-1 \
  --private-key ../approver-keys/private.pem
aiba policy-check identity --agent codex
```

## 安装

```bash
npm install --global @grubbylee/aiba
aiba list
aiba show identity
aiba init
aiba add vehicle-management --solution
aiba inspect
aiba compose vehicle-management
```

作用域包同样会安装 `aiba` 可执行命令。npm 发行包包含官方能力包和行业组合方案。作为库使用时，
也可以分别安装 `aiba-core`、`aiba-spec` 或 `aiba-registry-server`。

## 工作方式

最简产品流程是：

```bash
aiba init
aiba list
aiba show vehicle-management
aiba add vehicle-management --solution
aiba inspect
aiba verify
aiba compose vehicle-management
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
证据、来源哈希、回执、血缘、依赖和治理记录有效且没有变化。在可信测试证明协议完成
之前，行为一致性仍需要项目测试单独给出结果。

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
