import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { stripTypeScriptTypes } from "node:module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const srcDir = path.join(rootDir, "src");
const distDir = path.join(rootDir, "dist");

async function walkFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return walkFiles(fullPath);
      }

      return [fullPath];
    }),
  );

  return files.flat();
}

function rewriteTypeScriptImports(code) {
  return code
    .replace(/(from\s+["'][^"']+)\.ts(["'])/g, "$1.js$2")
    .replace(/(import\s+["'][^"']+)\.ts(["'])/g, "$1.js$2");
}

function rewriteHtmlReferences(code) {
  return code.replace(/\.ts(["'])/g, ".js$1");
}

async function buildTypeScriptFile(sourcePath, targetPath) {
  const source = await fs.readFile(sourcePath, "utf8");
  const stripped = stripTypeScriptTypes(source, {
    mode: "transform",
    sourceUrl: path.relative(rootDir, sourcePath),
  });
  const output = rewriteTypeScriptImports(stripped);

  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, output, "utf8");
}

async function copyStaticFile(sourcePath, targetPath) {
  const source = await fs.readFile(sourcePath, "utf8");
  const output = path.extname(sourcePath) === ".html" ? rewriteHtmlReferences(source) : source;

  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, output, "utf8");
}

export async function buildProject() {
  await fs.mkdir(distDir, { recursive: true });

  const files = await walkFiles(srcDir);
  await Promise.all(
    files.map(async (filePath) => {
      const relativePath = path.relative(srcDir, filePath);
      const extension = path.extname(filePath);
      const outputPath =
        extension === ".ts"
          ? path.join(distDir, relativePath.replace(/\.ts$/, ".js"))
          : path.join(distDir, relativePath);

      if (extension === ".ts") {
        await buildTypeScriptFile(filePath, outputPath);
        return;
      }

      await copyStaticFile(filePath, outputPath);
    }),
  );
}

const isDirectRun =
  process.argv[1] != null && import.meta.url === String(pathToFileURL(path.resolve(process.argv[1])));

if (isDirectRun) {
  await buildProject();
  console.log("Build completed.");
}
