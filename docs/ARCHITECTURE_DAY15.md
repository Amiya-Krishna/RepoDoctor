# RepoDoctor AI — Architecture (Updated through Day 15)

## 1. High-Level Architecture

```text
                         ┌──────────────────┐
                         │   React Client   │
                         └────────┬─────────┘
                                  │
                                  ▼
                         ┌──────────────────┐
                         │ Express Backend  │
                         │   TypeScript     │
                         └───────┬──────────┘
                                 │
                ┌────────────────┼─────────────────┐
                ▼                ▼                 ▼
         JWT Authentication  GitHub OAuth    Repository API
                │                │                 │
                └────────────────┼─────────────────┘
                                 ▼
                         ┌──────────────────┐
                         │ PostgreSQL       │
                         │ + Prisma         │
                         └──────────────────┘
```

## 2. Repository Analysis Architecture

```text
GitHub Repository
      │
      │ READ ONLY
      ▼
Git Clone
      │
      ▼
Disposable Temporary Workspace
      │
      ▼
Repository Analyzer
      │
      ├── Project type
      ├── JavaScript / TypeScript
      ├── Package manager
      ├── Framework
      ├── Test framework
      ├── Linter
      ├── Source files
      └── Test files
      │
      ▼
Repository Snapshot
      │
      ▼
PostgreSQL + Prisma
```

## 3. Mandatory Repository Safety Model

The user's pre-existing GitHub repositories are treated as **read-only source material**.

### Prohibited

```text
Direct modification of source repository
Direct push to main/master
Force push
Automatic merge
Automatic deletion
Running untrusted repository code on host
Using the host filesystem as a permanent repository store
```

### Required

```text
GitHub source
    ↓
Disposable clone
    ↓
Isolated analysis
    ↓
Disposable repair workspace
    ↓
Dedicated repair branch
    ↓
Docker verification
    ↓
GitHub Pull Request
    ↓
Human review/merge
```

## 4. Future Repair Architecture

```text
Original Repository
       │
       │ clone
       ▼
Temporary Repair Workspace
       │
       ▼
repair/<unique-id>
       │
       ├── AI-generated change
       │
       ▼
Docker Test Environment
       │
       ├── tests
       ├── lint
       ├── type-check
       └── verification
       │
       ▼
Verification Agent
       │
       ├── FAIL → retry/replan
       │
       └── PASS
             │
             ▼
        GitHub PR
```

## 5. AI Architecture

The AI system will not receive an entire repository blindly.

```text
Repository
    ↓
Static Analyzer
    ↓
Repository Snapshot
    ↓
Issue Detection
    ↓
Relevant File Selection
    ↓
Context Builder
    ↓
AI Provider
    ↓
Structured Finding
```

The AI provider is intentionally abstracted so the project is not permanently coupled to a single vendor.

### Current Provider Architecture — Day 15

```text
createAIProvider()
       ↓
AIProviderManager
       │
       ├── OpenRouter → Primary
       ├── Groq       → Secondary
       └── Gemini     → Tertiary
```

`BugDetectionAgent`, `SecurityAgent`, `TestGenerationAgent`, and `FixAgent`
use the provider abstraction rather than directly depending on a vendor.

The project uses the class name `AIProviderManager`. Do not introduce or
rename this architecture to `FallbackAIProvider`.

Important current files:

```text
server/src/ai/ai.provider.ts
server/src/ai/ai.provider.factory.ts
```

These are the current provider abstraction/factory files. Do not invent
alternative paths such as `/ai/a.factory.js` or `/ai/ai.type.js`.

## 6. Future Agent Architecture

```text
                    Repository
                        │
                        ▼
                Analysis Pipeline
                        │
        ┌───────────────┼────────────────┐
        ▼               ▼                ▼
   Bug Agent       Security Agent    Test Agent
        │               │                │
        └───────────────┼────────────────┘
                        ▼
                  Risk Engine
                        │
                        ▼
                   Fix Agent
                        │
                        ▼
               Isolated Repair
                        │
                        ▼
                Verification Agent
                        │
             ┌──────────┴──────────┐
             ▼                     ▼
           FAIL                    PASS
             │                     │
        Re-plan/Retry              ▼
                              GitHub PR
```

## 7. Database Direction

Current database:

```text
PostgreSQL
    │
    └── Prisma
```

Core entities currently planned/used:

```text
User
  │
  └── Repository
          │
          └── Analysis
                 ├── Bug Findings
                 ├── Security Findings
                 └── Generated Tests
```

The exact Prisma relation/model names must remain the source of truth for implementation.

Future entities can include:

```text
Finding
FixAttempt
Verification
PullRequest
RepositoryMemory
AnalysisJob
```

These should be introduced only when their features are implemented.

## 8. Docker Direction

Docker is used for isolation.

The analysis environment must not receive:
- host filesystem access
- unrelated repository data
- database credentials
- GitHub credentials
- SSH keys

The eventual worker architecture will be:

```text
API
 ↓
Job Queue
 ↓
Worker
 ↓
Disposable Workspace
 ↓
Docker Analysis Container
 ↓
Results
 ↓
PostgreSQL
```

BullMQ + Redis is planned for the later production pipeline.

## 9. Current AI Safety Boundary

AI agents receive repository-derived context rather than blindly receiving the entire repository.

```text
Repository
    ↓
Static/metadata analysis
    ↓
Repository Snapshot
    ↓
Relevant Context
    ↓
AI Agent
    ↓
Structured Result
```

AI output is treated as untrusted data until validated against the relevant schema.

The Test Generation Agent does not execute generated tests as part of Day 12. Execution belongs to the later isolated Docker verification stage.


## 9A. Day 11–15 Analysis and Repair-Proposal Architecture

The analysis pipeline evolved through Days 11–15:

```text
Repository
    ↓
Repository Context Builder
    ↓
Shared AIProviderManager
    ↓
┌───────────────────────┐
│ BugDetectionAgent     │
│ SecurityAgent         │
│ TestGenerationAgent   │
└───────────┬───────────┘
            ↓
       Persist Findings
            ↓
       Risk Engine
            ↓
    Risk Assessment
            ↓
        FixAgent
            ↓
      Proposed Fix
            ↓
    FixProposal (DB)
            ↓
Future: isolated repair workspace
            ↓
Future: verification
            ↓
Future: Pull Request
```

### Day 13 — Risk Engine

Risk scoring is deterministic and separate from the LLM.

```text
Finding severity
      +
Confidence
      +
Category bonus
      ↓
Risk score
      ↓
LOW / MEDIUM / HIGH / CRITICAL
      ↓
P3 / P2 / P1 / P0
```

The risk engine consists of:

```text
src/risk/risk.types.ts
src/risk/risk.rules.ts
src/risk/risk.calculator.ts
src/risk/risk.engine.ts
src/services/risk-assessment.service.ts
```

### Day 14 — Unified Analysis Pipeline

The unified pipeline coordinates:

```text
Analysis RUNNING
      ↓
Repository Context
      ↓
Bug Detection
      ↓
Security Detection
      ↓
Test Generation
      ↓
Persist results
      ↓
Risk Evaluation
      ↓
Risk Assessment persistence
      ↓
Analysis COMPLETED
```

Current pipeline files:

```text
src/pipeline/analysis.pipeline.ts
src/pipeline/analysis.pipeline.types.ts
src/pipeline/analysis.pipeline.errors.ts
src/test-analysis-pipeline.ts
```

### Day 15 — Fix Agent

Day 15 adds a proposal-only repair stage.

```text
Bug/Security Finding
        ↓
Repository Context
        ↓
FixAgent
        ↓
Structured FixResult
        ↓
Strict validation
        ↓
Proposed changes
```

Fix Agent does **not** modify the repository.

Current files:

```text
src/agents/fix.agent.ts
src/agents/fix.schema.ts
src/agents/fix.types.ts
src/prompts/fix.prompt.ts
src/services/fix-generation.service.ts
src/services/fix-proposal.service.ts
src/test-fix-agent.ts
```

Each proposed change contains:

```text
filePath
changeType
startLine
endLine
originalCode
replacementCode
explanation
```

The safety boundary is:

```text
AI proposal
    ↓
Validate file exists
    ↓
Validate line range
    ↓
Validate original code
    ↓
Store proposal
    ↓
Future isolated workspace
```

No direct source-repository mutation is permitted.

## 10. Scope Control

Initial supported repositories:

- JavaScript
- TypeScript
- Node.js
- React
- Express
- Next.js
- Common JS/TS test frameworks

RepoDoctor will **not** claim to fix every possible bug or every programming language.

The technically defensible project claim is:

> RepoDoctor autonomously analyzes selected JavaScript/TypeScript repositories, identifies supported classes of issues, proposes/applies fixes in isolated environments, verifies them, and creates a GitHub pull request when validation succeeds.


## 11. Current File-Name / Signature Source of Truth

The following names are authoritative for implementation:

```text
src/ai/ai.provider.ts
src/ai/ai.provider.factory.ts
src/agents/fix.agent.ts
src/agents/fix.schema.ts
src/agents/fix.types.ts
src/prompts/fix.prompt.ts
src/services/fix-generation.service.ts
src/services/fix-proposal.service.ts
src/pipeline/analysis.pipeline.ts
src/context/context.builder.ts
```

Current `buildRepositoryContext` contract:

```ts
buildRepositoryContext(
  workspacePath,
  repositoryId,
  metadata?
)
```

Therefore test callers must provide the second argument, for example:

```ts
const context =
  await buildRepositoryContext(
    repositoryPath,
    "fix-agent-test-repository"
  );
```

Do not revert to a one-argument call.

## 12. Day 15 Provider-Switching Behavior

Provider failures are handled by `AIProviderManager`.

Example observed behavior:

```text
OpenRouter
   ↓
structured response failure
   ↓
Groq
   ↓
success
```

This confirms provider switching is functioning. Intermittent OpenRouter structured-output failures do not justify replacing `AIProviderManager`.
