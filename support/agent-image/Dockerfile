FROM node:24-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends bash ca-certificates git ripgrep \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/cd-agent
# Every package the bundle leaves external must be installed HERE, at the same level as host.mjs. npm nests
# pi's own dependency tree under pi-coding-agent/node_modules, so a package that is only pi's dependency is
# invisible to host.mjs and fails at startup with ERR_MODULE_NOT_FOUND — pi-tui did, once it was imported.
RUN npm install --omit=dev --ignore-scripts \
  @earendil-works/pi-ai@0.83.0 \
  @earendil-works/pi-coding-agent@0.83.0 \
  @earendil-works/pi-tui@0.83.0 \
  ws@8.18.3

# pi's session store reaches node:fs directly, so a conversation can only live on the machine the agent runs on. These
# two files are that layer compiled from pi's own sources with a storage port added (support/agent-image/pi-patch), and
# they are built from the tag pinned above — so the version is asserted first: a bump must fail the build loudly rather
# than quietly running unpatched sources. Deleted the moment a pi release carries the port.
COPY pi-patch/ /opt/cd-agent/pi-patch/
RUN node -e "const v=require('/opt/cd-agent/node_modules/@earendil-works/pi-coding-agent/package.json').version; \
  if (v !== '0.83.0') { console.error('pi is '+v+', not the 0.83.0 the session-storage patch was built from — regenerate support/agent-image/pi-patch'); process.exit(1); }" \
  && cp /opt/cd-agent/pi-patch/core/session-manager.js /opt/cd-agent/pi-patch/core/session-storage.js \
    /opt/cd-agent/pi-patch/core/agent-session-runtime.js \
    /opt/cd-agent/node_modules/@earendil-works/pi-coding-agent/dist/core/ \
  && cp /opt/cd-agent/pi-patch/index.js /opt/cd-agent/node_modules/@earendil-works/pi-coding-agent/dist/index.js \
  && node -e "import('@earendil-works/pi-coding-agent').then((m)=>{ \
    if (typeof m.setSessionStorage !== 'function') { console.error('the session-storage seam is not reachable from the package entry'); process.exit(1); } });" \
  && rm -rf /opt/cd-agent/pi-patch
COPY host.mjs /opt/cd-agent/host.mjs
# The conversation store's socket is owned by a worker thread, which needs a file of its own. The bundle resolves it as
# a sibling, so the two must stay in the same directory.
COPY session-storage-worker.mjs /opt/cd-agent/session-storage-worker.mjs

RUN useradd --create-home --shell /bin/bash agent \
  && mkdir -p /home/agent/.pi/agent /workspace \
  && chown -R agent:agent /home/agent /workspace
USER agent
WORKDIR /workspace

ENTRYPOINT ["node", "/opt/cd-agent/host.mjs"]
