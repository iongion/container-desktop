export class Config {
  public store: any;
  public observers: any;

  constructor(store) {
    this.store = store;
    this.observers = {};
  }

  readData() {
    return this.store.read();
  }

  writeData(data) {
    this.store.write(data);
    return this;
  }

  get(key, defaultValue = undefined) {
    if (typeof key !== "string") return defaultValue;
    let object = this.readData();
    for (const name of key.split(".")) {
      if (!Object.prototype.propertyIsEnumerable.call(object, name)) {
        return defaultValue;
      }
      object = object[name];
      if (object === undefined) break;
    }
    return object === undefined ? defaultValue : object;
  }

  set(key, value) {
    if (typeof key !== "string") return this;

    const keys = key.split(".");
    const store = this.readData();
    let object = store;

    this.callObservers(key, value);

    for (let i = 0; i < keys.length - 1; i++) {
      const name = keys[i];

      if (typeof object[name] !== "object") {
        object[name] = {};
      }

      object = object[name];
    }

    object[keys[keys.length - 1]] = value;

    this.writeData(store);

    return this;
  }

  has(key) {
    return this.get(key) !== undefined;
  }

  delete(key) {
    if (typeof key !== "string") return this;

    const keys = key.split(".");
    const store = this.readData();
    let object = store;

    this.callObservers(key, undefined);

    for (let i = 0; i < keys.length; i++) {
      const name = keys[i];

      if (i === keys.length - 1) {
        delete object[name];
        break;
      }

      object = object[name];

      if (typeof object !== "object") {
        return this;
      }
    }

    this.writeData(store);
    return this;
  }

  getAll() {
    return this.readData();
  }

  setAll(data) {
    this.store.write(data);
    return this;
  }

  purge() {
    this.writeData({});
  }

  observe(key, handler) {
    let handlers = this.observers[key] || [];
    handlers.push(handler);

    handlers = handlers.filter((item, pos, self) => self.indexOf(item) === pos);

    this.observers[key] = handlers;
    return this;
  }

  callObservers(key, newValue) {
    if (!this.observers[key]) return;

    this.observers[key].forEach((handler) => {
      if (handler && typeof handler === "function") {
        handler(newValue, this.get(key), key);
      }
    });
  }
}
