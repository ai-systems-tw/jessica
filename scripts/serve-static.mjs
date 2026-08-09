import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import process from "node:process";
import { isPathInsideRoot } from "./static-path.mjs";

const root = resolve(process.argv[2] ?? "dist/apps/try-on-web");
const port = Number(process.argv[3] ?? 4173);
const types = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".wasm", "application/wasm"],
  [".glb", "model/gltf-binary"],
]);
const securityHeaders = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "permissions-policy": "camera=(self), microphone=(), geolocation=()",
  "cross-origin-resource-policy": "same-origin",
};

const server = createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    const requestPath = requestUrl.pathname === "/" ? "index.html" : requestUrl.pathname.replace(/^\/+/, "");
    const candidate = resolve(join(root, normalize(requestPath)));
    if (!isPathInsideRoot(root, candidate)) {
      response.writeHead(403, securityHeaders).end("Forbidden");
      return;
    }
    const info = await stat(candidate);
    const path = info.isDirectory() ? join(candidate, "index.html") : candidate;
    response.writeHead(200, {
      "content-type": types.get(extname(path)) ?? "application/octet-stream",
      "cache-control": "no-store",
      ...securityHeaders,
    });
    createReadStream(path).pipe(response);
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8", ...securityHeaders }).end("Not found");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Jessica try-on shell: http://127.0.0.1:${port}`);
});
