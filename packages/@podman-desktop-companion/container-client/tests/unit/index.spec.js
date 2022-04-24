// node
// module
const library = require("../../src");
// locals
const { testOnLinux, testOnWindows, testOnMacOS } = require("../helpers");

jest.setTimeout(30000);

describe("library", () => {
  test("exported clients", async () => {
    expect(library.Clients).toHaveProperty("Docker");
    expect(library.Clients).toHaveProperty("Podman");
  });
  test("exported clients - Docker", async () => {
    expect(library.Clients.Docker).toHaveProperty("LIMA");
    expect(library.Clients.Docker).toHaveProperty("Native");
    // expect(library.Clients.Docker).toHaveProperty("Remote");
    expect(library.Clients.Docker).toHaveProperty("Virtualized");
    expect(library.Clients.Docker).toHaveProperty("WSL");
  });
  test("exported clients - Podman", async () => {
    expect(library.Clients.Podman).toHaveProperty("LIMA");
    expect(library.Clients.Podman).toHaveProperty("Native");
    // expect(library.Clients.Podman).toHaveProperty("Remote");
    expect(library.Clients.Podman).toHaveProperty("Virtualized");
    expect(library.Clients.Podman).toHaveProperty("WSL");
  });
});
