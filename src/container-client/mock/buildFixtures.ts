// Per-engine canned build-output streams for mock mode. When MockCommand.ExecuteStreaming sees an image
// `build`, it replays these chunks (as if the engine CLI were streaming) so the Build Studio timeline,
// cache diagnostics and layer inspector all have realistic, engine-shaped data with NO real engine.
//
// Each stream deliberately contains a CACHE MISS partway through (the classic `COPY . .` cache-buster)
// so the cache-summary strip and the "cache broke at step N" breaker render in the mock. Formats mirror
// the real progress each engine emits and are consumed by src/container-client/builder/parse/*:
//   - Podman  → Buildah `STEP N/M:` text + `--> Using cache` markers
//   - Docker  → `buildx --progress=rawjson` newline-delimited JSON vertices
//   - Apple   → `container build --progress=plain` BuildKit `#N … CACHED/DONE` text
//
// Kept dependency-free and production-excluded (only reachable via fixturesLoader, tree-shaken in prod).

import { ContainerEngine } from "@/env/Types";

export interface BuildStreamChunk {
  from: "stdout" | "stderr";
  data: string;
}

const PODMAN_BUILD = `STEP 1/6: FROM docker.io/library/node:20-alpine
--> Using cache 1a2b3c4d5e6f
STEP 2/6: WORKDIR /app
--> Using cache 2b3c4d5e6f70
STEP 3/6: COPY package.json package-lock.json ./
--> Using cache 3c4d5e6f7081
STEP 4/6: RUN npm ci --omit=dev
--> Using cache 4d5e6f708192
STEP 5/6: COPY . .
--> a1b2c3d4e5f6
STEP 6/6: CMD ["node","server.js"]
--> b2c3d4e5f6a7
COMMIT localhost/mock-app:latest
--> f0e1d2c3b4a5
Successfully tagged localhost/mock-app:latest
f0e1d2c3b4a5aabbccddee0011223344556677889900aabbccddeeff0011223344
`;

const APPLE_BUILD = `#1 [internal] load build definition from Containerfile
#1 DONE 0.0s
#2 [internal] load metadata for docker.io/library/node:20-alpine
#2 DONE 0.4s
#3 [1/4] FROM docker.io/library/node:20-alpine
#3 CACHED
#4 [2/4] WORKDIR /app
#4 CACHED
#5 [3/4] COPY . .
#5 DONE 0.3s
#6 [4/4] RUN npm ci --omit=dev
#6 DONE 8.1s
#7 exporting to image
#7 exporting layers 0.2s
#7 writing image sha256:c0ffee00 done
#7 DONE 0.3s
`;

// buildx --progress=rawjson: one JSON object per line. `cached: true` marks a reused vertex; the COPY . .
// vertex (no `cached`) is the miss, and the RUN after it rebuilds. Timestamps are static (deterministic).
const DOCKER_BUILD_LINES = [
  {
    vertexes: [
      {
        digest: "sha256:v1",
        name: "[1/4] FROM docker.io/library/node:20-alpine",
        started: "2024-01-01T00:00:00.000Z",
        completed: "2024-01-01T00:00:00.100Z",
        cached: true,
      },
    ],
  },
  {
    vertexes: [
      {
        digest: "sha256:v2",
        name: "[2/4] WORKDIR /app",
        started: "2024-01-01T00:00:00.100Z",
        completed: "2024-01-01T00:00:00.150Z",
        cached: true,
      },
    ],
  },
  {
    vertexes: [
      {
        digest: "sha256:v3",
        name: "[3/4] COPY . .",
        started: "2024-01-01T00:00:00.150Z",
        completed: "2024-01-01T00:00:00.480Z",
      },
    ],
  },
  {
    vertexes: [
      {
        digest: "sha256:v4",
        name: "[4/4] RUN npm ci --omit=dev",
        started: "2024-01-01T00:00:00.480Z",
        completed: "2024-01-01T00:00:08.600Z",
      },
    ],
  },
  {
    vertexes: [
      {
        digest: "sha256:v5",
        name: "exporting to image",
        started: "2024-01-01T00:00:08.600Z",
        completed: "2024-01-01T00:00:08.900Z",
      },
    ],
  },
];

const DOCKER_BUILD = `${DOCKER_BUILD_LINES.map((line) => JSON.stringify(line)).join("\n")}\n`;

// Split a stream into a few chunks (on a boundary that is NOT a newline for at least one split) so the
// incremental parsers get exercised on partial lines, mirroring real streamed I/O.
function chunkify(text: string, parts = 3): BuildStreamChunk[] {
  if (parts <= 1 || text.length < parts) {
    return [{ from: "stdout", data: text }];
  }
  const size = Math.ceil(text.length / parts);
  const chunks: BuildStreamChunk[] = [];
  for (let i = 0; i < text.length; i += size) {
    chunks.push({ from: "stdout", data: text.slice(i, i + size) });
  }
  return chunks;
}

// Engine-shaped streamed build output for mock mode, pre-split into chunks.
export function getBuildOutput(engine: ContainerEngine): BuildStreamChunk[] {
  if (engine === ContainerEngine.PODMAN) {
    return chunkify(PODMAN_BUILD);
  }
  if (engine === ContainerEngine.APPLE) {
    return chunkify(APPLE_BUILD);
  }
  return chunkify(DOCKER_BUILD);
}
