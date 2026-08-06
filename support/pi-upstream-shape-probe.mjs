// Proves what pi puts ON THE WIRE for a thinking level, per upstream, against a real agent container.
//
// pi decides the dialect from the model's provider and base URL, both of which are OUR OWN endpoint — so without
// `CD_UPSTREAM_BASE_URL` every upstream gets OpenAI's shape. This runs the built image once per upstream and compares
// the request bodies. No provider, no key, no network, and no stub server either: inference travels the BRIDGE, so this
// probe stands in for the app — it answers `provider_request` itself, which is the only place the difference is
// observable and now also proves that path carries a real turn.
//
//   yarn cli agent-image --engine podman        # after ANY container-side change
//   node support/pi-upstream-shape-probe.mjs
//
// Add --engine docker to run it there instead. Exits non-zero if a body does not carry what that upstream wants.

import { spawn } from "node:child_process";

const engine = process.argv.includes("--engine") ? process.argv[process.argv.indexOf("--engine") + 1] : "podman";
const version = JSON.parse(await (await import("node:fs/promises")).readFile("package.json", "utf8")).version;
const image = `container-desktop/pi-agent:${version}`;
const TOKEN = "probe-token";
const MODEL = "probe-reasoner";

function run(args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(engine, args, { stdio: ["ignore", "pipe", "pipe"], ...opts });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => resolve({ code, out: out.trim(), err: err.trim() }));
  });
}

// One OpenAI-shaped answer, streamed back over the bridge exactly as the app streams one, plus the model listing pi may
// ask for. Enough for a turn to finish.
const SSE = [
  `data: ${JSON.stringify({ id: "1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant", content: "ok" }, finish_reason: null }] })}\n\n`,
  `data: ${JSON.stringify({ id: "1", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`,
  "data: [DONE]\n\n",
];

// The app's half of one inference request. Answered on this socket, which is the whole point of the design under test:
// the container never dials anything, so there is nothing to stub and no host alias to add.
function answerInference(socket, request, recorded) {
  const send = (event) => socket.send(JSON.stringify({ id: `pv-${request.requestId}`, type: "provider_stream", requestId: request.requestId, event }));
  const listing = request.path.includes("/models");
  if (!listing) {
    const body = request.body ? Buffer.from(request.body, "base64").toString("utf8") : undefined;
    recorded.push({ url: request.path, body: body ? JSON.parse(body) : undefined });
  }
  send({
    kind: "head",
    status: 200,
    statusText: "OK",
    headers: { "content-type": listing ? "application/json" : "text/event-stream" },
  });
  for (const chunk of listing ? [JSON.stringify({ data: [] })] : SSE) {
    send({ kind: "chunk", data: Buffer.from(chunk, "utf8").toString("base64") });
  }
  send({ kind: "end" });
}

async function bridge(port, frames, recorded) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/`);
  const events = [];
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve);
    socket.addEventListener("error", reject);
    setTimeout(() => reject(new Error("the bridge never opened")), 20000);
  });
  socket.addEventListener("message", (event) => {
    const frame = JSON.parse(event.data);
    events.push(frame);
    if (frame.type === "provider_request") answerInference(socket, frame.request, recorded);
  });
  socket.send(JSON.stringify({ id: "hello", type: "hello", token: TOKEN, protocolVersion: 1 }));
  await new Promise((resolve) => setTimeout(resolve, 1500));
  for (const frame of frames) {
    socket.send(JSON.stringify(frame));
    await new Promise((resolve) => setTimeout(resolve, 4000));
  }
  socket.close();
  return events;
}

// One container, one turn with a thinking level set, and whatever the stub was asked for. The model id matters:
// OpenRouter's aggregated ids name the provider it routes to, and two of pi's rules read them.
let leg = 0;
async function turn({ label, upstreamBaseUrl, modelId = MODEL }) {
  const recorded = [];
  const name = `cd-agent-shape-${label}`;
  const bridgePort = 41871 + leg++;
  await run(["rm", "-f", name]);
  const env = [
    `CD_BRIDGE_TOKEN=${TOKEN}`,
    "CD_BRIDGE_PORT=8787",
    "CD_MODEL_API=openai-completions",
    `CD_MODEL_ID=${modelId}`,
    "CD_MODEL_REASONING=1",
    "CD_MODEL_REASONING_LEVELS=minimal,low,medium,high",
    "CD_WORKSPACE=/workspace",
    "CD_AGENT_DIR=/home/agent/.pi/agent",
    ...(upstreamBaseUrl ? [`CD_UPSTREAM_BASE_URL=${upstreamBaseUrl}`] : []),
  ];
  const argv = ["run", "-d", "--name", name, "--publish", `127.0.0.1:${bridgePort}:8787`];
  if (engine === "podman") argv.push("--userns", "keep-id:uid=1001,gid=1001");
  for (const entry of env) argv.push("--env", entry);
  argv.push(image, "--mode", "agent");
  const started = await run(argv);
  if (started.code !== 0) throw new Error(`could not start ${name}: ${started.err || started.out}`);
  try {
    await new Promise((resolve) => setTimeout(resolve, 2500));
    await bridge(
      bridgePort,
      [
        { id: "s", type: "run_command", name: "settings", args: "thinkingLevel medium" },
        { id: "p", type: "prompt", text: "Say ok." },
      ],
      recorded,
    );
  } finally {
    const logs = await run(["logs", name]);
    if (!recorded.length) console.log(`[${label}] container log tail:\n${logs.out.split("\n").slice(-8).join("\n")}`);
    await run(["rm", "-f", name]);
  }
  return recorded;
}

function report(label, recorded) {
  const completion = recorded.find((entry) => entry.url.includes("chat/completions"));
  if (!completion) {
    console.log(`[${label}] no completion was ever asked for — ${recorded.length} other request(s)`);
    return undefined;
  }
  const body = completion.body ?? {};
  const facts = {
    systemRole: (body.messages ?? []).find((m) => m.role === "developer" || m.role === "system")?.role,
    store: body.store,
    maxTokensField: body.max_tokens !== undefined ? "max_tokens" : body.max_completion_tokens !== undefined ? "max_completion_tokens" : undefined,
    reasoning_effort: body.reasoning_effort,
    thinking: body.thinking,
    reasoning: body.reasoning,
  };
  console.log(`[${label}] ${JSON.stringify(facts)}`);
  return facts;
}

const OPENROUTER = "https://openrouter.ai/api/v1";
const undeclared = report("openai-inferred", await turn({ label: "plain", upstreamBaseUrl: undefined }));
const deepseek = report("deepseek-declared", await turn({ label: "deepseek", upstreamBaseUrl: "https://api.deepseek.com/v1" }));
const glm = report("glm-declared", await turn({ label: "glm", upstreamBaseUrl: "https://open.bigmodel.cn/api/paas/v4" }));
const routed = report(
  "openrouter-declared",
  await turn({ label: "openrouter", upstreamBaseUrl: OPENROUTER, modelId: "qwen/qwen3.8-max" }),
);
const routedToOpenAI = report(
  "openrouter-openai-model",
  await turn({ label: "openrouter-openai", upstreamBaseUrl: OPENROUTER, modelId: "openai/gpt-5" }),
);

const failures = [];
if (!undeclared || undeclared.reasoning_effort !== "medium") failures.push("the undeclared upstream should still get OpenAI's reasoning_effort");
if (!undeclared || undeclared.systemRole !== "developer") failures.push("the undeclared upstream should still get the developer role");
if (!deepseek || deepseek.thinking?.type !== "enabled") failures.push("DeepSeek should get thinking: {type: enabled}");
if (!deepseek || deepseek.systemRole !== "system") failures.push("DeepSeek should get the system role, not developer");
if (!deepseek || deepseek.store !== undefined) failures.push("DeepSeek should not be sent store");
if (!glm || glm.thinking?.type !== "enabled") failures.push("GLM should get thinking: {type: enabled}");
if (!glm || glm.reasoning_effort !== undefined) failures.push("GLM should not be sent reasoning_effort");
if (!glm || glm.maxTokensField !== "max_tokens") failures.push("GLM should be sent max_tokens");
if (!routed || routed.reasoning?.effort !== "medium") failures.push("OpenRouter should get reasoning: {effort}");
if (!routed || routed.reasoning_effort !== undefined) failures.push("OpenRouter should not also get reasoning_effort");
if (!routed || routed.systemRole !== "system") failures.push("an OpenRouter model with no developer role should get system");
if (!routedToOpenAI || routedToOpenAI.systemRole !== "developer") failures.push("OpenRouter's own OpenAI models still take the developer role");
if (!routedToOpenAI || routedToOpenAI.reasoning?.effort !== "medium") failures.push("an OpenAI model behind OpenRouter still gets the nested object");

if (failures.length) {
  console.error(`\nFAILED:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("\nEvery upstream got the shape it wants.");
