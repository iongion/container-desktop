const { getEngine, getProgramPath } = require('./');

test('getEngine', async () => {
  const engine = await getEngine();
  expect(engine).toBe('virtualized.wsl');
});

test('getProgramPath', async () => {
  const location = await getProgramPath();
  expect(location).toBe('/usr/bin/podman');
});
