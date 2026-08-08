# AIBA 最佳实践：五步生产级上线法

[English](BEST_PRACTICE.md) | [中文](BEST_PRACTICE.zh-CN.md)

这是在真实项目中落地 AIBA 的推荐路径。它面向那些想让 AI Agent 加速开发、
同时又希望结果可治理、可审计、可升级的团队。

五步故意做得很简单。每一步都有可见、可验证的产出——
你不会花了一周还看不到进度。

---

## 第一步：用 30 分钟画出应用蓝图

目标：把产品想法变成一张确定性的能力依赖图与任务清单。

1. 安装 CLI：
   ```bash
   npm install --global @grubbylee/aiba
   ```
2. 新建项目并初始化 AIBA：
   ```bash
   mkdir my-project
   cd my-project
   npm init -y
   aiba init .
   ```
3. 生成一个 Application Blueprint 脚手架：
   ```bash
   aiba create app my-app
   ```
4. 编辑 `applications/my-app/app.yaml`，填入你自己的资源、操作、授权意图、
   事件、界面意图、验收证据和 Agent 写入范围。使用你自己的业务名词——
   它们只属于你的项目。
5. 生成计划并审视：
   ```bash
   aiba plan applications/my-app/app.yaml --json
   ```

**你得到什么：** 一份确定性的能力列表和一份有边界、不可执行的 Agent 任务图。
在写真正代码之前，你就能读它、理解它、评估工作量。

**成功标准：** 计划能正常输出，并且你能解释上面的每一个任务。

---

## 第二步：1 小时内落地第一个能力

目标：跑通整个闭环——安装 → 适配 → 验证 → 最终确认——先用一个小而高价值的能力证明可行。

从计划里挑一个价值明确、接触面小的能力。合适的起步选择有：
`identity`、`file-assets`、`feature-flags`、`audit`。

```bash
aiba add <capability-id> --root . --json
```

这一步只生成有边界的操作计划，**不会**修改你的应用。
由 Agent 或开发者把能力适配到你自己的技术栈和设计风格。

实现完成、你自己的测试通过以后：

```bash
aiba add <capability-id> --root . --finalize --agent <agent-name> --json
aiba verify --root .
```

**你得到什么：** 一次被验证过的、带哈希的安装，同时记录了回执、生成来源和证据链。
你可以证明装了什么，也能证明它仍然符合契约。

**成功标准：** `aiba verify --root .` 对这个能力返回通过。

---

## 第三步：搭好可信任的应用基座

目标：先把每个生产级应用都需要的基础能力组合成一套可信平台层，再在上面做业务。

使用官方的 `secure-workspace` 组合方案——一组按依赖顺序排列的基础能力：

```bash
aiba add secure-workspace --solution --root .
aiba status secure-workspace --root .
aiba continue secure-workspace --root .
```

每次只推进一个组成能力。每完成一个都要：
- 适配实现，
- 跑你自己的测试，
- 运行 `aiba add <capability> --finalize`，
- 运行 `aiba verify --root .`。

当最后一个组成能力完成时，AIBA 会自动执行整套 Solution 验证。

**你得到什么：** 一套经过验证的应用安全与治理基座。
未来你加的每一个业务能力，都建立在已知可靠的基础之上。

**成功标准：** `aiba compose secure-workspace --root .` 通过。

---

## 第四步：按 Sprint 增量加入业务能力

目标：在基座上一个个加业务通用模块，每个 Sprint 都有产出，同时永远不丢可升级性。

常见的 Sprint 候选：

- `form-engine` —— 任何结构化提交或配置流程
- `import-export` —— 批量数据导入导出和报表导出
- `reporting` —— 带访问控制的分析型查询
- `workflow-approval` —— 需要人工审批的流程节点
- `comments-activity` —— 可审计的活动流与评论
- `tags`、`inbox`、`notification` —— 跨功能的体验模块
- `webhooks` —— 第三方系统集成

每一个都复用同样的闭环：

```bash
aiba add <capability> --root .
# 适配实现、自测、提交
aiba add <capability> --root . --finalize --agent <agent-name>
aiba verify --root .
```

**你得到什么：** 一个由可验证模块组成的、不断生长的应用。
每个模块都有自己的契约、证据和升级路径。每个 Sprint 的产出都可以在
回执和来源记录里追踪。

**成功标准：** 每个 Sprint 至少交付一个已验证能力，且
`aiba verify --root .` 始终通过。

---

## 第五步：安全升级，持续演进

目标：持续接收能力的新版本，但不打断你的项目。

当某个能力发布新版本时：

```bash
aiba upgrade <capability> --root . --packs-dir <target-packs>
aiba diff <capability> --root .
```

这会生成一个有边界的升级计划，并明确告诉你改了什么。
如果你的定制是兼容的，升级会自动保留。
如果变更是破坏性的或安全敏感的，AIBA 会标出来并要求显式决策。

准备好以后：

```bash
aiba upgrade <capability> --root . --packs-dir <target-packs> --finalize
aiba verify --root .
```

对于 Application Blueprint 版本迭代，使用：

```bash
aiba app-diff old.yaml new.yaml
aiba app-upgrade old.yaml new.yaml --plan <plan.json> --accept
```

**你得到什么：** 一个可持续的升级节奏。你可以按自己的计划升级能力，
清楚知道改了什么，并且保留项目自己的代码。

**成功标准：** 升级不会让验证失败，定制代码要么被保留，要么被显式处理。

---

## 企业路径

当你从单个项目扩展到团队或组织时，叠加这些控制：

1. **治理策略。** 要求安装和升级都必须经过带签名的团队审批：
   ```bash
   aiba policy-init --id product-team --approver release-manager \
     --key-id root-1 --public-key approver-keys/public.pem \
     --capability identity review-access
   ```
   只要策略文件存在，缺审批就无法最终确认——默认失败关闭。

2. **私有 Registry。** 在你的网络内部运行一个带认证的只读 Registry。
   所有团队都从你签名的索引中解析能力：
   ```bash
   aiba registry-index ./registry --id company-registry ...
   AIBA_REGISTRY_TOKEN=... aiba registry-serve ./registry \
     --registry-trust registry-trust.json \
     --publisher-trust publisher-trust.json
   ```
   防回滚状态阻止降级攻击。验证缓存让你在不削弱信任的前提下扩展读性能。

3. **行为证明。** 把运行时测试结果通过签名的 challenge / attest / verify 流程
   绑定到精确的源码快照。Core 永远不执行测试，但它可以验证可信执行者
   是否针对正确的代码运行了测试。

4. **内部平台级 Solution。** 把你们内部的基座封装成带版本的 Solution，
   比如 `internal-admin-base`、`partner-portal-base`，让不同团队都按
   同一套验证和升级保证去落地。

5. **审计与合规报表。** 用 `aiba inspect --json`、`aiba verify --json`
   和来源记录自动生成合规证据：改了什么、谁批的、什么时候、现在还能不能过验证。

---

## 为什么这套方法有效

- **每一步都有可见产出。** 你永远拿得到一个东西——计划、回执、
  已验证的能力、已组合的方案。
- **不锁定技术栈。** 你的架构、界面、代码所有权都还在你手里。
- **Agent 效率不打折。** Agent 负责适配实现，AIBA 负责契约、验证、
  溯源和升级，各自待在自己该待的位置。
- **向上扩展很自然。** 单人项目和企业平台用的是同一套五步流程；
  随着团队变大，你只需要叠治理和分发控制。
