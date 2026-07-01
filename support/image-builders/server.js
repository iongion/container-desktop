// Minimal runnable app so the sample image's CMD ["node", "server.js"] actually starts something. Used only
// by the Build Studio's development sample context (support/image-builders); not part of the desktop app.
const http = require("node:http");

const port = Number.parseInt(process.env.PORT ?? "3000", 10);

http
  .createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("container-desktop build sample: OK\n");
  })
  .listen(port, () => {
    console.log(`container-desktop build sample listening on :${port}`);
  });
