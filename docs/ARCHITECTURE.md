# RepoDoctor AI — Architecture

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
```

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

## 9. Scope Control

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
