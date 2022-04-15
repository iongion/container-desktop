const os = require('os');
const { setWorldConstructor, World } = require('@cucumber/cucumber');

class ClientWorld extends World {
  client = null
  connections = {}
  constructor(opts) {
    super(opts);
    this.os = os.type();
  }
}

setWorldConstructor(ClientWorld);
