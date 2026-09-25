import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const sdkDist = fileURLToPath(new URL("../sdk/dist/", import.meta.url));
// The message contract is owned by the SDK package; the checkout compiles against its source.
const protocol = fileURLToPath(new URL("../sdk/src/protocol.ts", import.meta.url));

/**
 * Dev only: serve the SDK bundle from the checkout's own origin, the same way production
 * serves /sdk/dodo-checkout.js next to /checkout/. The SDK finds the checkout relative to
 * its own <script src>, so this keeps dev and prod on one code path.
 */
function serveSdk(): Plugin {
  return {
    name: "nimbus:serve-sdk",
    configureServer(server) {
      server.middlewares.use("/sdk/", async (req, res, next) => {
        const file = req.url?.split("?")[0];
        if (file !== "/dodo-checkout.js" && file !== "/dodo-checkout.js.map") return next();
        try {
          const body = await readFile(sdkDist + file.slice(1));
          res.setHeader("Content-Type", file.endsWith(".map") ? "application/json" : "text/javascript");
          res.setHeader("Cache-Control", "no-store");
          res.end(body);
        } catch {
          res.statusCode = 404;
          res.end("SDK not built yet. `pnpm dev` builds it; give it a second and reload.");
        }
      });
    },
  };
}

export default defineConfig({
  base: "/checkout/",
  plugins: [react(), serveSdk()],
  resolve: { alias: { "@nimbus-goods/sdk/protocol": protocol } },
  // The checkout runs in a sandboxed iframe with an opaque ("null") origin, so every
  // module/asset request it makes is cross-origin. Assets are public; allow any origin.
  server: { port: 5174, strictPort: true, cors: { origin: "*" } },
  preview: { port: 5174, strictPort: true, cors: { origin: "*" } },
  build: { target: "es2020", sourcemap: true },
});
