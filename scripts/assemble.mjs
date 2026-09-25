// Puts the three builds into one static site, the shape Vercel serves:
//   dist/             <- demo-site   (the store)
//   dist/checkout/    <- checkout-app
//   dist/sdk/         <- sdk         (dodo-checkout.js)
import { cp, readdir, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const out = join(root, "dist");
const parts = [
  ["packages/demo-site/dist", ""],
  ["packages/checkout-app/dist", "checkout"],
  ["packages/sdk/dist", "sdk"],
];

await rm(out, { recursive: true, force: true });
for (const [from, to] of parts) {
  const src = join(root, from);
  await stat(src).catch(() => {
    throw new Error(`${from} is missing. Did its build run?`);
  });
  await cp(src, join(out, to), { recursive: true });
}

// Production must not depend on a dev machine.
async function* files(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) yield* files(p);
    else if (/\.(html|js|css)$/.test(entry.name)) yield p;
  }
}
const offenders = [];
for await (const file of files(out)) {
  if (/localhost|127\.0\.0\.1/.test(await readFile(file, "utf8"))) offenders.push(file);
}
if (offenders.length) {
  throw new Error(`Build references localhost:\n  ${offenders.join("\n  ")}`);
}

console.log("Assembled dist/: / (store), /checkout/ (checkout app), /sdk/dodo-checkout.js (SDK)");
