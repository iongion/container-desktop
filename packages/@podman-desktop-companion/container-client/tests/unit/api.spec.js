// node
// module
const { createApiDriver } = require("../../src");
const api = require("../../src/api");
// locals
const { testOnLinux, testOnWindows, testOnMacOS } = require("../helpers");

jest.setTimeout(30000);

describe("api", () => {
  test("createApiDriver", async () => {
    const driver = createApiDriver();
    expect(driver).not.toBe(null);
  });
});
