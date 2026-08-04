// Tearing a live session down at the end of a spec, whatever happened during it.
//
// Why this matters more than it looks: a session left running holds a published host port, a container PAIR and a
// `cd-agent-net-*` network with its own /24 out of podman's pool. The harness kills the APP when the run ends, which
// orphans all of it — the app is the only thing that would have removed them. Sixteen leaked networks later, podman
// starts refusing to create another one ("IPAM error: failed to get ips for container"), and the next run fails on
// infrastructure with no hint that a previous run is the cause.
//
// Idempotent and silent: a spec whose session never started must not fail in teardown and mask the real failure.
export async function stopAgentSession(browser) {
  await browser
    .executeAsync((done) => {
      const store = window.__cdCodingAgentStore;
      if (!store) {
        done(false);
        return;
      }
      store
        .getState()
        .stop()
        .then(
          () => done(true),
          () => done(false),
        );
    })
    .catch(() => undefined);
}
