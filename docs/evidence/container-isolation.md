# Evidence: real-container isolation and hostile-repository tests

```
ok 1 - Docker is available when REQUIRE_DOCKER_TESTS=true
ok 2 - container: non-root, read-only rootfs, no capabilities, no new privileges
ok 3 - container: no network
ok 4 - container: host paths and the Docker socket are not visible
ok 5 - container: /tmp is noexec
ok 6 - container: pids limit stops a fork bomb; memory limit kills a runaway allocation
ok 7 - container: writes to the mounted workspace stay inside it; a symlink created inside cannot reach host files
ok 8 - workspace: absolute and relative symlinks escaping the root are rejected; internal links allowed
ok 9 - workspace: FIFOs and excessive size/depth are rejected
ok 10 - isInside handles traversal lookalikes
ok 11 - install policy: registry specs only
ok 12 - install policy: rejects git/url deps, rc files, overrides, and foreign lockfile hosts; accepts a clean project
ok 13 - sandbox config: root user, bad runtime and bad network fail closed; hardened-runtime requirement enforced
ok 14 - install container args: non-root, no caps, read-only root, limits, no host mounts beyond workspace and volume
ok 15 - gVisor runtime is passed through to both install and test containers when configured
ok 16 - test command cannot smuggle docker options or shell metacharacters into the argv
ok 17 - network is disabled and IPC is not shared
ok 18 - all capabilities dropped, no privilege escalation, read-only root, non-root user
ok 19 - CPU, memory (no swap) and PID limits are applied
ok 20 - scratch space is tmpfs with noexec; only the disposable workspace is mounted
ok 21 - no dangerous flags can appear
ok 22 - host environment is not forwarded: only explicit variables are set
ok 23 - the test command comes after the image and cannot inject docker options
ok 24 - unsafe inputs are refused
ok 25 - real container: outbound network is unreachable
ok 26 - real container: root filesystem is read-only and process is not root
ok 27 - real container: memory limit kills a runaway allocation
# pass 27
# fail 0
# skipped 0
ok 1 - hostile test script: network, host files, secrets, privilege and persistence attempts all fail
ok 2 - runaway process is killed at the timeout, reported as timed out, and the container is removed
ok 3 - memory bomb is OOM-killed within the limit and reported as failure
ok 4 - workspace with a symlink leaving the repository is refused BEFORE any container starts
ok 5 - a non-zero exit is reported as failure with output captured; secrets in the environment are not forwarded
# pass 5
# fail 0
# skipped 0
```

Finding during this run: the `--tmpfs /tmp` mount came up root-owned mode 0755, so the non-root sandbox user could not write to /tmp. Fixed by `mode=1777` (still `noexec,nosuid`). PID limit measured: 57 of 200 spawns succeeded with `--pids-limit 64`, 200 of 200 without.
