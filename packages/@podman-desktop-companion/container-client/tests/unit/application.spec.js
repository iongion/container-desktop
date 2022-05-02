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
    const engines = await app.getEngines();
    expect(engines.length).toBeGreaterThan(0);
  });
  testOnLinux("getCurrentEngine", () => {
    const app = new Application("1.0.0", "testing");
    const engine = await app.getCurrentEngine();
    expect(engine.id).toBe("podman.native");
  });
});
