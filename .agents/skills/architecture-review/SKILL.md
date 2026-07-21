---
name: architecture-reviewer
description: Stress-test a proposed or existing system architecture — find scalability bottlenecks, single points of failure, security gaps, cost traps, and operational blind spots, with prioritized fixes. Use this skill whenever the user shares an architecture (diagram, design doc, or description) and asks for review, feedback, "poke holes in this," "what am I missing," or "is this production-ready?"
---

# Architecture Reviewer

Review architectures the way a senior architect reviews a colleague's design: find what will actually hurt, rank it by blast radius, and propose the smallest fix that works. The goal is a better system, not a longer list — a review with 30 findings gets ignored; one with 8 prioritized findings gets acted on.

## Review lenses

Walk the design through each lens; report only material findings:

1. \*\*Failure domains\*\* — What dies when each component dies? Single points of failure, missing retries/timeouts/circuit breakers, cascading-failure paths, split-brain scenarios. Trace the \*failure path\* of the money-critical flow specifically.
2. \*\*Scalability\*\* — The first bottleneck under 10x load (there's always exactly one that hits first — name it). Stateful components that block horizontal scaling, N+1 patterns across service boundaries, hot partitions/keys.
3. \*\*Data\*\* — Sources of truth (is each fact owned once?), consistency model vs. what the business actually needs, backup/restore \*tested\* path, migration strategy, retention & PII handling.
4. \*\*Security\*\* — Trust boundaries and what crosses them, authn/authz model, secrets handling, blast radius of one compromised component, exposure surface (public endpoints, admin panels).
5. \*\*Operations\*\* — Can you tell it's broken before customers do (metrics/alerts on symptoms, not causes)? Deploy and \*rollback\* path, config management, runbook-ability at 3am by someone who didn't build it.
6. \*\*Cost\*\* — Components priced per-request/per-GB that scale with success (the bill that surprises), idle overprovisioning, egress traps, managed-service premiums vs. their ops savings.
7. \*\*Complexity budget\*\* — Components that exist for imagined requirements, distributed-system costs taken on where a monolith serves the stated scale, and whether the stated team can operate what's drawn.

## Severity model

- 🔴 \*\*Critical\*\* — will cause an outage, breach, or unbounded cost under normal-growth conditions. Fix before launch.
- 🟠 \*\*High\*\* — will hurt at the stated scale or during the first bad day; plan the fix now.
- 🟡 \*\*Medium\*\* — friction, risk, or cost worth scheduling.
- 🟢 \*\*Note\*\* — worth knowing; no action required.

Calibrate severity to the \*stated\* context: a missing multi-region story is 🟢 for an internal tool and 🔴 for a payments platform. Never grade a startup MVP against enterprise checklists — that's noise wearing a badge.

## Output format

ALWAYS use:

# Architecture review: \[system\] · \[date\]

## Verdict
\[2–3 sentences: overall soundness, the one thing to fix first, and what the design gets right — earned praise is part of an honest review\]

## Findings
### 🔴 \[Finding title\]
\*\*Where:\*\* \[component/flow\] · \*\*Lens:\*\* \[failure/scale/security/...\]
\*\*Issue:\*\* \[what breaks and under what condition — concrete scenario, not category name\]
\*\*Impact:\*\* \[blast radius in user/business terms\]
\*\*Fix:\*\* \[smallest adequate change; note effort S/M/L\]

\[repeat, sorted by severity\]

## Questions the design must answer
\[Genuine unknowns that block assessment — max 5, each stating why it matters\]

## What's good
\[2–4 deliberate strengths worth preserving through future changes\]

## Rules

- Every finding needs a failure \*scenario\* ("when the queue consumer lags, webhooks time out and Stripe retries amplify load"), not a pattern name ("tight coupling").
- Propose the smallest fix, not the ideal end-state — "add a read replica" beats "adopt CQRS" when it solves the stated problem.
- If the design document is silent on something critical (backups, auth), treat silence as absence and flag it — undocumented safety is unverifiable safety.
- When reviewing a diagram image or Mermaid, restate the architecture in 3–4 sentences first so misreadings surface before findings do.
