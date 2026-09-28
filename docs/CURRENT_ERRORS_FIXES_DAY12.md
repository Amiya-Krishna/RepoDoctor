# RepoDoctor AI — Current Errors / Fixes

This document records known issues, historical problems, and architectural fixes.

## 1. MongoDB → PostgreSQL Migration

### Old problem
The original project used:

```text
MongoDB
Mongoose
```

### Decision
The project was migrated to:

```text
PostgreSQL
Prisma
```

### Required fix
Do not introduce new MongoDB/Mongoose code.

Search the backend for old imports such as:

```ts
mongoose
Schema
model
findById
findByIdAndUpdate
```

and migrate remaining active paths to Prisma.

---

## 2. GitHub OAuth Data Not Persisting

### Historical symptom
GitHub OAuth could report a successful connection, but fields such as:

```text
githubId
githubUsername
githubAccessToken
```

were not reliably appearing in the database.

### Root cause
The original implementation was tied to the MongoDB/Mongoose user model and later conflicted with the database migration.

### Current fix
Use Prisma:

```ts
await prisma.user.update({
  where: {
    id: userId,
  },
  data: {
    githubId: String(githubUser.id),
    githubUsername: githubUser.login,
    githubAccessToken: accessToken,
  },
});
```

Field names must match the current Prisma schema.

---

## 3. GitHub OAuth Environment Variables Undefined

### Historical symptom
OAuth URLs contained values such as:

```text
client_id=undefined
redirect_uri=undefined
```

### Fix
Verify `server/.env` contains:

```env
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
GITHUB_CALLBACK_URL=http://localhost:5000/api/github/callback
```

Also verify dotenv is loaded before accessing environment variables.

Never commit `.env`.

---

## 4. Authentication Middleware Errors

### Historical symptoms

```text
Cannot read properties of undefined (reading 'userId')
```

and:

```text
JsonWebTokenError: invalid token
```

### Likely causes
- Missing Authorization header
- Incorrect Bearer format
- Invalid/expired JWT
- Middleware not executed before protected controller
- Controller assuming `req.user` exists

### Required request format

```text
Authorization: Bearer YOUR_JWT
```

Protected routes must use:

```ts
router.get("/...", protect, controller);
```

---

## 5. User Not Found

### Historical symptom

```text
user not found
```

### Current diagnostic path

Verify:
1. JWT contains the correct user ID.
2. User exists in PostgreSQL.
3. Prisma query uses the correct ID field.
4. The authenticated request reaches the intended database.
5. No old MongoDB lookup remains.

---

## 6. JWT Expiration Configuration

### Historical inconsistency
An environment variable was defined:

```env
JWT_EXPIRES_IN=1d
```

but earlier token-generation code used a hardcoded expiration.

### Fix
Token generation should use the configured environment value where compatible with the installed `jsonwebtoken` types.

Do not maintain two independent expiration settings.

---

## 7. GitHub Repository Safety

### Risk
Running Git operations directly against an existing repository could accidentally modify or push to the user's project.

### Permanent fix
All analyzed repositories are treated as read-only.

Required architecture:

```text
GitHub
 ↓
Disposable clone
 ↓
Analysis
 ↓
Delete workspace
```

For future fixes:

```text
GitHub
 ↓
Disposable clone
 ↓
repair/<unique-id>
 ↓
Modify
 ↓
Docker verification
 ↓
GitHub PR
```

Never automatically push to `main`/`master`.

---

## 8. Shell Command Injection Risk

### Risky pattern

```ts
exec(`git clone ${cloneUrl}`);
```

### Fix

Use:

```ts
execFile("git", [...arguments]);
```

Do not pass untrusted repository values into shell commands.

This rule applies to future:
- git commands
- npm commands
- test commands
- build commands

---

## 9. GitHub Token Leakage

### Risk
An authenticated clone URL contains the access token.

Never log it.

Bad:

```ts
console.log(authenticatedUrl);
```

Correct:

```ts
console.log("Cloning repository...");
```

The GitHub token should not be passed into the analysis container.

---

## 10. Arbitrary Repository Code Execution

### Current status
Not yet enabled.

Do not blindly execute:

```text
npm install
npm test
npm run build
```

against third-party repositories.

Dependency lifecycle scripts and project scripts can execute arbitrary commands.

### Planned fix
Implement restricted Docker execution before enabling automated test/build execution.

---

## 11. Temporary Workspace Leakage

### Risk
Cloned repositories could accumulate on the host.

### Fix
Use:

```ts
try {
  // clone + analysis
} finally {
  await removeWorkspace(workspace.path);
}
```

The temporary repository should be deleted after the analysis job completes or fails.

---

## 12. Default Branch Assumption

### Historical risk
Hardcoding:

```text
--branch main
```

breaks repositories whose default branch is:

```text
master
develop
trunk
```

### Fix
Read `defaultBranch` from GitHub metadata stored in PostgreSQL and use that value for the clone.

---

## 13. Repository Size / Timeout

### Current configuration

```env
MAX_REPOSITORY_SIZE_MB=500
CLONE_TIMEOUT_MS=120000
```

These limits should be enforced more completely as the ingestion system matures.

---

## 14. Current Known Pending Work

These are not necessarily errors; they are unfinished milestones:

```text
[ ] Complete Prisma migration of every remaining old MongoDB path
[ ] Production-safe OAuth state handling
[ ] Complete Docker analysis isolation
[ ] Repository dashboard
[ ] AI provider abstraction
[ ] Context builder
[ ] Bug Detection Agent
[ ] Security Agent
[ ] Test Generation Agent
[ ] Risk Engine
[ ] Fix Agent
[ ] Repair branches
[ ] Dockerized verification
[ ] Retry/replanning
[ ] GitHub PR creation
[ ] BullMQ + Redis
[ ] GitHub webhooks
[ ] RAG/repository memory
[ ] Evaluation benchmark
[ ] Production deployment
```

## Current safety invariant

> RepoDoctor must never modify, overwrite, force-push, delete, or directly merge into a user's pre-existing GitHub repository. All analysis and repair work must happen in isolated disposable environments, with changes delivered through a dedicated repair branch and Pull Request only after verification.
