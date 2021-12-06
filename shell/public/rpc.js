// node
const fs = require("fs");
const path = require("path");
const { Blob } = require("buffer");
// vendors
const logger = require("electron-log");
const { v4: uuidv4 } = require("uuid");
// project

// POOR man's RPC

let worker;
const invocations = {};

const withWorker = (cb) => {
  if (!worker) {
    process.dlopen = () => {
      throw new Error("Load native module is not safe");
    };
    const workerPath = path.join(__dirname, "worker.js");
    const processorSource = fs.readFileSync(workerPath);
    let processorURL;
    if (typeof self?.webkitURL !== "undefined") {
      const processorBlob = new self.Blob([processorSource.toString()], { type: "text/javascript" });
      processorURL = self.webkitURL.createObjectURL(processorBlob);
    } else {
      const processorBlob = new Blob([processorSource.toString()], { type: "text/javascript" });
      processorURL = URL.createObjectURL(processorBlob);
    }
    const handler = (evt) => {
      const response = evt.data;
      const invocation = invocations[response.guid];
      if (!invocation) {
        logger.error("No such invocation", response.guid);
        return;
      }
      invocation.handled = true;
      logger.debug("Handler - clear timed-out", response.guid);
      clearTimeout(invocation.timeout);
      delete invocations[invocation.guid];
      // invoking the handler
      invocation.handler(response);
    };
    worker = new Worker(processorURL);
    worker.addEventListener("message", handler);
  }
  cb(worker);
};

const withWorkerRPC = (cb) =>
  new Promise((resolve, reject) => {
    try {
      withWorker((worker) => {
        const rpc = {
          invoke: (req, opts) => {
            const guid = `rpc-${uuidv4()}`;
            const message = {
              guid,
              type: "rpc.request",
              created: new Date().getTime() / 1000,
              payload: req,
              // timeout control
              handled: false,
              timeout: null,
              maxExecutionTime: 30000
            };
            // logger.debug('Starting response listener', guid);
            invocations[guid] = {
              message,
              handler: (response) => {
                // logger.debug('Graceful - clear timed-out', guid);
                clearTimeout(message.timeout);
                try {
                  if (response.success) {
                    resolve(response.payload);
                  } else {
                    reject(new Error(response.payload.error));
                  }
                } catch (error) {
                  logger.error("Error during response resolving", error, response);
                  reject(new Error("Message response error"));
                }
              }
            };
            // logger.debug('Starting timeout listener', message);
            message.timeout = setTimeout(() => {
              logger.error("Expired - clear timed-out", guid);
              clearTimeout(message.timeout);
              if (message.handled) {
                // logger.debug('Message handled', guid);
                return;
              }
              message.handled = true;
              delete invocations[guid];
              logger.error("Response timed-out", guid);
              reject(new Error("Worker communication timeout"));
            }, message.maxExecutionTime);
            // logger.debug('Message sent', message);
            worker.postMessage(message);
          }
        };
        cb(rpc);
      });
    } catch (error) {
      reject(error);
    }
  });

module.exports = {
  withWorkerRPC
};
