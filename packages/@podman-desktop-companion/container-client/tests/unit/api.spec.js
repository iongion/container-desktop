// node
// module
const { createApiDriver } = require("../../src");
// locals

jest.setTimeout(50000); // Give time for windows testing VM

describe("api", () => {
  test("createApiDriver", async () => {
    const driver = createApiDriver();
    expect(driver).not.toBe(null);
  });
});
