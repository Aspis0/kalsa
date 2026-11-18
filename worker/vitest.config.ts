import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => ({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        d1Databases: ["DB"],
        bindings: {
          SITE_ORIGIN: "https://kalsa.io",
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
