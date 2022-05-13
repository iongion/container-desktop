// node
// module
const { Application } = require("../../src");
// locals
const {
  testOnLinux,
  testOnWindows,
  testOnMacOS
  // ensurePodmanMachineIsRunning,
  // ensureLIMAInstanceIsRunning
} = require("../helpers");
// fixtures

describe("Application", () => {
  test("constructor", () => {
    const app = new Application("1.0.0", "testing");
    expect(app).toHaveProperty("registry");
  });
  test("init", async () => {
    const app = new Application("1.0.0", "testing");
    const connectors = await app.getConnectors();
    expect(connectors.length).toBeGreaterThan(0);
  });
});
