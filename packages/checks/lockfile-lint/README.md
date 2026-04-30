# @sentiness/check-lockfile-lint

Runs `lockfile-lint` against npm and Yarn lockfiles and normalizes policy violations as Sentiness
security findings. `pnpm-lock.yaml` is skipped because lockfile-lint does not support pnpm lockfiles.

Default policy:

```sh
lockfile-lint --validate-https --validate-integrity --allowed-hosts npm yarn
```
