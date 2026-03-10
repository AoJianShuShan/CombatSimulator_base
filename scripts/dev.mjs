import { createServer } from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildProject } from "./build.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const port = Number(process.env.PORT ?? 4173);
const host = process.env.HOST ?? "127.0.0.1";

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function resolveRequestPath(urlPath) {
  const cleanedPath = urlPath === "/" ? "/index.html" : urlPath;
  const relativePath = cleanedPath.replace(/^\/+/, "");
  return path.join(distDir, relativePath);
}

let pendingBuild = Promise.resolve();

function ensureBuild() {
  pendingBuild = pendingBuild.then(() => buildProject());
  return pendingBuild;
}

await ensureBuild();

const server = createServer(async (request, response) => {
  try {
    await ensureBuild();
    const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    const filePath = resolveRequestPath(requestUrl.pathname);
    const file = await fs.readFile(filePath);
    const contentType = contentTypes[path.extname(filePath)] ?? "application/octet-stream";

    response.writeHead(200, { "Content-Type": contentType });
    response.end(file);
  } catch (error) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not Found");
  }
});

server.listen(port, host, () => {
  console.log(`Dev server running at http://${host}:${port}`);
});
