import type { D1Migration } from "@cloudflare/vitest-plugin";

declare global {
  namespace Cloudflare {
    interface Env {
      MIGRATIONS: D1Migration[];
    }
  }
}
