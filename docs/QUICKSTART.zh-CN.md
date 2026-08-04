# AIBA 十分钟快速上手

[English](QUICKSTART.md) | **中文**

这条路径会验证已安装的 CLI、创建一个全新项目、选择一套 Solution，并把一个有边界的
实现步骤交给 AI Agent。环境准备和首次交接约需十分钟；完整应用的实现时间取决于项目，
AIBA 不会把这部分时间隐藏在“十分钟”承诺中。

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

## 3. 选择经过验证的 Solution

```bash
aiba list
aiba show vehicle-management
aiba add vehicle-management --solution --root .
aiba status vehicle-management --root .
```

最后两条命令只会准备一个组成能力，并输出计划文件路径。AIBA 此时没有执行能力包代码，
也不会声称应用行为已经实现。

## 4. 把计划交给 Agent

要求 Agent 读取生成的 `.aiba/plans/*.yaml`，只在当前项目中实现这一步，补充所需证据，
并保留所有不变量。然后执行：

```bash
aiba continue vehicle-management --root . --finalize --agent codex
aiba continue vehicle-management --root .
```

为每个组成能力重复交接和这两条命令。使用 Claude Code 时可把 Agent 标识改为
`--agent claude-code`。

## 5. 验证结果

所有组成能力完成后执行：

```bash
aiba doctor --root .
aiba verify --root .
aiba compose vehicle-management --root .
```

运行时行为声明使用独立的签名 `test`、`attest`、`verify-behavior` 流程；AIBA Core
自身不会执行测试命令。

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
