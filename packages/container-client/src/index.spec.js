const electronConfig = require("electron-cfg");

const { isLIMA, isWSL, isNATIVE, getEngine, getProgramPath } = require("./");

test("getEngine", async () => {
  electronConfig.set('engine', '');
  // TODO: Mock OS type and test methods directly
  let expected = "remote";
  if (isNATIVE()) {
    expected = "native";
  } else if (isWSL()) {
    expected = "virtualized.wsl";
  } else if (isLIMA()) {
    expected = "virtualized.lima";
  }
  const detected = await getEngine();
  expect(detected).toBe(expected);
});

test("getProgramPath", async () => {
  const location = await getProgramPath();
  expect(location).toBe("/usr/bin/podman");
});
