const { spawn } = require('child_process');
const { expose } = require("threads/worker");

expose({
  execPodman: () => {
    const result = {
      success: false,
      pid: null,
      stdout: '',
      stderr: '',
    };
    return new Promise((resolve, reject) => {
      const child = spawn(
        'podman',
        [
          'system',
          'service',
          '--time=0',
          'unix:///tmp/podman.sock',
          '--log-level=debug'
        ], {
        encoding: 'utf-8',
      });
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (data) => {
        const frame = data.toString();
        result.stdout += frame;
        console.debug('Update stdout', frame);
      });
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (data) => {
        const frame = data.toString();
        result.stderr += frame;
        console.debug('Update stderr', frame);
      });
      child.on('error', (code) => {
        console.error('Child process error', code);
      });
      child.on('exit', (code) => {
        console.debug('Child process exit', code);
      });
      child.on('close', (code) => {
        console.debug('Child process close', code);
      });
      setInterval(() => {
        console.debug('Monitoring buffer', result);
      }, 1000);
      // resolve(result);
    })
  },
});
