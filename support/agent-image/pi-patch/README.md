# pi's session-storage seam, built for the pinned version

`SessionManager` reaches `node:fs` directly, so a conversation can only ever live on the machine the agent process runs
on. The app needs a seam there: a session started on a REMOTE engine must be able to write to the user's own machine,
and there is no other way in — the harness layer of pi has such a port, the coding-agent layer has none.

These files ARE that seam, compiled from pi's own sources — the session store, the storage port, and the package entry that publishes it:

| | |
|---|---|
| Upstream branch | `feat/session-storage-port-0.83.0` in the pi checkout (`temp/pi`), exported to `.scratch/pi-gui-coding-agent/upstream/0001-session-storage-port.patch`. `feat/session-storage-port` is the same commit on `main` |
| Built from | tag `v0.83.0` — **the version the Dockerfile pins**, so the emitted files drop into that published tree |
| What they add | `SessionStorage` (a synchronous port), `nodeSessionStorage` (the filesystem, which stays the default), `setSessionStorage()`, every direct fs call in `session-manager.js` routed through it, and all of it exported from the package entry — pi's `exports` map publishes `.` only, so a consumer cannot reach a deep path |
| Proven | pi's own `test/session-manager` suite passes on that branch, plus a suite driving `SessionManager` over an in-memory storage |

It is deliberately NOT a fork: one upstream-tracking commit, no features of ours, and the moment a pi release carries
the port these files and the `COPY` in the Dockerfile are deleted.

## Regenerating after a pi bump

The Dockerfile asserts the installed version, so a bump fails the build loudly rather than silently running unpatched
sources. To move it:

```bash
cd temp/pi
git checkout -b feat/session-storage-port-<version> v<version>
git cherry-pick <the storage-port commit>
cd packages/coding-agent && npx vitest --run test/session-manager && npx tsgo -p tsconfig.build.json
cp dist/core/session-{manager,storage}.js ../../../support/agent-image/pi-patch/core/
cp dist/index.js ../../../support/agent-image/pi-patch/index.js
```

Then prove the seam is in the built image, which is what `yarn cli agent-image` asserts anyway:

```bash
podman run --rm --workdir /opt/cd-agent --entrypoint node container-desktop/pi-agent:<version> \
  -e "import('@earendil-works/pi-coding-agent').then((m)=>console.log(typeof m.setSessionStorage))"
```

The pinned version appears in `support/agent-image/Dockerfile` four times — three `npm install` lines and the guard — so change all four, then rebuild: `yarn cli agent-image --engine podman`.
