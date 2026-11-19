import { readFileSync } from "node:fs";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

/** The deploy config is the only source of the origin: a test binding that hardcodes a second one hides a mismatch. */
function siteOrigin(): string {
  const path = decodeURIComponent(new URL("./wrangler.jsonc", import.meta.url).pathname);
  const raw = readFileSync(path, "utf8");
  const found = /"SITE_ORIGIN"\s*:\s*"([^"]+)"/.exec(raw);
  if (!found?.[1]) throw new Error("wrangler.jsonc declares no SITE_ORIGIN");
  return found[1];
}

export default defineConfig(async () => ({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        d1Databases: ["DB"],
        bindings: {
          SITE_ORIGIN: siteOrigin(),
          SESSION_HMAC_KEY: "a2Fsc2EtdGVzdC1zaWduaW5nLWtleS0zMi1ieXRlcyEh",
          GITHUB_CLIENT_ID: "github-client-id",
          GITHUB_CLIENT_SECRET: "github-client-secret",
          HF_CLIENT_ID: "hf-client-id",
          HF_CLIENT_SECRET: "hf-client-secret",
          GITLAB_CLIENT_ID: "gitlab-client-id",
          GITLAB_CLIENT_SECRET: "gitlab-client-secret",
          MIGRATIONS: await readD1Migrations("./migrations"),
        },
      },
    }),
  ],
}));
