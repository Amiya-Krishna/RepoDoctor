# RepoDoctor AI — Day 11 to Day 15 Complete Documentation

> **Scope:** Day 11 through Day 15  
> **Project:** RepoDoctor AI  
> **Purpose:** Consolidated documentation of the implementation, important files, architecture, commands, testing, errors/fixes, and safety boundaries introduced after the Day 1–10 foundation.

---

# 1. Starting Point

Days 1–10 established:

```text
React + Vite
      ↓
Express + TypeScript
      ↓
JWT + GitHub OAuth
      ↓
PostgreSQL + Prisma
      ↓
Repository API
      ↓
Disposable Workspace
      ↓
Safe Repository Ingestion
      ↓
Repository Context
      ↓
AI Provider abstraction
      ↓
Bug Detection
```

Days 11–15 extend this into:

```text
Security Analysis
      ↓
Test Generation
      ↓
Risk Assessment
      ↓
Unified Analysis Pipeline
      ↓
Fix Proposal Generation
```

The existing repository-safety invariant remains unchanged:

```text
User Repository
      ↓
READ ONLY
      ↓
Isolated Workspace
      ↓
Analysis / Proposal
```

No direct modification of an existing/default branch is allowed.

---

# 2. Day 11 — Security Agent

## Purpose

Detect supported security findings from repository context using structured AI output.

## Architecture

```text
Repository Context
       ↓
AIProviderManager
       ↓
SecurityAgent
       ↓
Structured SecurityFinding
       ↓
Validation
```

The Security Agent receives repository-derived context and a structured output schema.

It does not:

- execute repository code
- run shell commands
- modify repository files
- perform Git operations
- install dependencies

---

# 3. Day 12 — Test Generation Agent

## Purpose

Generate tests for detected issues using repository context.

## Architecture

```text
Finding
   ↓
Repository Context
   ↓
TestGenerationAgent
   ↓
Structured GeneratedTest
   ↓
Target-file validation
```

## Important Validation

The generated test must reference a file that actually exists in the repository context.

On Windows, repository paths are normalized to `/` so:

```text
src\calculator.ts
```

and:

```text
src/calculator.ts
```

do not become incorrectly treated as different repository files.

## Safety

Day 12 generates test code but does not execute generated tests as part of the agent itself.

Execution belongs to the later isolated verification stage.

---

# 4. Day 13 — Risk & Severity Engine

## Purpose

Convert findings into deterministic risk assessments.

## Main Files

```text
src/risk/risk.types.ts
src/risk/risk.rules.ts
src/risk/risk.calculator.ts
src/risk/risk.engine.ts
src/services/risk-assessment.service.ts
src/test-risk-engine.ts
```

## Flow

```text
Finding
   ↓
Severity
   +
Confidence
   +
Category bonus
   ↓
Risk Score
   ↓
Risk Level
   ↓
Priority
```

The risk engine is application logic, not an LLM decision.

## Risk Output

The system produces values such as:

```text
Risk score
Risk level
Priority
```

with levels including:

```text
LOW
MEDIUM
HIGH
CRITICAL
```

and priorities:

```text
P3
P2
P1
P0
```

---

# 5. Day 14 — Unified Analysis Pipeline

## Main Files

```text
src/pipeline/analysis.pipeline.ts
src/pipeline/analysis.pipeline.types.ts
src/pipeline/analysis.pipeline.errors.ts
src/test-analysis-pipeline.ts
```

## Pipeline

```text
Analysis RUNNING
       ↓
Build Repository Context
       ↓
Create shared AIProviderManager
       ↓
BugDetectionAgent
       ↓
SecurityAgent
       ↓
TestGenerationAgent
       ↓
Persist findings/tests
       ↓
Build risk inputs
       ↓
Risk Engine
       ↓
Persist risk assessments
       ↓
Analysis COMPLETED
```

If a failure occurs:

```text
Analysis
   ↓
FAILED
```

The pipeline does not silently mark a failed analysis as successful.

## Successful Test

A successful pipeline test produced:

```text
Bugs: 2
Security findings: 2
Generated tests: 3
Risk score: 81
Risk level: HIGH
Priority: P1
Critical findings: 0
High findings: 4
Medium findings: 0
Low findings: 0
```

---

# 6. Day 15 — Fix Agent

## Purpose

Generate a precise proposed code change for a confirmed bug or security finding.

Day 15 does **not** modify the repository.

## Main Files

```text
src/agents/fix.agent.ts
src/agents/fix.schema.ts
src/agents/fix.types.ts
src/prompts/fix.prompt.ts
src/services/fix-generation.service.ts
src/services/fix-proposal.service.ts
src/test-fix-agent.ts
```

## Fix Flow

```text
Finding
   ↓
Repository Context
   ↓
FixAgent
   ↓
AIProviderManager
   ↓
Structured FixResult
   ↓
Validation
   ↓
Proposed Change
```

---

# 7. FixResult Structure

The result contains:

```text
title
summary
changes[]
risk
confidence
reasoning
```

Each change contains:

```text
filePath
changeType
startLine
endLine
originalCode
replacementCode
explanation
```

Supported change types:

```text
REPLACE
INSERT
DELETE
```

---

# 8. Fix Agent Validation

The Fix Agent validates:

1. Result is not empty.
2. Title exists.
3. Summary exists.
4. Changes is an array.
5. Confidence is between `0` and `1`.
6. Every referenced file exists.
7. Start/end lines are valid.
8. Line range does not exceed file length.
9. `REPLACE` contains `originalCode`.
10. `INSERT` contains replacement code.
11. At least one change exists.
12. At least one change affects the finding's file.

This prevents malformed AI output from becoming an accepted fix proposal.

---

# 9. Fix Prompt Safety Rules

The Fix Agent system prompt explicitly prevents it from:

```text
inventing files
inventing APIs
making unrelated refactors
weakening security
executing repository code
installing dependencies
using shell commands
performing Git operations
claiming a fix was tested
```

The prompt also requires:

```text
originalCode
```

to match the repository context.

The actual source modification is deferred to the later isolated repair stage.

---

# 10. AI Provider Architecture — Day 15

The current architecture is:

```text
createAIProvider()
       ↓
AIProviderManager
       │
       ├── OpenRouter → Primary
       ├── Groq       → Secondary
       └── Gemini     → Tertiary
```

Important files:

```text
src/ai/ai.provider.ts
src/ai/ai.provider.factory.ts
```

Do not use invented paths such as:

```text
src/ai/a.factory.js
src/ai/ai.type.js
```

Do not rename the architecture to `FallbackAIProvider`.

## Provider Switching

Observed behavior:

```text
OpenRouter
    ↓
structured response failure
    ↓
Groq
    ↓
success
```

This confirms that `AIProviderManager` is correctly handling provider failures.

---

# 11. Current `buildRepositoryContext` Contract

The current function requires:

```ts
buildRepositoryContext(
  workspacePath,
  repositoryId,
  metadata?
)
```

Correct:

```ts
const context =
  await buildRepositoryContext(
    repositoryPath,
    "fix-agent-test-repository"
  );
```

Incorrect:

```ts
const context =
  await buildRepositoryContext(
    repositoryPath
  );
```

The second argument is required by the current TypeScript signature.

---

# 12. Fix Agent Test

The test command is:

```powershell
npm run test:fix-agent -- "F:\RepoDoctor	est-generation-repo"
```

The test fixture contains:

```text
F:\RepoDoctor	est-generation-repo└── src    ├── calculator.ts
    └── calculator.test.ts
```

The intentional defect is:

```ts
export function divide(
  a: number,
  b: number
): number {
  return a / b;
}
```

The generated proposal correctly adds:

```ts
if (b === 0) {
  throw new Error('Division by zero');
}
```

Observed test:

```text
OpenRouter → failed with empty structured response
Groq       → succeeded
FixAgent   → succeeded
Validation → passed
Repository → unchanged
```

---

# 13. Why the First Fix Agent Test Failed

The first fixture already contained:

```ts
if (b === 0) {
  throw new Error("Cannot divide by zero");
}
```

The finding requested division-by-zero protection.

Because the code was already fixed, the AI could correctly return:

```text
changes: []
```

The Fix Agent validation rejected this because a fix proposal must contain an actual change.

The fixture was therefore intentionally changed to:

```ts
return a / b;
```

After that, the Fix Agent produced a valid `REPLACE` proposal.

---

# 14. Day 15 Database Model

A `FixProposal` Prisma model has been introduced as part of the repair-proposal architecture.

The intended relationship is:

```text
Analysis
   ↓
FixProposal
   ↓
Proposed Changes
```

The Prisma client generation succeeds.

However, the latest database state still has this issue:

```text
The table public.FixProposal does not exist in the current database.
```

The migration must be applied safely without resetting existing database data.

Never use:

```powershell
npx prisma migrate reset
```

for this purpose.

---

# 15. Current Important File Map

```text
server/src/
│
├── ai/
│   ├── ai.provider.ts
│   └── ai.provider.factory.ts
│
├── agents/
│   ├── bug-detection.agent.ts
│   ├── security.agent.ts
│   ├── test-generation.agent.ts
│   ├── fix.agent.ts
│   ├── fix.schema.ts
│   └── fix.types.ts
│
├── prompts/
│   └── fix.prompt.ts
│
├── context/
│   ├── context.builder.ts
│   ├── context.formatter.ts
│   └── context.types.ts
│
├── pipeline/
│   ├── analysis.pipeline.ts
│   ├── analysis.pipeline.types.ts
│   └── analysis.pipeline.errors.ts
│
├── risk/
│   ├── risk.types.ts
│   ├── risk.rules.ts
│   ├── risk.calculator.ts
│   └── risk.engine.ts
│
├── services/
│   ├── fix-generation.service.ts
│   ├── fix-proposal.service.ts
│   └── risk-assessment.service.ts
│
├── test-analysis-pipeline.ts
├── test-fix-agent.ts
└── test-risk-engine.ts
```

---

# 16. Commands Used in Days 11–15

## Build

```powershell
npm run build
```

## Risk Engine Test

```powershell
npm run test:risk-engine
```

## Unified Analysis Pipeline Test

```powershell
npm run test:analysis-pipeline -- "F:\RepoDoctor\security-test-repo" "<repository-id>"
```

## Fix Agent Test

```powershell
npm run test:fix-agent -- "F:\RepoDoctor	est-generation-repo"
```

## Prisma Client

```powershell
npx prisma generate
```

## Prisma Validation

```powershell
npx prisma validate
```

---

# 17. Day 11–15 Safety Invariants

RepoDoctor must continue to follow:

```text
Existing GitHub Repository
        ↓
READ ONLY
        ↓
Temporary/Isolated Workspace
        ↓
Analysis
        ↓
AI Proposal
        ↓
Future Repair Branch
        ↓
Docker Verification
        ↓
Pull Request
        ↓
Human Review
```

Never:

```text
direct push to main
force push
automatic merge
automatic deletion
host execution of untrusted repository code
```

Day 15 is proposal-only. Actual patch application belongs to the isolated repair workflow introduced after this milestone.

---

# 18. Day 15 Completion Status

```text
Day 11  Security Agent             ✅
Day 12  Test Generation Agent      ✅
Day 13  Risk & Severity Engine     ✅
Day 14  Unified Analysis Pipeline  ✅
Day 15  Fix Agent                  ✅
```

The core Day 15 Fix Agent generation and validation test is successful.

The remaining known infrastructure issue is the unapplied `FixProposal` table in the current Neon database.

---

# 19. Overall Architecture at Day 15

```text
                       GitHub Repository
                              │
                              │ READ ONLY
                              ▼
                     Isolated Workspace
                              │
                              ▼
                    Repository Context
                              │
                              ▼
                    Unified Analysis
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
         Bug Agent      Security Agent   Test Agent
              │               │               │
              └───────────────┼───────────────┘
                              ▼
                         Risk Engine
                              │
                              ▼
                        Risk Assessment
                              │
                              ▼
                          Fix Agent
                              │
                              ▼
                     Proposed FixResult
                              │
                              ▼
                       Fix Proposal
                              │
                              ▼
              Future Isolated Repair Workspace
                              │
                              ▼
                     Docker Verification
                              │
                              ▼
                         GitHub PR
```

This is the implementation baseline at the end of Day 15.
