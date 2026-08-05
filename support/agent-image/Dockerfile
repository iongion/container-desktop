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
COPY host.mjs /opt/cd-agent/host.mjs

RUN useradd --create-home --shell /bin/bash agent \
  && mkdir -p /home/agent/.pi/agent /workspace \
  && chown -R agent:agent /home/agent /workspace
USER agent
WORKDIR /workspace

ENTRYPOINT ["node", "/opt/cd-agent/host.mjs"]
