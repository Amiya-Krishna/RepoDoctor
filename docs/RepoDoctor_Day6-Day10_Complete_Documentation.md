# RepoDoctor AI — Day 6 to Day 10 Complete Implementation Documentation

> **Scope:** Day 6 through Day 10  
> **Project:** RepoDoctor AI  
> **Purpose:** Complete technical documentation of the implementation, commands, command abbreviations/full forms, meanings, reasons for use, important files, architecture, testing and safety rules.
>
> **Important:** This document continues the Day 1–5 documentation. The database architecture from Day 4 onward is **PostgreSQL + Prisma**, not MongoDB/Mongoose. Docker remains part of the implementation environment.
>
> **Repository safety invariant:** User-owned/pre-existing GitHub repositories are **READ ONLY** during analysis. RepoDoctor must never directly modify, overwrite, force-push, delete, automatically merge, or execute untrusted repository code on the host.

---

# 1. Current Architecture at the Start of Day 6

The Day 1–5 foundation established:

```text
React
  ↓
Express / TypeScript
  ↓
JWT Authentication
  ↓
GitHub OAuth
  ↓
PostgreSQL + Prisma
  ↓
Repository Selection
  ↓
Disposable Workspace
  ↓
Safe Git Clone
  ↓
Repository Analysis
```

The AI layer added during Days 8–10 becomes:

```text
Repository
    ↓
Temporary isolated workspace
    ↓
Repository Analyzer
    ↓
Context Builder
    ↓
Bug Detection Agent
    ↓
AI Provider Manager
    ↓
AI Provider
```

The provider architecture was later expanded and is preserved after Day 10 as:

```text
AIProviderManager

OpenRouter  → Primary
Groq        → Secondary
Gemini      → Tertiary
```

---

# 2. Day-by-Day Summary

| Day | Main implementation | Main result |
|---|---|---|
| Day 6 | Repository Analyzer | Static repository metadata/snapshot |
| Day 7 | Analysis Dashboard / Results UI | Display repository analysis |
| Day 8 | AI Provider Abstraction | AI provider interface/factory |
| Day 9 | Context Builder | Safe structured repository context |
| Day 10 | Bug Detection Agent | AI-powered structured bug detection |

---

# 3. Day 6 — Repository Analyzer

## 3.1 Objective

The Repository Analyzer converts a cloned repository into structured metadata.

It should detect information such as:

```text
Project type
Language
Package manager
Framework
Test framework
Linter
TypeScript usage
Source files
Test files
Configuration files
Dependencies
Repository statistics
```

The analyzer is intentionally **static-analysis focused**.

At this stage it must NOT blindly execute:

```text
npm install
npm test
npm run build
```

against arbitrary repositories.

Why?

Because repository scripts and dependency lifecycle scripts can execute arbitrary commands.

---

# 4. Day 6 Architecture

```text
GitHub Repository
       ↓
Temporary Clone
       ↓
Repository Analyzer
       ↓
Repository Snapshot
       ↓
Prisma
       ↓
PostgreSQL
```

The analyzer reads files; it does not modify the original repository.

---

# 5. Important Day 6 Concepts

## Repository Analyzer

A component that inspects repository files and determines project characteristics.

## Static Analysis

Static analysis means inspecting source/configuration without executing the repository application.

Example:

```text
package.json
    ↓
Read dependencies
    ↓
Detect Express
    ↓
Detect TypeScript
    ↓
Detect Jest/Vitest
```

No application execution is required.

---

# 6. Day 6 Expected Analyzer Responsibilities

### 6.1 Language Detection

Examples:

```text
.ts
.tsx
.js
.jsx
.py
.java
```

For the current RepoDoctor scope, JavaScript/TypeScript repositories are especially important.

---

### 6.2 Package Manager Detection

Possible files:

```text
package-lock.json
yarn.lock
pnpm-lock.yaml
bun.lockb
```

Examples:

```text
package-lock.json → npm
yarn.lock         → Yarn
pnpm-lock.yaml    → pnpm
```

---

### 6.3 Framework Detection

From `package.json`, dependencies can indicate:

```text
express
react
next
vite
nestjs
```

The analyzer should report evidence-based detection rather than guessing.

---

### 6.4 Test Framework Detection

Examples:

```text
jest
vitest
mocha
cypress
playwright
```

---

### 6.5 Linter Detection

Examples:

```text
eslint
oxlint
```

---

### 6.6 TypeScript Detection

Possible evidence:

```text
tsconfig.json
.ts files
.tsx files
typescript dependency
```

---

### 6.7 File Inventory

The analyzer records:

```text
Source files
Test files
Configuration files
Directory structure
```

---

# 7. Day 6 PostgreSQL Persistence

The analysis result is associated with the repository.

Core relationship:

```text
User
 ↓
Repository
 ↓
Analysis
```

This makes it possible to keep analysis history.

Example:

```text
Repository
 ├── Analysis #1
 ├── Analysis #2
 └── Analysis #3
```

---

# 8. Prisma

## Full meaning

**Prisma** is a TypeScript/Node.js ORM and database toolkit.

## ORM

**ORM = Object-Relational Mapping**

It maps application objects/types to relational database records.

Example:

```ts
prisma.repository.findMany(...)
```

instead of manually constructing SQL for every operation.

---

# 9. Important Prisma Commands Used/Relevant to Day 6

## `npx`

`npx` is the Node package execution utility.

It allows locally installed package commands to be executed.

Example:

```powershell
npx prisma generate
```

---

## `npx prisma generate`

```powershell
npx prisma generate
```

### Meaning

Generates Prisma Client from:

```text
prisma/schema.prisma
```

### Why used

When the Prisma schema changes, the generated client must be updated.

---

## `npx prisma format`

```powershell
npx prisma format
```

### Meaning

Formats the Prisma schema.

### Why used

Keeps:

```text
schema.prisma
```

consistent and readable.

---

## `npx prisma validate`

```powershell
npx prisma validate
```

### Meaning

Validates the Prisma schema.

### Why used

Detects schema/configuration problems before using Prisma.

---

## `npx prisma migrate dev`

```powershell
npx prisma migrate dev --name <migration-name>
```

### Meaning

Creates/applies a development database migration.

### Why used

When RepoDoctor's database structure changes.

---

# 10. Day 6 Development Commands

From the server directory:

```powershell
cd server
```

### `cd`

**Change Directory**

Moves the terminal into another folder.

Example:

```powershell
cd C:\Users\amiya\OneDrive\Desktop\RepoDoctor\server
```

---

## Install dependencies

```powershell
npm install
```

### `npm`

**Node Package Manager**

Used to install/manage Node.js packages.

---

## Run development server

```powershell
npm run dev
```

This executes the `dev` script from `package.json`.

The development command uses:

```text
tsx watch src/server.ts
```

---

# 11. `tsx`

`tsx` is a TypeScript execution tool.

It allows:

```text
TypeScript
   ↓
direct development execution
```

without manually compiling every change first.

---

# 12. `watch`

`watch` means the process watches source files and restarts when relevant files change.

Therefore:

```text
npm run dev
       ↓
tsx watch src/server.ts
       ↓
Development server
```

---

# 13. Day 6 Analyzer Safety

The analyzer must NOT:

```text
npm install
npm test
npm run build
npm run dev
node malicious-file.js
```

against arbitrary repositories.

The reason is that these commands may execute repository-controlled code.

The correct architecture is:

```text
Read files
   ↓
Static analysis
   ↓
Store metadata
```

Execution comes only after a controlled container execution environment exists.

---

# 14. Day 7 — Repository Analysis Results UI

## Objective

Day 7 connects the backend analysis information to the frontend.

The purpose is to let the user see:

```text
Repository
   ↓
Analysis
   ↓
Detected technology
   ↓
Files
   ↓
Dependencies
   ↓
Analysis history
```

---

# 15. Day 7 UI Responsibilities

The frontend should present information such as:

```text
Repository name
Default branch
Language
Framework
Package manager
Test framework
Linter
TypeScript
Source-file count
Test-file count
Dependencies
Analysis status
Analysis history
```

---

# 16. Why Day 7 Matters

The AI system should not be treated as a black box.

A useful workflow is:

```text
Repository selected
       ↓
Repository analyzed
       ↓
User sees analysis
       ↓
AI analysis can be started
```

This also makes debugging easier.

---

# 17. Frontend → Backend Flow

Conceptually:

```text
React UI
   ↓
HTTP request
   ↓
Express API
   ↓
Prisma
   ↓
PostgreSQL
   ↓
JSON response
   ↓
React state
   ↓
Dashboard
```

---

# 18. API

## Full form

**API = Application Programming Interface**

An API defines how software components communicate.

For RepoDoctor:

```text
React
  ↓
API
  ↓
Express
  ↓
Prisma
  ↓
PostgreSQL
```

---

# 19. HTTP

## Full form

**HTTP = Hypertext Transfer Protocol**

It is used for communication between the frontend and backend.

Typical HTTP methods:

| Method | Meaning | Typical use |
|---|---|---|
| GET | Retrieve | Get repositories/analysis |
| POST | Create/start | Start analysis |
| PUT | Replace/update | Update resource |
| PATCH | Partial update | Modify part of resource |
| DELETE | Delete | Remove resource |

---

# 20. REST

## Full form

**REST = Representational State Transfer**

REST is a common style for designing HTTP APIs.

Example:

```text
GET /api/repositories
```

means retrieve repositories.

---

# 21. JSON

## Full form

**JSON = JavaScript Object Notation**

It is a common format for transferring structured data.

Example:

```json
{
  "language": "TypeScript",
  "framework": "Express"
}
```

---

# 22. Day 7 Frontend Verification

Run the backend:

```powershell
npm run dev
```

Then verify the frontend through its normal development command.

If the frontend uses Vite, the command is commonly:

```powershell
npm run dev
```

from the frontend directory.

The exact script should be taken from the frontend's `package.json`.

---

# 23. Day 8 — AI Provider Abstraction

## Objective

Day 8 introduces an abstraction layer between RepoDoctor agents and AI providers.

The agent should not be tightly coupled to a single AI provider.

Instead:

```text
Bug Agent
    ↓
AI Provider Interface
    ↓
Provider implementation
```

This is important because RepoDoctor uses multiple providers.

---

# 24. Why Provider Abstraction Is Necessary

Bad architecture:

```text
BugDetectionAgent
      ↓
OpenRouter-specific code
```

Better:

```text
BugDetectionAgent
      ↓
AI Provider abstraction
      ↓
AI Provider Manager
      ↓
OpenRouter / Groq / Gemini
```

The agent only cares about:

```text
generate response
```

It does not care which provider handles the request.

---

# 25. API Key

An API key is a credential used by an application to authenticate with an external API.

For RepoDoctor:

```text
OPENROUTER_API_KEY
```

must remain in environment configuration.

Never hardcode it into:

```text
source code
GitHub
README
frontend
AI prompts
```

---

# 26. `.env`

Example:

```env
OPENROUTER_API_KEY=your-key
```

The actual key must not be committed.

Use:

```text
.env
```

in `.gitignore`.

---

# 27. OpenRouter

OpenRouter is the primary AI provider for the current RepoDoctor architecture.

The model selected for the project is:

```env
OPENROUTER_MODEL=qwen/qwen3.8-27b:free
```

The application should read the model from environment/configuration rather than hardcoding provider-specific details inside agents.

---

# 28. AI Provider Interface

The abstraction concept is:

```text
AIProvider
```

An AI provider should expose a consistent operation such as:

```text
generate(...)
generateStructured(...)
```

The exact implementation belongs to the provider layer.

This allows agents to remain provider-independent.

---

# 29. AI Provider Manager

The current architecture uses:

```text
AIProviderManager
```

It is the central provider orchestration layer.

The provider order is:

```text
1. OpenRouter — Primary
2. Groq      — Secondary
3. Gemini    — Tertiary
```

If OpenRouter fails:

```text
OpenRouter
    ↓ fail
Groq
```

If Groq also fails:

```text
OpenRouter
    ↓ fail
Groq
    ↓ fail
Gemini
```

This behavior is owned by `AIProviderManager`.

---

# 30. Important Architecture Rule

Do NOT introduce:

```text
FallbackAIProvider
```

The project architecture/name is:

```text
AIProviderManager
```

The agents should not contain provider switching logic.

Correct:

```text
Agent
 ↓
AIProviderManager
 ↓
OpenRouter
 ↓
Groq
 ↓
Gemini
```

Incorrect:

```text
Agent
 ├── OpenRouter
 ├── Groq
 └── Gemini
```

---

# 31. Provider Factory

The project uses:

```text
createAIProvider()
```

The factory creates/returns the provider manager.

Conceptually:

```text
createAIProvider()
       ↓
AIProviderManager
       ↓
OpenRouter
Groq
Gemini
```

This gives one consistent entry point for AI agents.

---

# 32. Why a Factory Is Used

## Factory

A factory is a function/component responsible for creating an object while hiding the construction details from the caller.

Instead of:

```ts
const manager = new AIProviderManager(...);
```

every agent can use:

```ts
const provider = createAIProvider();
```

This reduces coupling.

---

# 33. Structured AI Output

AI output should not simply be treated as arbitrary text.

RepoDoctor needs structured data.

Example:

```json
{
  "findings": [
    {
      "title": "Possible null access",
      "severity": "HIGH",
      "filePath": "src/auth.ts",
      "lineStart": 42
    }
  ]
}
```

This can then be validated and stored in PostgreSQL.

---

# 34. Why JSON Schema Is Used

A JSON Schema defines what an AI response is allowed to contain.

For example:

```text
findings → array
severity → allowed values
lineStart → integer
confidence → number
```

This reduces malformed responses.

---

# 35. Day 8 AI Testing

A basic AI test command used in the project is:

```powershell
npm run test:ai
```

The script executes the configured AI test file, for example:

```text
tsx src/test-ai.ts
```

---

# 36. OpenRouter 401 Error Meaning

A previous test produced:

```text
401 Unauthorized
Missing Authentication header
```

## HTTP status `401`

**401 Unauthorized**

Usually indicates that the request was not authenticated correctly.

Typical causes:

```text
Missing API key
Wrong environment variable
Wrong Authorization header
Incorrect request construction
```

This should be debugged at the provider layer rather than weakening application security.

---

# 37. OpenRouter 429 Error Meaning

During the later provider-manager test, OpenRouter returned:

```text
429
```

## HTTP status `429`

**Too Many Requests**

It indicates that the upstream service is refusing the request because of rate/usage limits or related throttling.

The important architectural result was:

```text
OpenRouter → 429
      ↓
AIProviderManager
      ↓
Groq
      ↓
Successful response
```

This verified provider switching.

---

# 38. Day 9 — Context Builder

## Objective

The Context Builder converts repository information into an AI-readable context.

Instead of blindly sending an entire repository to an AI model:

```text
Repository
   ↓
Context Builder
   ↓
Relevant structured context
   ↓
AI Agent
```

---

# 39. Why Context Builder Is Important

Large repositories may contain:

```text
node_modules
.git
build output
binary files
lock files
generated files
large assets
```

Sending everything to an AI model is inefficient and can exceed context limits.

The Context Builder should select useful source information.

---

# 40. Context Builder Responsibilities

The context layer can include:

```text
Repository metadata
Project type
Language
Framework
Package manager
Dependencies
Important configuration
Relevant source files
Relevant test files
Directory structure
```

---

# 41. Context Safety

The context builder must never include:

```text
GitHub access token
OAuth token
API keys
.env secret values
passwords
private credentials
```

unless a later security-specific workflow explicitly needs a safe representation.

Even then, secrets should not be unnecessarily exposed to the model.

---

# 42. Context Formatting

The repository context is transformed into a deterministic text structure.

Conceptually:

```text
Repository Metadata

Project:
Node.js

Language:
TypeScript

Framework:
Express

Files:

--- src/auth.ts ---
<source>

--- src/server.ts ---
<source>
```

This gives the AI clear boundaries.

---

# 43. Why File Boundaries Matter

The model must be able to identify:

```text
which code belongs to which file
```

Therefore context should preserve:

```text
file path
file content
```

rather than merging everything into one ambiguous text block.

---

# 44. Line Numbers

Line numbers are important for AI findings.

Example:

```text
src/auth.ts:42
```

A later bug/security finding can reference:

```text
filePath = src/auth.ts
lineStart = 42
```

This makes findings actionable.

---

# 45. Context Filtering

The context builder should prefer useful source files.

Typical exclusions:

```text
.git/
node_modules/
dist/
build/
coverage/
```

Potentially large binary assets should also be excluded.

The exact filtering policy should be implemented centrally rather than duplicated across every AI agent.

---

# 46. Day 9 Pipeline

```text
Temporary Repository
        ↓
Repository Analyzer
        ↓
Repository Snapshot
        ↓
Context Builder
        ↓
Formatted Repository Context
        ↓
AI Agent
```

This creates a clean boundary:

```text
Repository ingestion
        ≠
AI reasoning
```

---

# 47. Day 10 — Bug Detection Agent

## Objective

Day 10 introduces the first actual AI analysis agent.

The agent analyzes repository context and identifies potential bugs.

Pipeline:

```text
Repository
    ↓
Analyzer
    ↓
Context Builder
    ↓
BugDetectionAgent
    ↓
AIProviderManager
    ↓
OpenRouter
    ↓ fail
Groq
    ↓ fail
Gemini
    ↓
Structured Bug Findings
```

---

# 48. What the Bug Detection Agent Should Detect

Examples:

```text
Null/undefined access
Incorrect conditions
Broken async/await logic
Missing error handling
Incorrect return values
Potential race conditions
Incorrect state transitions
Obvious type-related logic errors
API misuse
Boundary/edge-case bugs
```

It should not report every style issue as a bug.

---

# 49. Bug Finding Structure

A structured bug finding can contain:

```text
title
description
severity
filePath
lineStart
lineEnd
evidence
suggestedFix
confidence
```

Example:

```json
{
  "title": "Possible undefined access",
  "description": "The code accesses a property before verifying that the object exists.",
  "severity": "HIGH",
  "filePath": "src/auth.ts",
  "lineStart": 42,
  "lineEnd": 42,
  "evidence": "...",
  "suggestedFix": "Validate the object before accessing the property.",
  "confidence": 0.91
}
```

---

# 50. Bug Severity

Typical severity levels:

```text
LOW
MEDIUM
HIGH
CRITICAL
```

Severity should describe potential impact, not how interesting the finding is.

---

# 51. Confidence

Confidence is different from severity.

Example:

```text
Severity: HIGH
Confidence: 0.94
```

means:

```text
If this issue is real, it could have significant impact,
and the agent has high confidence that the evidence supports it.
```

---

# 52. Bug Detection Prompt

The system prompt should instruct the model to:

```text
Only report evidence-supported bugs.
Do not invent files.
Do not invent line numbers.
Do not invent functions.
Do not report generic advice as a bug.
Prefer fewer high-confidence findings.
Return structured JSON.
```

This reduces hallucinations.

---

# 53. Why Validation Is Necessary

LLMs can return:

```text
nonexistent file
incorrect line number
invalid severity
invalid JSON
```

Therefore the application validates the result after receiving it.

Example validation:

```text
AI says:
src/payment.ts

Repository contains:
src/auth.ts
src/server.ts
```

The finding should be rejected.

---

# 54. NodeNext / ESM Configuration

The project uses:

```text
ESM
NodeNext
```

This changes how imports are written.

For local imports, use explicit `.js` extensions in TypeScript source imports.

Correct:

```ts
import { something } from "./something.js";
```

Incorrect for the configured NodeNext setup:

```ts
import { something } from "./something";
```

---

# 55. Why `.js` Is Used in TypeScript Imports

This is a common point of confusion.

The source file may physically be:

```text
something.ts
```

but the compiled runtime file is:

```text
something.js
```

With NodeNext/ESM, the runtime import should resolve to the emitted JavaScript file.

Therefore:

```ts
import { something } from "./something.js";
```

is correct.

---

# 56. `import type`

When importing only a TypeScript type:

```ts
import type { BugFinding } from "./bug.types.js";
```

`import type` makes it explicit that the import exists only for type information.

This matters in strict ESM/TypeScript configurations.

---

# 57. Typical NodeNext Build Command

```powershell
npm run build
```

The `build` script normally runs the TypeScript compiler.

If configured as:

```json
{
  "scripts": {
    "build": "tsc"
  }
}
```

then:

```text
npm run build
      ↓
tsc
      ↓
TypeScript compilation
```

---

# 58. `tsc`

## Full form

**TypeScript Compiler**

It converts TypeScript source into JavaScript according to the project's TypeScript configuration.

---

# 59. Day 10 AI Test

The project uses a test script similar to:

```powershell
npm run test:ai
```

This verifies that the configured AI provider layer can communicate with the upstream AI service.

The later provider-manager test verified:

```text
OpenRouter failure
       ↓
AIProviderManager
       ↓
Groq success
```

This is an important milestone because the agent layer no longer depends on one provider.

---

# 60. Bug Detection Agent Architecture

```text
                 Repository
                     ↓
             Context Builder
                     ↓
             BugDetectionAgent
                     ↓
             AIProviderManager
                     │
          ┌──────────┼──────────┐
          ↓          ↓          ↓
      OpenRouter    Groq       Gemini
       Primary    Secondary   Tertiary
          │
          ↓
   Structured JSON result
          ↓
       Validation
          ↓
    Bug Findings
```

---

# 61. Day 6–10 Complete Architecture

```text
                         GitHub
                           │
                           ▼
                  Repository Metadata
                           │
                           ▼
                 Disposable Workspace
                           │
                           ▼
                    Static Analyzer
                           │
                           ▼
                  Repository Snapshot
                           │
                           ▼
                    Context Builder
                           │
             ┌─────────────┴─────────────┐
             │                           │
             ▼                           ▼
       Repository UI               Bug Detection
                                         │
                                         ▼
                                AIProviderManager
                                         │
                         ┌───────────────┼───────────────┐
                         ▼               ▼               ▼
                    OpenRouter         Groq            Gemini
                     Primary         Secondary         Tertiary
                         │
                         ▼
                  Structured Findings
                         │
                         ▼
                 PostgreSQL + Prisma
```

---

# 62. Command Reference — Full Forms and Meaning

| Command / term | Full form / meaning | Why RepoDoctor uses it |
|---|---|---|
| `npm` | Node Package Manager | Manage Node dependencies/scripts |
| `npx` | Node package execution utility | Execute local package commands |
| `npm install` | Install dependencies | Install project packages |
| `npm ci` | Clean dependency installation | Reproducible Docker/build installs |
| `npm run dev` | Run development script | Start development server |
| `npm run build` | Run build script | Compile/verify project |
| `tsx` | TypeScript execution tool | Run TypeScript during development |
| `watch` | Watch source files | Restart development process after changes |
| `tsc` | TypeScript Compiler | Compile TypeScript |
| `Prisma` | TypeScript/Node ORM toolkit | Database access |
| `ORM` | Object-Relational Mapping | Map application models to database |
| `PostgreSQL` | Relational database system | Persistent structured storage |
| `SQL` | Structured Query Language | Relational database language |
| `API` | Application Programming Interface | Software-to-software communication |
| `HTTP` | Hypertext Transfer Protocol | Web/API communication |
| `REST` | Representational State Transfer | HTTP API design style |
| `JSON` | JavaScript Object Notation | Structured API/AI data |
| `JWT` | JSON Web Token | Authentication |
| `OAuth` | Open Authorization | GitHub authorization |
| `CUID` | Collision-resistant Unique Identifier | Prisma-generated IDs |
| `UUID` | Universally Unique Identifier | Temporary workspace IDs |
| `ESM` | ECMAScript Modules | JavaScript module system |
| `NodeNext` | Node.js-aware TypeScript module resolution mode | Correct ESM/Node integration |
| `AI` | Artificial Intelligence | Repository reasoning |
| `LLM` | Large Language Model | Code analysis/generation |
| `CI` | Continuous Integration | Reproducible automated build context |
| `CLI` | Command-Line Interface | Terminal commands/tools |
| `UI` | User Interface | Frontend presentation |
| `CRUD` | Create, Read, Update, Delete | Basic data operations |
| `HTTP 401` | Unauthorized | Authentication problem |
| `HTTP 429` | Too Many Requests | Rate/usage limiting |
| `.env` | Environment configuration file | Local secrets/configuration |
| `Git` | Distributed version-control system | Repository operations |
| `GitHub` | Git hosting/collaboration platform | Source repository integration |

---

# 63. Command-by-Command Quick Reference

## Enter server directory

```powershell
cd server
```

**`cd` = Change Directory**

Used to move into the backend directory.

---

## Install dependencies

```powershell
npm install
```

Used when dependencies need to be installed.

---

## Clean installation

```powershell
npm ci
```

Used especially in reproducible/container builds.

---

## Start development server

```powershell
npm run dev
```

Runs the project's development script.

---

## Build project

```powershell
npm run build
```

Runs the project's build script.

---

## Test AI integration

```powershell
npm run test:ai
```

Runs the project's AI integration test.

---

## Format Prisma schema

```powershell
npx prisma format
```

Formats the Prisma schema.

---

## Validate Prisma schema

```powershell
npx prisma validate
```

Checks whether the Prisma schema is valid.

---

## Generate Prisma Client

```powershell
npx prisma generate
```

Generates the Prisma database client.

---

## Create development migration

```powershell
npx prisma migrate dev --name <name>
```

Creates/applies a development database migration.

---

## Run Docker

```powershell
docker compose up -d
```

Starts Compose services in detached mode.

### `-d`

**Detached**

Runs containers in the background.

---

## Stop Docker

```powershell
docker compose down
```

Stops/removes Compose containers.

---

## Build Docker image

```powershell
docker compose build server
```

Builds the `server` service image.

---

## Force fresh Docker build

```powershell
docker compose build --no-cache server
```

### `--no-cache`

Prevents Docker from reusing cached build layers.

---

## Restart server container

```powershell
docker compose restart server
```

Restarts the server service.

---

## View live logs

```powershell
docker compose logs -f server
```

### `-f`

**Follow**

Continuously displays new log output.

---

## Enter server container

```powershell
docker compose exec server sh
```

### `exec`

**Execute**

Runs a command inside an already-running container.

### `sh`

Shell.

---

# 64. Git Commands Used for Documentation/Version Control

## Check status

```powershell
git status
```

Shows changed/untracked files.

---

## View changes

```powershell
git diff
```

Shows code differences.

---

## Stage files

```powershell
git add .
```

Stages project changes.

---

## Commit

```powershell
git commit -m "message"
```

Creates a Git commit.

### `-m`

**Message**

Specifies the commit message.

---

## Push

```powershell
git push
```

Uploads commits to the configured remote repository.

### Important

This should only push changes to the **RepoDoctor development repository**.

RepoDoctor must not use this mechanism to push to a user's analyzed repository.

---

# 65. Docker Shell Commands

Once inside:

```text
/app/server #
```

you are inside the container.

Do not run:

```powershell
docker compose ...
```

inside the container.

Use normal Linux commands.

---

## List files

```sh
ls -la
```

`ls` = list directory contents.

`-l` = long/detailed format.

`-a` = include hidden files.

---

## Find directories

```sh
find /tmp/repodoctor -maxdepth 3 -type d
```

`find` searches filesystem entries.

`-maxdepth 3` limits traversal depth.

`-type d` selects directories.

---

## Find files

```sh
find /tmp/repodoctor -maxdepth 4 -type f | head -30
```

`-type f` selects regular files.

`head -30` displays the first 30 lines/results.

---

## Check Git

```sh
git --version
```

Verifies Git installation inside the container.

---

# 66. ESM + NodeNext Command/Code Rules

For local imports:

```ts
import { something } from "./something.js";
```

Not:

```ts
import { something } from "./something";
```

For type-only imports:

```ts
import type { Something } from "./something.js";
```

Build verification:

```powershell
npm run build
```

---

# 67. Important Environment Variables

Typical configuration includes:

```env
DATABASE_URL=...
JWT_SECRET=...
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
GITHUB_CALLBACK_URL=...

OPENROUTER_API_KEY=...
OPENROUTER_MODEL=qwen/qwen3.8-27b:free
```

Never commit real secrets.

Use:

```text
.env
```

locally and keep it excluded through `.gitignore`.

---

# 68. AI Provider Configuration

Current provider hierarchy:

```text
PRIMARY
OpenRouter
Model:
qwen/qwen3.8-27b:free

SECONDARY
Groq

TERTIARY
Gemini
```

The manager owns switching:

```text
AIProviderManager
      ↓
OpenRouter
      ↓ failure
Groq
      ↓ failure
Gemini
```

Do not move this logic into individual agents.

---

# 69. Day 6–10 Safety Model

This is mandatory.

## Original repository

```text
READ ONLY
```

RepoDoctor must never:

```text
Modify
Overwrite
Delete
Force-push
Auto-merge
Directly commit
```

to the user's existing repository during analysis.

---

## Analysis workspace

```text
Disposable
Isolated
Temporary
```

The repository should be cloned into a workspace separate from the user's source repository.

---

## AI access

AI should receive:

```text
Relevant repository context
```

not:

```text
GitHub access token
OAuth credentials
Database password
API keys
.env secrets
```

---

# 70. Why This Safety Model Matters

The central product promise is:

```text
RepoDoctor analyzes your repository
without damaging your repository.
```

Therefore:

```text
Source Repository
      ↓
Read-only clone
      ↓
Analysis
      ↓
AI
```

is fundamentally different from:

```text
AI
 ↓
directly edits GitHub repository
```

The second architecture is unsafe and must not be used.

---

# 71. Day 6–10 Verification Checklist

## Day 6

```text
[ ] Repository analyzer exists
[ ] Language detection works
[ ] Package manager detection works
[ ] Framework detection works
[ ] Test framework detection works
[ ] Linter detection works
[ ] TypeScript detection works
[ ] File inventory works
[ ] Dependency inventory works
[ ] Analysis can be persisted
[ ] Arbitrary repository scripts are not executed
```

---

## Day 7

```text
[ ] Analysis results are available to frontend
[ ] Repository metadata is displayed
[ ] Analysis status is visible
[ ] Analysis history is accessible
[ ] API responses are structured JSON
[ ] UI does not expose secrets
```

---

## Day 8

```text
[ ] AI provider abstraction exists
[ ] createAIProvider() exists
[ ] AIProviderManager is central
[ ] OpenRouter is configured
[ ] API key comes from environment
[ ] Structured output is supported
[ ] AI integration test works
```

---

## Day 9

```text
[ ] Context builder exists
[ ] Repository metadata is included
[ ] Relevant files are included
[ ] File paths are preserved
[ ] Large/unnecessary directories are filtered
[ ] Secrets are excluded
[ ] Context is deterministic and structured
```

---

## Day 10

```text
[ ] BugDetectionAgent exists
[ ] Agent uses AIProviderManager
[ ] Agent does not instantiate providers directly
[ ] Bug schema exists
[ ] AI output is validated
[ ] File paths are validated
[ ] Line numbers are validated
[ ] Confidence is validated
[ ] AI test succeeds
```

---

# 72. Final Day 6–10 Pipeline

After Day 10:

```text
                    GitHub
                       │
                       ▼
              Repository Metadata
                       │
                       ▼
              Disposable Workspace
                       │
                       ▼
              Repository Analyzer
                       │
                       ▼
              Repository Snapshot
                       │
                       ▼
                Context Builder
                       │
                       ▼
              BugDetectionAgent
                       │
                       ▼
              AIProviderManager
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
      OpenRouter      Groq        Gemini
       Primary      Secondary    Tertiary
          │
          ▼
       AI Result
          │
          ▼
       Validation
          │
          ▼
    Bug Findings
          │
          ▼
 PostgreSQL + Prisma
```

---

# 73. Most Important Commands — Final Cheat Sheet

```powershell
# Enter backend
cd server

# Install dependencies
npm install

# Development server
npm run dev

# Build
npm run build

# AI integration test
npm run test:ai

# Prisma formatting
npx prisma format

# Prisma validation
npx prisma validate

# Generate Prisma Client
npx prisma generate

# Development migration
npx prisma migrate dev --name <migration-name>

# Docker start
docker compose up -d

# Docker stop
docker compose down

# Docker build
docker compose build server

# Fresh Docker build
docker compose build --no-cache server

# Docker restart
docker compose restart server

# Docker logs
docker compose logs -f server

# Enter server container
docker compose exec server sh

# Git status
git status

# Git diff
git diff

# Stage changes
git add .

# Commit
git commit -m "message"

# Push RepoDoctor changes
git push
```

---

# 74. Day 6–10 Interview Explanation

If an interviewer asks:

> "What did you build in the first 10 days?"

A technically accurate explanation is:

```text
I built RepoDoctor's repository analysis foundation.

First, I created a static repository analyzer that detects project
metadata, languages, frameworks, package managers, testing tools,
linters, dependencies and source/test files.

The repository is cloned into a disposable isolated workspace rather
than being modified directly.

Then I built the analysis result layer using PostgreSQL and Prisma.

After that I introduced an AI provider abstraction so the AI agents
are not coupled to a single provider.

The current AI architecture uses an AIProviderManager with OpenRouter
as the primary provider, Groq as the secondary provider and Gemini as
the tertiary provider.

I then built a Context Builder that converts repository information
into structured AI-readable context while filtering unnecessary files
and protecting credentials.

Finally, I implemented the Bug Detection Agent. It analyzes the
structured repository context and returns validated structured bug
findings with file paths, line ranges, severity and confidence.

The important design decision is that the agent layer is separated
from provider-specific logic, and user repositories remain read-only
during analysis.
```

---

# 75. Final Architecture Principles

The following principles must remain unchanged in future RepoDoctor implementation:

### Principle 1 — Repository Safety

```text
User Repository = READ ONLY
```

### Principle 2 — Isolation

```text
Repository work = Disposable Workspace
```

### Principle 3 — Database

```text
PostgreSQL + Prisma
```

not MongoDB/Mongoose.

### Principle 4 — AI Provider Architecture

```text
AIProviderManager
    ↓
OpenRouter
    ↓
Groq
    ↓
Gemini
```

### Principle 5 — No `FallbackAIProvider`

The project architecture/name remains:

```text
AIProviderManager
```

### Principle 6 — ESM + NodeNext

Use:

```ts
./module.js
```

for local runtime imports.

### Principle 7 — AI Validation

Never trust raw LLM output.

```text
AI output
   ↓
Schema validation
   ↓
Application validation
   ↓
Database
```

### Principle 8 — Secrets

Never expose:

```text
API keys
GitHub tokens
OAuth secrets
DATABASE_URL credentials
.env values
```

to the AI model unnecessarily.

### Principle 9 — No Arbitrary Execution

Do not execute:

```text
npm install
npm test
npm run build
```

against arbitrary repositories until the controlled Docker execution layer is ready.

### Principle 10 — Depth Over Shortcuts

RepoDoctor should be built as:

```text
Safe ingestion
      ↓
Static analysis
      ↓
Structured context
      ↓
AI reasoning
      ↓
Validation
      ↓
Controlled execution
      ↓
Verified repair
      ↓
Human-reviewed PR
```

rather than allowing an AI model to directly manipulate a user's repository.

---

# 76. Day 6–10 Completion Status

```text
Day 6
Repository Analyzer
        ✓

Day 7
Analysis Results / Dashboard Layer
        ✓

Day 8
AI Provider Abstraction
        ✓

Day 9
Context Builder
        ✓

Day 10
Bug Detection Agent
        ✓
```

The Day 6–10 foundation is therefore:

```text
Repository
   ↓
Safe Workspace
   ↓
Analyzer
   ↓
Context Builder
   ↓
Bug Detection Agent
   ↓
AIProviderManager
   ↓
OpenRouter → Groq → Gemini
   ↓
Validated Structured Findings
   ↓
PostgreSQL + Prisma
```

---

# 77. Document Maintenance Rule

This file documents **Day 6–Day 10 only**.

Future implementation documentation should preserve these existing architectural decisions rather than silently replacing them:

```text
PostgreSQL + Prisma
Docker isolation
Read-only source repositories
AIProviderManager
OpenRouter → Groq → Gemini
ESM + NodeNext
Structured AI output
Validated findings
```

Any later architectural change should be explicitly documented as a migration rather than silently overwriting the existing design.
