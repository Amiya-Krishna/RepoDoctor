# RepoDoctor AI — Current Errors, Fixes and Known State (Updated through Day 20)

## 1. Important Path Corrections

The authoritative service directory is:

```text
F:\RepoDoctor\server\src\services
```

It is **not** `src/service`.

The retry service is:

```text
F:\RepoDoctor\server\srcepairetryepair.retry.service.ts
```

It is **not** under `src/service` or `src/retry`.

## 2. NodeNext Import Rule

The backend uses TypeScript + ESM + NodeNext. Relative imports therefore use `.js` in TypeScript source, for example:

```ts
import { runDockerTest } from "../execution/docker.runner.js";
```

## 3. AI Provider State

Current architecture:

```text
OpenRouter -> Groq -> Gemini
```

Managed by `AIProviderManager`. `createAIProvider()` returns the manager.

Verified behavior:

```text
OpenRouter upstream 429
        |
        v
Groq succeeds
```

Do not introduce `FallbackAIProvider`.

## 4. Repository Context Signature

Current contract requires `repositoryId`:

```ts
buildRepositoryContext(
  repositoryPath,
  repositoryId
)
```

Correct example:

```ts
await buildRepositoryContext(
  repositoryPath,
  "appropriate-repository-id"
);
```

Calling it with only `repositoryPath` is incorrect for the current implementation.

## 5. Day 15 FixProposal Database Caveat

The Day 15 documentation recorded that the Prisma schema contains the FixProposal model while the corresponding table was not yet successfully present in the Neon database at that point.

Do not use:

```powershell
npx prisma migrate reset
```

when existing data must be preserved.

## 6. Day 16 Repair Workspace Safety

The repair workspace is disposable. The source repository is not the workspace used for patching.

```text
Source repository
      |
      | read-only
      v
Repair workspace
      |
      v
Repair branch
```

Workspace cleanup uses:

```ts
removeRepairWorkspace(workspace.rootPath)
```

## 7. Day 17 Fix Application Boundary

The validated proposal is applied using:

```ts
applyFixResult(repositoryPath, fixResult)
```

The function must operate on the isolated repair workspace only. It must not be pointed at the original user's repository.

## 8. Day 18 Docker Execution Boundary

Docker execution is performed by:

```text
src/execution/docker.runner.ts
```

through:

```ts
runDockerTest(...)
```

Repository code and repair tests are executed inside Docker rather than directly on the host. GitHub tokens, database credentials, and unrelated host filesystem data must not be exposed to the test container.

## 9. Day 19 Retry Behavior

Retry state is represented by:

```ts
attempts: RetryAttemptResult[]
```

Policy:

```text
Maximum attempts = 3
```

Important behavior:

```text
Attempt 1
  -> original finding + normal Fix Agent

Attempt 2/3
  -> previous failure evidence
  -> replanning
  -> next Fix Agent attempt
```

Replanning must not be applied to the first attempt.

The Docker environment supports:

```text
REPO_DOCTOR_ATTEMPT=1/2/3
```

## 10. Strict Verification

Verification is conservative. If available evidence is insufficient, the result is:

```text
INCONCLUSIVE
```

`INCONCLUSIVE` is not equivalent to `VERIFIED`. It must not create a Pull Request.

## 11. Day 19 Real Calculator Test

The repair retry test uses a temporary JavaScript harness inside Docker at:

```text
/tmp
```

This is a real behavior test, not a fake `tests passed` response.

## 12. Day 20 GitHub PR Safety

A PR may be created only after a repair is strictly verified:

```text
VERIFIED
+ test evidence passed
+ no regression detected
+ sufficient verification evidence
        |
        v
Commit repair branch
        |
        v
Push repair branch
        |
        v
Create Pull Request
```

No automatic merge is performed.

The GitHub token remains outside Docker and must not be embedded in repository URLs or ordinary Git command arguments.

## 13. Source Repository Protection Check

Recommended check:

```powershell
git -C "F:\RepoDoctor	est-generation-repo" status
```

The repair branch must be operated from the disposable workspace, not by checking it out in the source repository.

## 14. Do Not Invent Files or APIs

Authoritative paths include:

```text
src/services/
src/repair/retry/repair.retry.service.ts
src/execution/docker.runner.ts
src/ai/ai.provider.ts
src/ai/ai.provider.factory.ts
```

Existing APIs should be reused rather than replaced with similarly named invented APIs.
