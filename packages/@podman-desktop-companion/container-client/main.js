const { withClient, which } = require('./src/shell');

async function main() {
  const clientOpts = {
    socketPath: getApiUnixSocketPath(),
    retry: { count: 5, wait: 250 },
    // checkStatus: isSystemServiceRunning
  };
  const client = await withClient(clientOpts);
  client.on('close', ({ code, connect }) => {
    console.debug('Closed', code);
    // setTimeout(() => {
    //   client.emit('start');
    // }, 1000)
  });
  client.on('ready', async ({ driver, process }) => {
    const podmanPath = await which('podman');
    console.debug(podmanPath);
    const containers = await driver.get('/images/json');
    console.debug('containers', containers.data);
  });
  client.on('error', (info) => {
    console.debug('Process error', info);
  });
}

main();
