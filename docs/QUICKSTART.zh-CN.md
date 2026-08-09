# AIBA 快速上手

[English](QUICKSTART.md) | **中文**

这条路径会验证已安装的 CLI、创建一个全新项目、编写 Application Blueprint，并把有边界的
任务图交给 AI Agent。环境准备和首次交接约需十分钟；完整应用的实现时间取决于项目，AIBA
不会把这部分时间隐藏在“十分钟”承诺中。首次上手时，只需要先完成第 1 到第 5 步。
升级和 Solution 安装属于可选后续流程。

## 准备条件

- Node.js 22 或更高版本
- npm 10 或更高版本
- Codex、Claude Code，或其他能够读取生成计划的 Agent

## 1. 安装 AIBA

```bash
npm install --global @grubbylee/aiba
aiba --version
aiba agent-protocol --json
```

## 2. 创建全新项目

请在 AIBA 仓库之外的新目录执行：

```bash
mkdir aiba-quickstart
cd aiba-quickstart
npm init -y
aiba init .
aiba inspect .
aiba doctor --root .
```

`doctor` 应报告项目已经初始化并可以继续。

## 3. 描述应用

```bash
aiba create app work-hub
aiba plan applications/work-hub/app.yaml
aiba plan applications/work-hub/app.yaml --json
```

规划前先编辑 `applications/work-hub/app.yaml`，用自己的资源、字段、状态、操作、授权动作、
事件、界面意图、验收证据和 Agent 写入范围替换脚手架内容。这些名称只属于项目，不是 AIBA
产品模型。规划会验证文档、解析精确能力依赖，并输出不可执行的 Agent 任务图。
如果想保留计划，可加 `--out .aiba/plans/work-hub.plan.json`。

## 4. 把计划交给 Agent

要求 Agent 先运行 `aiba agent-protocol --json`，再读取 Blueprint 和 JSON 计划，按依赖顺序
实现任务，严格遵守每项任务的写入范围和不变量。AIBA 不会执行这些任务，也不会写入应用实现。

对计划解析出的每项通用能力，使用正常的可验证生命周期：

```bash
aiba add <capability> --root . --json
# Agent 实现有边界的计划，并登记真实证据。
aiba add <capability> --root . --finalize --agent codex --json
```

使用 Claude Code 时可把 Agent 标识改为 `--agent claude-code`。不要把项目专有资源复制到
官方能力或 Solution 中。

## 5. 验证结果

所有组成能力完成后执行：

```bash
aiba doctor --root .
aiba verify --root .
aiba inspect --root .
```

运行时行为声明使用独立的签名 `test`、`attest`、`verify-behavior` 流程；AIBA Core
自身不会执行测试命令。

如果要安装维护好的 `secure-workspace` 组合，而不是自己编写 Blueprint，可执行
`aiba add secure-workspace --solution --root .`，再用
`aiba continue secure-workspace --root .` 每次推进一个组成能力。

## 不依赖 Agent 的 CLI 验证

下面的路径只使用 npm 包，可验证能力创作工具：

```bash
mkdir local-capabilities
aiba create capability appointment-booking --out ./local-capabilities
aiba lint ./local-capabilities/appointment-booking
aiba test-pack ./local-capabilities/appointment-booking
```

为当前 Shell 启用命令补全：

```bash
source <(aiba completion bash)
source <(aiba completion zsh)
aiba completion fish | source
```

Agent 或 CI 集成应为稳定工作流命令添加 `--json`。失败时，stderr 只返回一个
`AibaErrorEnvelope`，进程退出码为非零。

## 可选：Blueprint 升级

先把第一轮跑通，再看这些命令：

```bash
aiba app-diff old.yaml new.yaml
aiba app-upgrade old.yaml new.yaml --plan <plan.json> --accept
```
