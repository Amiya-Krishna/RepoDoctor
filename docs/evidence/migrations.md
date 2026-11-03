# Evidence: migration paths and checksum tooling

```
ok 50 - IMMUTABILITY: every migration shipped in the original release is byte-identical to its recorded sha256
ok 51 - IMMUTABILITY: the edited variant differs from the original, and the original is restored in prisma/migrations
ok 52 - migration directory is well-formed: lock file, chronological names, no empty SQL, corrective migration is last
ok 53 - PATH 1 fresh installation: every migration applies in order; archive table exists
ok 54 - PATH 2 upgrade from the previous production schema, no duplicates: all new migrations apply, data preserved
ok 55 - PATH 3a duplicates WITHOUT the pre-deploy script: the ORIGINAL migration fails atomically and leaves the database untouched
ok 56 - PATH 3b duplicates WITH the pre-deploy script: earliest kept, others archived, then every migration applies
ok 57 - PATH 4 EXISTING install that already applied the ORIGINAL 20261031: only the new migrations run; corrective one creates the archive
ok 58 - PATH 5 EXISTING install that applied the EDITED variant: the corrective migration is an idempotent no-op; archived rows survive
ok 59 - audit trail is append-only after upgrade (UPDATE always rejected; DELETE only past the 365-day floor)
ok 60 - a failing migration leaves no partial change (all-or-nothing)
```

Original 20261031 sha256: 6054a55ee8cc2fe65e6108d1b20b00c9bb7a3b55098348ef772a3a475fe106e9
Edited-variant sha256:    6900c3497e6c867bac0cb6c7da391be19b0dcc9efe326d68c57161ee5efe8cc4
