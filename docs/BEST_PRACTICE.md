# AIBA Best Practice: The Five-Step Production Path

[English](BEST_PRACTICE.md) | [中文](BEST_PRACTICE.zh-CN.md)

This is the recommended way to adopt AIBA on a real project. It is designed for
teams that want to ship fast with AI agents while keeping the result governed,
auditable, and upgradeable.

The five steps are intentionally simple. Each step produces a visible,
verifiable artifact — so you never spend a week without seeing progress.

---

## Step 1: Blueprint the app

Goal: turn your product idea into a deterministic capability and task plan.

1. Install the CLI:
   ```bash
   npm install --global @grubbylee/aiba
   ```
2. Create a clean project and initialize AIBA:
   ```bash
   mkdir my-project
   cd my-project
   npm init -y
   aiba init .
   ```
3. Scaffold an Application Blueprint:
   ```bash
   aiba create app my-app
   ```
4. Edit `applications/my-app/app.yaml` with your own resources, operations,
   authorization intents, events, UI intents, acceptance evidence, and agent
   write scopes. Use your own business nouns — they stay in your project.
5. Generate the plan and review it:
   ```bash
   aiba plan applications/my-app/app.yaml --json
   ```

**What you get:** a deterministic list of reusable capabilities and a bounded,
non-executable agent task graph. You can read it, understand it, and estimate
scope before writing any real code.

**Success condition:** the plan resolves without errors and you can explain every
task on the list.

---

## Step 2: Install your first capability

Goal: prove the loop works — install → adapt → verify → finalize — on one
small, high-value capability.

Pick one capability from the plan that has clear value and a small surface area.
Good first choices: `identity`, `file-assets`, `feature-flags`, or `audit`.

```bash
aiba add <capability-id> --root . --json
```

This prepares a bounded operation plan. It does **not** modify your application.
Your agent or developer then adapts the capability to your stack and design.

When the implementation is ready and your own tests pass:

```bash
aiba add <capability-id> --root . --finalize --agent <agent-name> --json
aiba verify --root .
```

**What you get:** a verified, hashed installation with a recorded receipt,
ancestry record, and evidence trail. You can prove what was installed and that
it still matches the contract.

**Success condition:** `aiba verify --root .` passes for that capability.

---

## Step 3: Compose the secure foundation

Goal: build a base set of capabilities that every production app needs, then
treat it as a trusted platform layer.

Use the official `secure-workspace` composition — a dependency-ordered set of
foundational capabilities:

```bash
aiba add secure-workspace --solution --root .
aiba status secure-workspace --root .
aiba continue secure-workspace --root .
```

Advance one constituent at a time. After each one:
- adapt the implementation,
- run your own tests,
- run `aiba add <capability> --finalize`,
- run `aiba verify --root .`.

When the last constituent finalizes, AIBA automatically runs the full Solution
verification.

**What you get:** a verified security & governance foundation for the whole app.
Every future capability you add builds on top of a known-good base.

**Success condition:** `aiba compose secure-workspace --root .` passes.

---

## Step 4: Add business capabilities in sprints

Goal: add domain-agnostic business blocks on top of the foundation, one sprint
at a time, without ever losing upgradeability.

Common sprint candidates:

- `form-engine` — for any structured submission or configuration workflow
- `import-export` — for batch data movement and reporting exports
- `reporting` — for analytics-ready queries with bounded access
- `workflow-approval` — for human-in-the-loop approval steps
- `comments-activity` — for auditable activity feeds
- `tags`, `inbox`, `notification` — for cross-cutting UX blocks
- `webhooks` — for third-party integrations

For each one, reuse the same loop:

```bash
aiba add <capability> --root .
# adapt, test, commit
aiba add <capability> --root . --finalize --agent <agent-name>
aiba verify --root .
```

**What you get:** a growing application composed of verified blocks, each with
its own contract, evidence, and upgrade path. You can track every sprint's
output in receipts and ancestry records.

**Success condition:** each sprint ships at least one verified capability and
`aiba verify --root .` still passes.

---

## Step 5: Run upgrades safely

Goal: keep receiving new capability versions without breaking your project.

When a new version of a capability ships:

```bash
aiba upgrade <capability> --root . --packs-dir <target-packs>
aiba diff <capability> --root .
```

This prepares a bounded upgrade plan and shows what changed. If your
customizations are compatible, the upgrade preserves them automatically. If a
change is breaking or security-sensitive, AIBA flags it and requires an
explicit resolution.

When you're ready:

```bash
aiba upgrade <capability> --root . --packs-dir <target-packs> --finalize
aiba verify --root .
```

For Application Blueprint revisions, use:

```bash
aiba app-diff old.yaml new.yaml
aiba app-upgrade old.yaml new.yaml --plan <plan.json> --accept
```

**What you get:** a sustainable upgrade cadence. You can upgrade capabilities on
your schedule, know exactly what's changing, and keep your project-owned code.

**Success condition:** upgrades don't break verification, and customizations are
either preserved or explicitly resolved.

---

## Enterprise path

When you move from a single project to a team or organization, add these
controls:

1. **Governance policy.** Require signed team approvals before finalizing
   installs and upgrades:
   ```bash
   aiba policy-init --id product-team --approver release-manager \
     --key-id root-1 --public-key approver-keys/public.pem \
     --capability identity review-access
   ```
   Once the policy file exists, finalization fails without enough valid
   approvals — fail-closed by design.

2. **Private registry.** Run an authenticated read-only registry inside your
   network. Every team resolves capabilities from your signed index:
   ```bash
   aiba registry-index ./registry --id company-registry ...
   AIBA_REGISTRY_TOKEN=... aiba registry-serve ./registry \
     --registry-trust registry-trust.json \
     --publisher-trust publisher-trust.json
   ```
   Anti-rollback state prevents downgrade attacks. Verified caching means you
   can scale reads without weakening trust.

3. **Behavior proofs.** Bind runtime test results to exact source snapshots
   using signed challenge/attest/verify flows. Core never executes tests, but
   it can verify that a trusted runner ran them against the right code.

4. **Composed Solutions for internal platforms.** Package your own internal
   foundations as versioned Solutions — `internal-admin-base`,
   `partner-portal-base`, etc. — and roll them out across teams with the same
   verification and upgrade guarantees.

5. **Audit and compliance reporting.** Use `aiba inspect --json`,
   `aiba verify --json`, and ancestry records to produce automated compliance
   evidence: what changed, who approved it, when, and whether it still
   verifies.

---

## Why this works

- **Visible output at every step.** You always have an artifact — a plan, a
  receipt, a verified capability, a composed solution.
- **No lock-in.** You keep your stack, your UI, and your code ownership.
- **Agent productivity stays high.** The agent stays in its lane (adaptation)
  and AIBA stays in its lane (contracts, verification, provenance, upgrades).
- **Scales up cleanly.** The same five steps work for a solo project and an
  enterprise platform; you add governance and distribution controls as you grow.
