// Serves dist/ locally the way Vercel will, applying the headers from vercel.json,
// so the sandbox/CORS/CSP setup can be checked before deploying.
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const dist = join(root, "dist");
const port = Number(process.env.PORT ?? 4173);
const vercel = JSON.parse(await readFile(join(root, "vercel.json"), "utf8"));

const rules = (vercel.headers ?? []).map((rule) => ({
  test: new RegExp(`^${rule.source.replace(/\(\.\*\)/g, ".*")}$`),
  headers: rule.headers,
}));
const redirects = (vercel.redirects ?? []).map((r) => [r.source, r.destination]);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".map": "application/json",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};

createServer(async (req, res) => {
  const pathname = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
  const redirect = redirects.find(([from]) => from === pathname);
  if (redirect) {
    res.writeHead(307, { Location: redirect[1] });
    return res.end();
  }
  for (const rule of rules) {
    if (rule.test.test(pathname)) for (const { key, value } of rule.headers) res.setHeader(key, value);
  }
  let file = normalize(join(dist, pathname));
  if (!file.startsWith(dist)) {
    res.writeHead(403);
    return res.end();
  }
  try {
    if ((await stat(file)).isDirectory()) file = join(file, "index.html");
    await stat(file);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    return res.end("Not found");
  }
  res.setHeader("Content-Type", TYPES[extname(file)] ?? "application/octet-stream");
  createReadStream(file).pipe(res);
}).listen(port, () => console.log(`Serving dist/ on http://localhost:${port}`));
