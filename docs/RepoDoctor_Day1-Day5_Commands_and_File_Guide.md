# RepoDoctor AI — Day 1 to Day 5 Implementation Notes

> **Purpose:** This document explains what has been implemented from Day 1 through Day 5, the important commands used, the full forms/meaning of those commands, why they were used, and what each important project file handles.
>
> **Important architecture rule:** From Day 4 onward, RepoDoctor uses **PostgreSQL + Prisma**, not MongoDB/Mongoose, and Docker is part of the implementation environment.
>
> **Safety rule:** Existing GitHub repositories are treated as **read-only** during analysis/ingestion. Repository work is performed in isolated temporary workspaces. No direct modification, force-push, automatic merge, or deletion of an existing repository is allowed.

---

# 1. Project Overview

## What is RepoDoctor AI?

RepoDoctor AI is a full-stack AI-powered repository analysis and repair system.

The planned system can:

1. Connect a user's GitHub account.
2. Discover/select repositories.
3. Safely ingest a repository.
4. Analyze its structure and configuration.
5. Detect bugs/security issues.
6. Generate tests/fixes using AI.
7. Validate fixes in isolated environments.
8. Create a repair branch and eventually a Pull Request only after verification.

## Current progress

| Day | Main work | Status |
|---|---|---|
| Day 1 | Project/backend foundation | Completed |
| Day 2 | Authentication foundation | Completed |
| Day 3 | GitHub OAuth/connection foundation | Completed |
| Day 4 | PostgreSQL + Prisma repository layer | Completed |
| Day 5 | Docker + safe repository ingestion | Completed |

---

# 2. Technology Stack

## Backend

- Node.js
- Express.js
- TypeScript
- Prisma ORM
- PostgreSQL
- JWT authentication
- GitHub OAuth/API integration

## Infrastructure

- Docker
- Docker Compose
- Alpine Linux based Node image
- Temporary isolated repository workspace

## Database

- PostgreSQL
- Neon PostgreSQL was used as the cloud database
- Prisma is used as the ORM/database client

## Repository operations

- Git
- `git clone`
- Shallow clone using `--depth 1`
- Specific default branch using `--branch`

---

# 3. Day 1 — Project and Backend Foundation

Day 1 established the basic backend structure and development environment.

A typical backend structure used in the project is:

```text
RepoDoctor/
├── server/
│   ├── src/
│   │   ├── config/
│   │   ├── controllers/
│   │   ├── middleware/
│   │   ├── routes/
│   │   ├── services/
│   │   └── server.ts
│   ├── prisma/
│   │   └── schema.prisma
│   ├── package.json
│   └── Dockerfile
├── docker-compose.yml
└── ...
```

---

# 4. Important Command: npm

## `npm`

**Full form:** Node Package Manager.

`npm` is the package manager normally used with Node.js projects.

It is used to:

- install dependencies
- remove dependencies
- run project scripts
- manage `package.json`
- manage `package-lock.json`

---

## `npm install`

```powershell
npm install
```

### What it does

Reads `package.json` and installs the project's dependencies into:

```text
node_modules/
```

It also creates/updates:

```text
package-lock.json
```

### Why RepoDoctor uses it

The backend needs packages such as Express, Prisma, JWT libraries, TypeScript tooling, etc.

---

# 5. `npm run dev`

```powershell
npm run dev
```

This executes the `dev` script defined in `package.json`.

The server currently uses:

```text
tsx watch src/server.ts
```

## `tsx`

`tsx` is a TypeScript execution tool.

It allows TypeScript files to be executed during development without manually compiling them first.

## `watch`

`watch` means the process watches source files for changes and restarts/reloads when appropriate.

So:

```text
npm run dev
        ↓
tsx watch src/server.ts
        ↓
server starts
```

The server has been running on:

```text
http://localhost:5000
```

---

# 6. TypeScript

## `.ts`

`.ts` means a TypeScript source file.

Example:

```text
server/src/server.ts
```

TypeScript adds static typing to JavaScript.

For example:

```ts
const port: number = 5000;
```

The declared type is `number`.

---

# 7. Express.js

RepoDoctor's backend uses Express.

Express handles:

- HTTP requests
- routes
- middleware
- request/response processing
- API endpoints

Example:

```ts
app.use("/api/repositories", repositoryRoutes);
```

This means repository routes are available below:

```text
/api/repositories
```

---

# 8. Day 2 — Authentication Foundation

RepoDoctor uses JWT-based authentication.

## JWT

**Full form:** JSON Web Token.

JWT is commonly used to represent authenticated user information between a client and server.

The flow is approximately:

```text
User logs in
     ↓
Server verifies credentials
     ↓
Server creates JWT
     ↓
Client stores/sends JWT
     ↓
Protected API receives JWT
     ↓
Middleware verifies JWT
     ↓
Request is allowed
```

---

# 9. Bearer Token

In Postman, protected endpoints are called using:

```text
Authorization
Bearer <JWT>
```

The word:

```text
Bearer
```

indicates that the token is being supplied as an HTTP bearer authentication credential.

---

# 10. Authentication Middleware

Important file:

```text
server/src/middleware/auth.middleware.ts
```

## Responsibility

This middleware protects private API routes.

It:

1. Reads the Authorization header.
2. Extracts the JWT.
3. Verifies the JWT.
4. Extracts user information.
5. Places authenticated user information on the request.
6. Rejects invalid/expired tokens.

The repository routes use:

```ts
protect
```

before protected handlers.

---

# 11. JWT Expiration Error

During testing we encountered:

```text
TokenExpiredError: jwt expired
```

This means the JWT had passed its expiration time.

The solution was not to weaken authentication.

Instead:

1. Log in again.
2. Obtain a fresh JWT.
3. Replace the old Bearer Token in Postman.

This is correct security behavior.

---

# 12. Day 3 — GitHub Connection

RepoDoctor connects the user's GitHub account.

The GitHub connection stores information required to work with repositories.

Relevant information includes:

- GitHub user ID
- GitHub username
- GitHub access token

The server log confirmed:

```text
GitHub user: Amiya-Krishna
GitHub ID: ...
GitHub connection saved successfully
```

This confirmed the GitHub connection was being saved successfully.

---

# 13. GitHub OAuth — Basic Meaning

## OAuth

**Full form:** Open Authorization.

OAuth allows an application to obtain authorized access to another service without asking the user to give the application their normal service password.

In RepoDoctor:

```text
RepoDoctor
    ↓
GitHub authorization
    ↓
User approves
    ↓
GitHub sends authorization result
    ↓
RepoDoctor obtains GitHub access token
    ↓
Token is associated with the user
```

The token can then be used for authorized GitHub API/repository operations.

---

# 14. Day 4 — PostgreSQL + Prisma

This was a major architecture change.

The original MongoDB/Mongoose direction was replaced with:

```text
PostgreSQL + Prisma
```

This is the required architecture from Day 4 onward.

---

# 15. PostgreSQL

## PostgreSQL

PostgreSQL is an open-source relational database management system.

It stores structured relational data in tables.

RepoDoctor stores information such as:

- users
- repositories
- analyses

---

# 16. Prisma

## Prisma

Prisma is an ORM/database toolkit for Node.js and TypeScript.

ORM means:

**Object-Relational Mapping**

Prisma allows application code to work with database records through typed APIs.

For example:

```ts
prisma.repository.findMany(...)
```

instead of manually writing every SQL query.

---

# 17. Prisma Schema

Important file:

```text
server/prisma/schema.prisma
```

This defines the database models and relationships.

The Repository model currently contains fields such as:

```prisma
model Repository {
  id            String     @id @default(cuid())
  githubId      String     @unique
  name          String
  fullName      String
  ownerLogin    String
  defaultBranch String
  private       Boolean    @default(false)
  htmlUrl       String
  cloneUrl      String
  userId        String
  createdAt     DateTime   @default(now())
  updatedAt     DateTime   @updatedAt
  analyses      Analysis[]
  user          User       @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
}
```

---

# 18. Important Prisma Annotations

## `@id`

```prisma
id String @id
```

Marks the field as the primary key.

---

## `@default(cuid())`

```prisma
@default(cuid())
```

Automatically generates a unique ID using CUID.

CUID means:

**Collision-resistant Unique Identifier**

---

## `@unique`

```prisma
githubId String @unique
```

Prevents duplicate GitHub IDs in that field.

---

## `@default(false)`

```prisma
private Boolean @default(false)
```

If no value is supplied, the database uses `false`.

---

## `@default(now())`

```prisma
createdAt DateTime @default(now())
```

Automatically stores the creation timestamp.

---

## `@updatedAt`

```prisma
updatedAt DateTime @updatedAt
```

Prisma automatically updates this timestamp when the record changes.

---

## `@relation`

```prisma
user User @relation(...)
```

Defines a relationship between database models.

---

## `@@index`

```prisma
@@index([userId])
```

Creates an index to make queries involving `userId` more efficient.

---

# 19. DATABASE_URL

The application connects to PostgreSQL through:

```env
DATABASE_URL="postgresql://..."
```

The URL contains database connection information.

Typical structure:

```text
postgresql://USERNAME:PASSWORD@HOST/DATABASE?OPTIONS
```

The actual password/token should never be committed to GitHub.

---

# 20. `npx`

## `npx`

`npx` is a Node.js package execution utility.

It allows commands from npm packages to be executed without necessarily installing the command globally.

Example:

```powershell
npx prisma generate
```

---

# 21. `npx prisma generate`

```powershell
npx prisma generate
```

## What it does

Generates the Prisma Client based on:

```text
prisma/schema.prisma
```

The application then uses the generated client:

```ts
import { prisma } from "../config/prisma";
```

---

# 22. `npx prisma db pull`

```powershell
npx prisma db pull
```

## Meaning

`db pull` introspects the existing database.

It reads the database structure and updates:

```text
prisma/schema.prisma
```

This command was used successfully during RepoDoctor setup.

It reported:

```text
Introspected 3 models
```

This confirmed that the application could reach the Neon PostgreSQL database.

---

# 23. Prisma Database Connection Verification

Inside the server container we successfully executed:

```powershell
npx prisma db pull
```

and Prisma connected to the Neon PostgreSQL database.

This verified:

```text
Docker
   ↓
Node container
   ↓
Network
   ↓
Neon PostgreSQL
```

was working.

---

# 24. Prisma Repository Service

Important file:

```text
server/src/services/repository.service.ts
```

This file handles repository database operations.

It contains:

```ts
saveRepository(...)
```

and:

```ts
getUserRepositories(...)
```

---

# 25. `saveRepository()`

Purpose:

Save or update a GitHub repository record.

It uses:

```ts
prisma.repository.upsert(...)
```

## Upsert

**Upsert = Update + Insert**

It means:

- if the record exists → update it
- if it does not exist → create it

RepoDoctor uses the GitHub repository ID as the unique identifier.

---

# 26. `getUserRepositories()`

Purpose:

Retrieve repositories belonging to a specific user.

It uses:

```ts
prisma.repository.findMany({
  where: {
    userId,
  }
})
```

This ensures repositories are scoped to the authenticated user.

---

# 27. Repository Routes

Important file:

```text
server/src/routes/repository.routes.ts
```

Current important routes:

```ts
router.get("/", protect, listRepositories);

router.post("/ingest", protect, ingest);
```

Therefore:

```text
GET  /api/repositories
POST /api/repositories/ingest
```

are protected routes.

---

# 28. Repository Controller

Important file:

```text
server/src/controllers/repository.controller.ts
```

Purpose:

Handle HTTP requests related to repositories.

It gets the authenticated user:

```ts
const userId = (req as any).user.userId;
```

Then calls the repository service:

```ts
getUserRepositories(userId)
```

The controller handles HTTP-level concerns.

---

# 29. Ingestion Controller

Important file:

```text
server/src/controllers/ingestion.controller.ts
```

Purpose:

Start repository ingestion.

It:

1. Gets authenticated user ID.
2. Reads `repositoryId`.
3. Verifies that repository belongs to the user.
4. Retrieves the user's GitHub access token.
5. Calls `ingestRepository()`.
6. Returns the workspace ID.

Endpoint:

```text
POST /api/repositories/ingest
```

Request body:

```json
{
  "repositoryId": "..."
}
```

---

# 30. Why `repositoryId` Is Used

Initially the ingestion endpoint was tested with a repository URL.

The API returned:

```json
{
  "message": "repositoryId is required"
}
```

This showed that the current controller intentionally expects:

```text
repositoryId
```

rather than a raw URL.

This is useful because the repository must first be associated with the authenticated user.

---

# 31. Day 5 — Docker

Docker was introduced as part of the implementation environment.

## Docker

Docker is a containerization platform.

A container packages an application's:

- runtime
- dependencies
- operating-system-level libraries/tools
- application code

into an isolated environment.

---

# 32. Docker Image

A Docker image is a template used to create containers.

The RepoDoctor server image is based on:

```dockerfile
FROM node:22-alpine
```

## `node:22-alpine`

This means:

- Node.js 22
- Alpine Linux base image

Alpine is commonly used for relatively small container images.

---

# 33. Dockerfile

Important file:

```text
server/Dockerfile
```

Current structure:

```dockerfile
FROM node:22-alpine

RUN apk add --no-cache git

WORKDIR /app

COPY server/package*.json ./server/
COPY server/prisma ./server/prisma/

WORKDIR /app/server

RUN npm ci

WORKDIR /app

COPY server ./server

WORKDIR /app/server

EXPOSE 5000

CMD ["npm", "run", "dev"]
```

---

# 34. Dockerfile Command Explanations

## `FROM`

```dockerfile
FROM node:22-alpine
```

Selects the base image.

---

## `RUN`

```dockerfile
RUN apk add --no-cache git
```

Runs a command while building the image.

`apk` is Alpine Linux's package manager.

### `apk`

Alpine Package Keeper.

Git is required because RepoDoctor performs Git operations inside the container.

---

## `WORKDIR`

```dockerfile
WORKDIR /app
```

Sets the working directory inside the container.

---

## `COPY`

```dockerfile
COPY server/package*.json ./server/
```

Copies matching package files from the project into the image.

---

## Why Prisma schema is copied before `npm ci`

The Prisma schema is copied before dependency installation:

```dockerfile
COPY server/prisma ./server/prisma/
```

This was necessary because Prisma Client generation during installation needs access to the Prisma schema.

---

## `npm ci`

```dockerfile
RUN npm ci
```

### `ci`

Continuous Integration.

`npm ci` performs a clean, lockfile-based installation.

It is generally preferred in reproducible build environments.

---

## `EXPOSE`

```dockerfile
EXPOSE 5000
```

Documents that the container application listens on port 5000.

---

## `CMD`

```dockerfile
CMD ["npm", "run", "dev"]
```

Specifies the default command when the container starts.

---

# 35. Docker Compose

Important file:

```text
docker-compose.yml
```

Docker Compose is used to define/run multiple related containers and their configuration.

Typical commands used:

```powershell
docker compose up
docker compose down
docker compose build
docker compose restart
docker compose logs
docker compose exec
```

---

# 36. `docker compose up`

```powershell
docker compose up
```

Starts the services defined by Docker Compose.

Detached mode:

```powershell
docker compose up -d
```

## `-d`

Detached mode.

The terminal is returned to the user while containers continue running in the background.

---

# 37. `docker compose down`

```powershell
docker compose down
```

Stops and removes the containers created by Compose.

It is useful when rebuilding/resetting the running Compose environment.

---

# 38. `docker compose build`

```powershell
docker compose build
```

Builds Docker images from the Dockerfiles.

For the server specifically:

```powershell
docker compose build server
```

---

# 39. `--no-cache`

```powershell
docker compose build --no-cache server
```

## Meaning

Prevents Docker from reusing cached build layers.

Useful when:

- Dockerfile changes
- dependencies changed
- old layers are causing confusing behavior
- you need a completely fresh build

---

# 40. `docker compose restart`

```powershell
docker compose restart server
```

Restarts the server container.

This is useful after changes when a full rebuild isn't required.

---

# 41. `docker compose logs`

```powershell
docker compose logs -f server
```

Shows logs generated by the server container.

## `-f`

Follow.

It continuously displays new logs.

Useful for debugging API requests and runtime errors.

---

# 42. `docker compose exec`

```powershell
docker compose exec server sh
```

Runs a command inside the already-running `server` container.

Here:

```text
server
```

is the Compose service name.

```text
sh
```

starts a shell inside the container.

---

# 43. Important Shell Difference

When the terminal displays:

```text
/app/server #
```

you are **inside the Docker container**.

Therefore:

```powershell
docker compose ...
```

should NOT be run there.

Docker commands should be run from PowerShell:

```text
PS F:\RepoDoctor>
```

Inside the container, use normal Linux commands such as:

```sh
ls
find
git
npm
npx
```

---

# 44. `ls -la`

```sh
ls -la /tmp
```

## Meaning

`ls` = list directory contents.

Options:

- `-l` = long/detailed format
- `-a` = include hidden files

This was used to inspect the temporary workspace directory.

---

# 45. `find`

Example:

```sh
find /tmp/repodoctor -maxdepth 3 -type d
```

`find` searches filesystem entries.

### Options

```text
-maxdepth 3
```

Search only up to three directory levels.

```text
-type d
```

Only show directories.

---

# 46. `head`

Example:

```sh
head -30
```

Displays the first 30 lines of output.

Used together with `find` to avoid printing huge directory listings.

---

# 47. Git

Git is the distributed version control system used by GitHub repositories.

RepoDoctor uses Git to clone source repositories into isolated workspaces.

---

# 48. `git --version`

```sh
git --version
```

Checks whether Git is installed and displays its version.

This was important because the Docker container initially did not have Git.

The Dockerfile was therefore updated with:

```dockerfile
RUN apk add --no-cache git
```

---

# 49. `git clone`

RepoDoctor executes Git programmatically using:

```ts
execFile(...)
```

The actual command is conceptually:

```text
git clone ...
```

It copies a Git repository into the isolated workspace.

---

# 50. `--depth 1`

The ingestion command contains:

```text
--depth
1
```

This creates a shallow clone.

### Purpose

Only the latest required commit history is fetched instead of downloading the entire repository history.

Benefits:

- faster cloning
- less network traffic
- less disk usage

For the current ingestion stage, full Git history is not required.

---

# 51. `--branch`

The command contains:

```text
--branch
defaultBranch
```

This tells Git which branch to clone.

RepoDoctor obtains the repository's default branch from the database.

For the test repository:

```text
main
```

---

# 52. `execFile`

Important file:

```text
server/src/services/ingestion.service.ts
```

The ingestion service uses:

```ts
execFile
```

from Node.js.

Why?

Because repository commands should not be constructed through a shell unnecessarily.

The service effectively runs:

```text
git clone
```

with separate arguments.

This is safer and more predictable than constructing a large shell command string.

---

# 53. `promisify`

The code uses:

```ts
const execFileAsync = promisify(execFile);
```

`promisify` converts a callback-style Node.js function into a Promise-based function.

This allows:

```ts
await execFileAsync(...)
```

instead of callback handling.

---

# 54. Ingestion Service

Important file:

```text
server/src/services/ingestion.service.ts
```

This is the core Day 5 ingestion logic.

It handles:

1. Creating an isolated workspace.
2. Building the repository path.
3. Creating an authenticated GitHub clone URL.
4. Running Git clone.
5. Returning workspace information.
6. Cleaning up the workspace if cloning fails.

---

# 55. Workspace Service

Important file:

```text
server/src/services/workspace.service.ts
```

This handles temporary workspace creation/removal.

The successful test produced:

```text
/tmp/repodoctor/f970cc15-2e66-4726-8238-8ff74ad99ade/
```

Inside it:

```text
repository/
```

and the repository contained:

```text
.git/
README.md
package.json
src/
tests/
```

This proves that the repository was cloned into an isolated workspace.

---

# 56. UUID

The workspace directory used a value similar to:

```text
f970cc15-2e66-4726-8238-8ff74ad99ade
```

This is a UUID.

## UUID

**Full form:** Universally Unique Identifier.

A random UUID is useful for naming temporary workspaces because different repository jobs are unlikely to collide.

---

# 57. `path.join`

The ingestion service uses:

```ts
path.join(
  workspace.path,
  "repository"
)
```

This creates a filesystem path in a platform-safe manner.

The resulting path was:

```text
/tmp/repodoctor/<workspace-id>/repository
```

---

# 58. `try/catch`

The ingestion service uses:

```ts
try {
   ...
} catch (error) {
   ...
}
```

Purpose:

- attempt repository ingestion
- catch errors
- clean up the temporary workspace
- rethrow the error

This is important for safe resource handling.

---

# 59. Workspace Cleanup

The ingestion service calls:

```ts
removeWorkspace(workspace.path)
```

when an ingestion operation fails.

The intention is:

```text
Create workspace
       ↓
Try clone
       ↓
Success → return workspace
       ↓
Failure → remove workspace → throw error
```

This prevents failed jobs from leaving unnecessary temporary directories.

---

# 60. Safe Repository Ingestion Architecture

The current architecture follows:

```text
GitHub Repository
       |
       | read-only clone
       ↓
Docker Server
       |
       ↓
Temporary Workspace
       |
       ↓
Repository Analysis
```

The source repository is not directly modified.

Later repair functionality must follow:

```text
Original repository
       |
       | isolated copy/worktree
       ↓
Repair branch
       |
       ↓
Run tests/verification
       |
       ↓
Only after success
       ↓
Pull Request
```

No automatic modification of the original `main` branch is allowed.

---

# 61. Test Repository

A safe test repository was created:

```text
RepoDoctor-Test
```

GitHub repository:

```text
Amiya-Krishna/RepoDoctor-Test
```

Its structure was:

```text
RepoDoctor-Test/
├── package.json
├── README.md
├── src/
│   ├── index.js
│   └── utils.js
└── tests/
    └── utils.test.js
```

This repository is used only for safe RepoDoctor testing.

No secrets should be placed inside it.

---

# 62. Repository Database Record

The test repository was associated with the user's RepoDoctor user.

The record contained information including:

```text
name          → RepoDoctor-Test
cloneUrl      → https://github.com/Amiya-Krishna/RepoDoctor-Test.git
defaultBranch → main
```

The repository received a database ID similar to:

```text
cmuffmm8b0001pncsck07enq1
```

That ID was supplied to:

```text
POST /api/repositories/ingest
```

---

# 63. Postman

Postman was used to test the backend APIs.

Postman is an API testing/development tool.

The ingestion request was:

```http
POST http://localhost:5000/api/repositories/ingest
```

Authorization:

```text
Bearer <fresh JWT>
```

Body:

```json
{
  "repositoryId": "..."
}
```

Successful response:

```json
{
  "message": "Repository ingested successfully",
  "workspaceId": "..."
}
```

---

# 64. Errors We Encountered and What They Taught Us

## Error 1 — `repositoryId is required`

Response:

```json
{
  "message": "repositoryId is required"
}
```

Meaning:

The endpoint expects the database repository ID.

---

## Error 2 — `git: not found`

Meaning:

Git was not installed inside the Docker image.

Fix:

```dockerfile
RUN apk add --no-cache git
```

---

## Error 3 — `defaultBranch is not defined`

Cause:

The service function declared:

```ts
{
  cloneUrl,
  accessToken,
}
```

but later used:

```ts
defaultBranch
```

Fix:

```ts
{
  cloneUrl,
  accessToken,
  defaultBranch,
}
```

---

## Error 4 — `TokenExpiredError: jwt expired`

Cause:

The Postman JWT had expired.

Fix:

Login again and use a fresh JWT.

Do not disable token expiration just to make the test work.

---

# 65. Current File Responsibility Map

```text
RepoDoctor/
│
├── server/
│   │
│   ├── src/
│   │   │
│   │   ├── server.ts
│   │   │   └── Main Express server.
│   │   │       Registers middleware and routes.
│   │   │
│   │   ├── config/
│   │   │   └── prisma.ts
│   │   │       └── Prisma client/database connection.
│   │   │
│   │   ├── middleware/
│   │   │   └── auth.middleware.ts
│   │   │       └── JWT authentication/protection.
│   │   │
│   │   ├── routes/
│   │   │   └── repository.routes.ts
│   │   │       └── Repository API endpoints.
│   │   │
│   │   ├── controllers/
│   │   │   ├── repository.controller.ts
│   │   │   │   └── HTTP handling for repositories.
│   │   │   │
│   │   │   └── ingestion.controller.ts
│   │   │       └── HTTP handling for ingestion.
│   │   │
│   │   └── services/
│   │       ├── repository.service.ts
│   │       │   └── Repository database operations.
│   │       │
│   │       ├── ingestion.service.ts
│   │       │   └── Git repository cloning/ingestion.
│   │       │
│   │       └── workspace.service.ts
│   │           └── Temporary workspace management.
│   │
│   ├── prisma/
│   │   └── schema.prisma
│   │       └── Database models and relationships.
│   │
│   ├── Dockerfile
│   │   └── Builds the server Docker image.
│   │
│   └── package.json
│       └── Dependencies and npm scripts.
│
└── docker-compose.yml
    └── Docker Compose service configuration.
```

---

# 66. Controller vs Service

This distinction is important for the project.

## Controller

Handles:

```text
HTTP request
      ↓
validation
      ↓
call service
      ↓
HTTP response
```

Example:

```text
ingestion.controller.ts
```

## Service

Handles actual business logic.

Example:

```text
ingestion.service.ts
```

This separation makes the application easier to maintain and test.

---

# 67. Route → Controller → Service → Database/External System

The repository ingestion flow currently looks like:

```text
Postman
   |
   | POST /api/repositories/ingest
   ↓
repository.routes.ts
   |
   | protect middleware
   ↓
auth.middleware.ts
   |
   ↓
ingestion.controller.ts
   |
   | repository lookup
   ↓
Prisma
   |
   ↓
PostgreSQL
   |
   ↓
ingestion.service.ts
   |
   ↓
workspace.service.ts
   |
   ↓
Git
   |
   ↓
GitHub Repository
```

This is the most important architecture to understand from Day 1–5.

---

# 68. Commands Cheat Sheet

## Start development server

```powershell
npm run dev
```

## Install dependencies

```powershell
npm install
```

## Clean lockfile installation

```powershell
npm ci
```

## Generate Prisma Client

```powershell
npx prisma generate
```

## Read database schema into Prisma

```powershell
npx prisma db pull
```

## Start Docker

```powershell
docker compose up -d
```

## Stop Docker services

```powershell
docker compose down
```

## Build Docker image

```powershell
docker compose build server
```

## Force fresh Docker build

```powershell
docker compose build --no-cache server
```

## Restart server

```powershell
docker compose restart server
```

## View server logs

```powershell
docker compose logs -f server
```

## Open shell inside server container

```powershell
docker compose exec server sh
```

## Check Git inside container

```sh
git --version
```

## Inspect temporary workspace

```sh
ls -la /tmp
```

## Find workspace directories

```sh
find /tmp/repodoctor -maxdepth 3 -type d
```

## Find files

```sh
find /tmp/repodoctor -maxdepth 4 -type f | head -30
```

---

# 69. Command Full-Form Summary

| Command/tool | Full form / meaning | Main use |
|---|---|---|
| `npm` | Node Package Manager | Node dependency/package management |
| `npx` | Node package executor | Run package commands |
| `tsx` | TypeScript execution tool | Execute TS during development |
| `dev` | Development script | Start development server |
| `JWT` | JSON Web Token | Authentication |
| `OAuth` | Open Authorization | Authorized third-party access |
| `ORM` | Object-Relational Mapping | Application/database mapping |
| `SQL` | Structured Query Language | Relational database querying |
| `PostgreSQL` | PostgreSQL database system | Store relational data |
| `Prisma` | Prisma ORM/toolkit | Type-safe database access |
| `Docker` | Containerization platform | Isolated application environment |
| `Docker Compose` | Multi-container configuration/tool | Run related services |
| `Git` | Distributed version-control system | Repository/version management |
| `UUID` | Universally Unique Identifier | Unique workspace IDs |
| `API` | Application Programming Interface | Communication between software |
| `HTTP` | Hypertext Transfer Protocol | Web/API communication |
| `REST` | Representational State Transfer | Common API architecture |
| `CRUD` | Create, Read, Update, Delete | Basic data operations |
| `CUID` | Collision-resistant Unique Identifier | Prisma-generated IDs |
| `CI` | Continuous Integration | Automated/reproducible build context |
| `OAuth token` | Authorization credential | Authorized GitHub operations |

---

# 70. Day 1–5 Final Status

At this point the following complete flow has been successfully tested:

```text
User
 ↓
JWT Authentication
 ↓
GitHub Connection
 ↓
Repository stored in PostgreSQL
 ↓
Repository selected by repositoryId
 ↓
GitHub access token retrieved
 ↓
Docker server
 ↓
Temporary isolated workspace
 ↓
Git clone
 ↓
RepoDoctor-Test cloned successfully
 ↓
Repository files available
```

The successful workspace contained:

```text
.git/
README.md
package.json
src/index.js
src/utils.js
tests/utils.test.js
```

Therefore the **Day 1–Day 5 foundation is ready for Day 6: Repository Analyzer**.

---

# 71. Important Security Rules for Future Days

These rules must continue to be followed:

1. Existing user repositories are treated as read-only during analysis.
2. Never push directly to `main`/default branch.
3. Never force-push.
4. Never automatically merge.
5. Never delete the user's repository or branches.
6. Repairs must happen in isolated workspaces/branches.
7. Run repository code only inside controlled isolation.
8. Do not execute untrusted repository code directly on the host.
9. Do not expose GitHub access tokens to AI prompts.
10. Do not put secrets in GitHub repositories.
11. Validate generated fixes before creating a Pull Request.
12. Create a Pull Request only after successful verification.

---

# 72. What Comes Next

## Day 6 — Repository Analyzer

The next component should inspect the already-ingested repository and collect structured metadata:

```text
Project type
Language
package.json
Dependencies
TypeScript
Test framework
ESLint/Oxlint
Source files
Test files
Directory structure
Configuration files
Repository statistics
```

That information will become the foundation for the later AI agents.

