# Pre-push audit: telemetry custom domain

Target: /Users/marco/.paseo/worktrees/1vffp1wo/telemetry-domain,
branch telemetry-kalsa-io, HEAD
213850e1b617831586e9b9c18b0144ea74664efb.

No push or deploy was performed.

## 1. Commit scope — CONFIRMED

~~~
$ git rev-list --parents -n1 HEAD
213850e1b617831586e9b9c18b0144ea74664efb 6dd71c29f3379a865427d01b559c56bc1559f15d
$ git log --first-parent --oneline 6dd71c29f3379a865427d01b559c56bc1559f15d..HEAD
213850e1 feat(telemetry): move the Worker origin to telemetry.kalsa.io
$ git diff --name-only 6dd71c29f3379a865427d01b559c56bc1559f15d..HEAD
README.md
src/telemetry/config.ts
workers/telemetry/README.md
workers/telemetry/wrangler.example.toml
workers/telemetry/wrangler.toml
~~~

This is exactly the requested five-file set. The changed-file scan found no
absolute /Users/marco path, private-key material, credential, or literal token.

## 2. Client origin and constants — CONFIRMED

src/telemetry/config.ts:18-19 contains:

~~~
export const TELEMETRY_WORKER_URL: string =
  "https://telemetry.kalsa.io";
~~~

The focused source scan:

~~~
$ rg -n -i 'telemetry\.kalsa\.io|kalsa-telemetry|workers\.dev|TELEMETRY_WORKER_URL' src
src/telemetry/config.ts:9: ... telemetry.kalsa.io
src/telemetry/config.ts:12: ... *.workers.dev host.
src/telemetry/config.ts:18:export const TELEMETRY_WORKER_URL: string =
src/telemetry/config.ts:19:  "https://telemetry.kalsa.io";
src/telemetry/telemetry.ts:24:  TELEMETRY_WORKER_URL,
src/telemetry/telemetry.ts:649:  const base = (TELEMETRY_WORKER_URL || "").trim();
~~~

No other src file hardcodes a telemetry host. Other https matches are
unrelated provider, GitHub, Hugging Face, or test-fixture URLs.

The zero-context config diff was:

~~~
$ git diff --unified=0 6dd71c2..HEAD -- src/telemetry/config.ts
-  "https://kalsa-telemetry.aspislauncher.workers.dev";
+  "https://telemetry.kalsa.io";
~~~

All other config constants, including TELEMETRY_URL_OVERRIDE_KEY and the
state/opt-out/quarantine/schema/capacity/retry/timeout/cache/body/signal
constants, are unchanged from the parent.

## 3. Wrangler config preservation — CONFIRMED

The requested line-by-line production diff has only these semantic changes:

~~~
$ git diff --unified=80 6dd71c2..HEAD -- workers/telemetry/wrangler.toml
-workers_dev = true
+workers_dev = false
+routes = [ { pattern = "telemetry.kalsa.io", custom_domain = true } ]
...
 [[durable_objects.bindings]]
 name = "TELEMETRY_BUFFER"
 class_name = "TelemetryBuffer"
 [[migrations]]
 tag = "v1"
 new_sqlite_classes = ["TelemetryBuffer"]
 [[kv_namespaces]]
 binding = "DEDUPE_KV"
 id = "a3c61b5e1ee94367ae8637c11118ce24"
 preview_id = "913e744484794fd990922c7dad701c6f"
 [vars]
 GITHUB_REPO = "Aspis0/kalsa"
 AUTO_OPEN_ISSUES = "false"
~~~

No binding, KV ID, preview ID, migration tag/class, var, or secret-comment
change is present. A change to any of those would be blocking.

The example has matching origin settings:

~~~
$ git show HEAD:workers/telemetry/wrangler.toml | rg '^workers_dev|^routes'
workers_dev = false
routes = [ { pattern = "telemetry.kalsa.io", custom_domain = true } ]
$ git show HEAD:workers/telemetry/wrangler.example.toml | rg '^workers_dev|^routes'
workers_dev = false
routes = [ { pattern = "telemetry.kalsa.io", custom_domain = true } ]
~~~

## 4. Legacy host and dashboard instructions — CONFIRMED

The exact legacy-host check:

~~~
$ grep -RFn --exclude-dir=.git -- 'kalsa-telemetry.aspislauncher.workers.dev' .
grep_rc=1
$ git grep -n -F 'kalsa-telemetry.aspislauncher.workers.dev' HEAD
<empty>
~~~

The domain-binding instruction scan was empty:

~~~
$ git grep -n -i -E 'bind.*(domain|route)|custom domain.*(dashboard|bind)|dashboard.*(domain|route|bind)' HEAD -- README.md workers/telemetry src
<empty>
~~~

The only remaining dashboard mention is workers/telemetry/README.md:80,
where the human flips AUTO_OPEN_ISSUES when ready. It is not a domain-bind
instruction. workers/telemetry/wrangler.toml:9-11 explicitly says the route is
declared in the TOML rather than the Cloudflare dashboard.

Generic workers_dev/workers.dev references are correct:

* TOML workers_dev = false is the live/template configuration.
* The comments in src/telemetry/config.ts:11-12,
  workers/telemetry/wrangler.toml:4-10, and
  workers/telemetry/README.md:67-70 explain retirement of the deleted host.
* archived/docs/TELEMETRY_OPTIN.md:251 is a historical archived statement
  that production uses custom routes with workers_dev off.

No remaining generic reference instructs an operator to use the old host.

## 5. Tests — UNVERIFIABLE for runtime execution; no origin assertion

No test asserts the telemetry origin:

~~~
$ rg -n -i 'TELEMETRY_WORKER_URL|telemetry\.kalsa\.io|kalsa-telemetry\.aspislauncher\.workers\.dev|workers\.dev' --glob '*test*' --glob '*spec*' src workers .github
<empty>
~~~

src/telemetry/pure.test.ts tests pure payload helpers and only uses unrelated
example URLs. There is no test for the changed origin. The repository CI
invocation is npx jest --runInBand at .github/workflows/ci.yml:44, but this
worktree has no node_modules/.bin/jest and package.json has no generic test
script. I did not install dependencies or guess at a result.

## 6. Push safety — CONFIRMED

~~~
$ git rev-parse HEAD^1
6dd71c29f3379a865427d01b559c56bc1559f15d
$ git -C /Users/marco/Projects/kalsallama rev-parse origin/b11010-merge
6dd71c29f3379a865427d01b559c56bc1559f15d
$ git rev-parse app-integration-2026-09-20
6dd71c29f3379a865427d01b559c56bc1559f15d
$ git merge-base --is-ancestor 6dd71c2 HEAD && echo ancestor=true
ancestor=true
~~~

The app points at the custom domain, the Worker config disables workers.dev
and declares the custom route, and all bindings/IDs/migrations/vars remain
stable. No changed-file or documentation finding makes this push unsafe. The
missing origin-specific test is a coverage gap; the live deployment behavior
described by the owner was not re-probed by this read-only audit.

## Required fixes

None.

Exact push command:

~~~
git -C /Users/marco/.paseo/worktrees/1vffp1wo/telemetry-domain push origin 213850e1b617831586e9b9c18b0144ea74664efb:app-integration-2026-09-20
~~~

Final line: PUSH-SAFE for pushing 213850e1 onto the app integration branch.
