// The MCP server end to end over the mock app: turned on in Settings, then driven from this process the way an AI
// client drives it, over loopback HTTP with the token the panel shows. The mode is switched in the UI too. The run's
// own user data holds the token, never the OS keychain.
import { navigate, waitReady } from "../support/mockApp.js";

const SETTINGS_ROUTE = "/screens/settings/user-settings?category=mcp";
const CONTAINERS_ROUTE = "/screens/containers";
const PROTOCOL_VERSION = "2025-11-25";

const panelValue = (selector) => browser.$(selector).getValue();

async function waitUntilIdle() {
  await browser.$("#mcpMode").waitForEnabled({ timeout: 30000 });
}

function mcpClient(url, token) {
  let id = 0;
  return async function post(message, { headers = {}, authorization = `Bearer ${token}` } = {}) {
    const body =
      "method" in message && !message.method.startsWith("notifications/") ? { id: ++id, ...message } : message;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization,
        "mcp-protocol-version": PROTOCOL_VERSION,
        ...headers,
      },
      body: JSON.stringify({ jsonrpc: "2.0", ...body }),
    });
    const text = await response.text();
    return {
      status: response.status,
      json: text && response.headers.get("content-type")?.includes("json") ? JSON.parse(text) : null,
    };
  };
}

async function runningContainerIds() {
  await navigate(browser, CONTAINERS_ROUTE);
  const rows = 'tr[data-container][data-state="running"]';
  await browser.waitUntil(async () => (await browser.$$(rows)).length > 0, {
    timeout: 30000,
    timeoutMsg: "no running container row on the Containers screen",
  });
  return browser.execute(
    (selector) => [...document.querySelectorAll(selector)].map((row) => row.getAttribute("data-container")),
    rows,
  );
}

describe("mcp-server over the mock app", () => {
  let post;

  async function callTool(name, args = {}) {
    const { json } = await post({ method: "tools/call", params: { name, arguments: args } });
    return json.result;
  }

  // A container running on screen, and the connection it runs on. The table is virtualized and grouped by
  // connection, so the rows on screen may all belong to a connection other than the current one.
  async function runningTarget() {
    const running = await runningContainerIds();
    const connections = (await callTool("listConnections")).structuredContent.result;
    for (const connection of connections.filter((candidate) => candidate.running)) {
      const listed = await callTool("listContainers", { connectionId: connection.id });
      expect(listed.isError).toBeFalsy();
      // listContainers answers with summaries: id, name, image, state.
      const match = listed.structuredContent.result.find((container) => running.includes(container.id));
      if (match) return { id: match.id, connectionId: connection.id };
    }
    throw new Error(`no connection lists a container running on screen (${running.length} running rows)`);
  }

  before(async () => {
    await browser.pause(4000);
    await waitReady(browser);
  });

  it("starts listening from Settings and shows its endpoint and token", async () => {
    await navigate(browser, SETTINGS_ROUTE);
    const enabled = await browser.$("#mcpEnabled");
    await enabled.waitForExist({ timeout: 30000 });
    expect(await enabled.isSelected()).toBe(false);
    await enabled.parentElement().click();

    await browser.$('.AppSettingsMcpStatus[data-running="yes"]').waitForExist({ timeout: 30000 });
    const url = await panelValue(".McpEndpoint input");
    const token = await panelValue(".McpToken input");
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    post = mcpClient(url, token);
  });

  it("answers the handshake and lists every tool, the changing ones included, while read-only", async () => {
    const init = await post({
      method: "initialize",
      params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "e2e", version: "1" } },
    });
    expect(init.status).toBe(200);
    expect(init.json.result.protocolVersion).toBe(PROTOCOL_VERSION);
    expect((await post({ method: "notifications/initialized" })).status).toBe(202);

    const listed = await post({ method: "tools/list" });
    const names = listed.json.result.tools.map((tool) => tool.name);
    expect(names).toContain("listContainers");
    // A client reads the list once per session, so the changing tools are there before the UI allows them.
    expect(names).toContain("stopContainer");
  });

  it("refuses a change in read-only, then makes it once the UI allows changes", async () => {
    const target = await runningTarget();

    const refused = await callTool("stopContainer", target);
    expect(refused.isError).toBe(true);
    expect(refused.content[0].text).toContain("read-only");
    expect(refused.content[0].text).toContain('"Allow changes"');

    await navigate(browser, SETTINGS_ROUTE);
    await waitUntilIdle();
    await browser.$("#mcpMode").selectByAttribute("value", "allow");
    await waitUntilIdle();

    // The mock engine accepts a stop and keeps serving the same fixtures, so the row stays "running" here; that the
    // stop reached the engine is all a mock run can show.
    const stopped = await callTool("stopContainer", target);
    expect(stopped.isError).toBeFalsy();
    expect(stopped.structuredContent.result).toBe(true);
  });

  it("turns away a web page that is not local and a wrong token", async () => {
    const ping = { method: "ping" };
    expect((await post(ping, { headers: { origin: "http://evil.example" } })).status).toBe(403);
    expect((await post(ping, { authorization: `Bearer ${"f".repeat(64)}` })).status).toBe(401);
    expect((await post(ping)).status).toBe(200);
  });
});
