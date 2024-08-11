import { Config } from "./Config";
import { ConfigFile } from "./ConfigFile";
import { utils } from "./utils";
import { WindowManager } from "./WindowManager";

export class ElectronCfg {
  private loggerInstance: any;
  private configFile: any;
  private config: any;
  private windows: any;

  constructor(fileName, logger) {
    this.loggerInstance = logger;
    this.configFile = new ConfigFile(fileName, logger);
    this.config = new Config(this.configFile);
    this.windows = {};
  }

  static create(fileName, logger?: any) {
    return new ElectronCfg(fileName, logger);
  }

  get(key, defaultValue = undefined) {
    return this.config.get(key, defaultValue);
  }

  set(key, value) {
    this.config.set(key, value);
    return module.exports;
  }

  has(key) {
    return this.config.has(key);
  }

  getAll() {
    return this.config.getAll();
  }

  setAll(data) {
    this.config.setAll(data);
    return this;
  }

  delete(key) {
    this.config.delete(key);
    return module.exports;
  }

  all(data) {
    console.warn("electron-cfg all() is deprecated. Use getAll() or setAll() instead.");
    if (data) {
      return this.setAll(data);
    }
    return this.getAll();
  }

  file(fileName) {
    if (fileName) {
      this.configFile.setFilePath(fileName);
      return undefined;
    }

    return this.configFile.filePath;
  }

  observe(key, handler) {
    this.config.observe(key, handler);
    return module.exports;
  }

  purge() {
    this.config.purge();
    return module.exports;
  }

  logger(logger) {
    if (logger) {
      this.loggerInstance = logger;
      this.configFile.setLogger(logger);
      return undefined;
    }

    return this.loggerInstance;
  }

  window(windowOptions) {
    const opts = {
      name: "main",
      saveFullscreen: true,
      saveMaximize: true,
      ...windowOptions
    };

    const name = opts.name;

    if (!this.windows[name]) {
      this.windows[name] = new WindowManager(opts, this.config, this.loggerInstance);
    }

    return this.windows[name];
  }

  resolveUserDataPath(filePath, appName = undefined) {
    return utils.resolveUserDataPath(filePath, appName);
  }
}
