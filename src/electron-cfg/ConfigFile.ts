import fs from "node:fs";
import path from "node:path";
import { utils } from "./utils";

export class ConfigFile {
  private uniqueId!: any;
  private filePath!: any;
  private logger!: any;

  constructor(filePath, logger) {
    this.uniqueId = new Date().getTime();
    this.setLogger(logger);
    this.setFilePath(filePath);
  }

  setFilePath(filePath) {
    try {
      this.filePath = utils.resolveUserDataPath(filePath);
    } catch (e: any) {
      throw new Error(`Can't get config path automatically. ${e.message}`);
    }
  }

  setLogger(logger = undefined) {
    this.logger = logger === undefined ? console : logger;
  }

  read() {
    try {
      return Object.assign(Object.create(null), JSON.parse(fs.readFileSync(this.filePath, "utf8")));
    } catch (e) {
      return Object.create(null);
    }
  }

  write(data) {
    const text = JSON.stringify(data, null, "  ");

    try {
      this.writeAtomic(text);
    } catch (e) {
      try {
        const dirPath = path.dirname(this.filePath);
        fs.mkdirSync(dirPath, { recursive: true });
        this.writeAtomic(text);
      } catch (e2) {
        if (this.logger) {
          this.logger.warn(e2);
        }
        throw e2;
      }
    }
  }

  writeAtomic(text) {
    this.uniqueId += 1;
    const tempFile = this.filePath + "." + this.uniqueId;
    fs.writeFileSync(tempFile, text);
    fs.renameSync(tempFile, this.filePath);
  }
}
