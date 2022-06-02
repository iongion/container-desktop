// node
// module
const { createApiDriver } = require("../../src");
// locals

describe("api", () => {
  test("createApiDriver", async () => {
    const driver = createApiDriver();
    expect(driver).not.toBe(null);
  });
});
