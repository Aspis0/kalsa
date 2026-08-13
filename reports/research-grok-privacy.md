# Grok CLI session sync & retention recon

**Date:** 2026-08-13  
**CLI under test:** Grok Build 1.0.3 (stable), Windows, OIDC login via `accounts.x.ai` / `auth.x.ai`  
**Local home:** `~/.grok` (this machine)  
**Account state on this machine:** `coding_data_retention_opt_out = true` in `~/.grok/auth.json`; `[privacy] privacy_banner_acked` set 2026-08-12T23:00:39Z; no `[cli] session_registry`, no telemetry keys, no ZDR badge in auth.

## Verdict (blunt)

Yes. The Grok CLI has a first-class **cross-host session registry**. It is not a rumor and not just “the model remembering things.” It is a REST + GCS replica pipeline whose own source comment says it exists for **“cross-host session replication.”**

What is **not** documented as a ChatGPT-style unified inbox: grok.com consumer chat history and the Grok iOS/Android apps are a different product surface. There is **no primary-source claim** that CLI transcripts appear in grok.com’s regular History panel.

What **is** documented and implemented:

- Sessions are registered, updated, searched, downloaded, and deleted against `cli-chat-proxy.grok.com` (`/v1/sessions/...`).
- Conversation restore of a remote session is a supported CLI flag (`--resume` of a remote session restores conversation; `--restore-code` restores a repo snapshot).
- Enterprise docs name `code.grok.com` as “Remote session sync, sharing, WebSocket relay.”
- Manual titles are explicitly said to persist “across machines.”
- `grok sessions search` “combines a local SQLite index with remote results.”

**Disclosure is incomplete and lopsided.** The user-facing Sessions page still describes sessions as local disk only. The first-run banner is about *training/retention of coding data*, not “we replicate your sessions and cwd to your account so another machine can list and resume them.” Cross-device sync is documented in the enterprise network table and in CLI `--help` / open source — not in the first-run privacy banner.

**The Mac sighting is explained by a documented mechanism** (CLI session registry + `grok sessions list` merging remote rows). Inverse evidence on this Windows box: `grok sessions list` in this non-git scratchpad shows three July sessions as `STATUS = remote` that **do not exist on local disk**. Those titles are Figlyph work from 2026-07-09/10 — almost certainly created on the other machine. That is the same pipe running in the opposite direction.

Whether *today’s* Windows sessions are currently being *uploaded* is a separate question: this session lists as `local` (not `both`), and the user has already opted out of coding-data retention. Listing remotes still happens even when upload hooks are off.

---

## How to read this report

| Tag | Meaning |
| --- | --- |
| **DOCUMENTED** | Primary source with URL (docs.x.ai, x.ai legal, xAI official post, shipped CLI docs, or `xai-org/grok-build` source). |
| **OBSERVED** | Live behavior on this machine (CLI output, `~/.grok` files, strings in `grok.exe` 1.0.3). |
| **INFERRED** | Logical consequence of documented + observed facts. Not independently proven. |
| **UNKNOWN** | No primary source, or sources conflict. |

Secondary press (Hacker News, Reddit, The Hacker News) is cited only as *context for the July 2026 repo-upload incident*, never as load-bearing fact.

---

## 1. Session sync

### Does the CLI upload/sync session history, summaries, or metadata?

**DOCUMENTED — yes, by design.**

Open-source client (`session_registry_client.rs`) is titled:

> REST client for the session replicas registry (cli-chat-proxy). Handles registering, updating, finalizing, searching, and downloading session replicas for **cross-host session replication**.

Source: https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-shell/src/agent/session_registry_client.rs

On register, the client POSTs to `{proxy}/sessions/register`:

| Field | What it is |
| --- | --- |
| `sessionId` | UUIDv7 |
| `cwd` | Absolute working directory (Windows paths included) |
| `gcsTracePrefix` | GCS object prefix for traces / restore artifacts |
| `modelId` | Model id |
| `repoRemoteUrl`, `repoBranch`, `repoHeadAtStart` | Git identity |
| `hostname` | Machine hostname |
| `deviceId` | Per-machine id from telemetry `agent_id()` — this is `~/.grok/agent_id` |
| `parentSessionId` | Fork/restore parent |
| Subagent fields | kind / type / persona / role / depth |

Updates POST `{proxy}/sessions/{id}/replicas/update` with `summary` (title), `firstPrompt`, `lastTurnNumber`, `repoHeadAtEnd`, `restorableTurnNumber`.

Downloads GET `{proxy}/sessions/{id}/download?file=&turn=` and receive a **signed GCS URL**. The client comment says archives “can be hundreds of MB.”

Enterprise network table (**DOCUMENTED**):

| Host | Purpose | If blocked |
| --- | --- | --- |
| `cli-chat-proxy.grok.com` | Inference proxy, settings | Core broken |
| `code.grok.com` | **Remote session sync, sharing, WebSocket relay** | **Sessions stay local-only; share links unavailable** |

Source: https://docs.x.ai/build/enterprise

Shipped user guide 1.0.3 (**DOCUMENTED**, local copy of what docs.x.ai/build/features/sessions also publishes in weaker form):

- “`grok sessions list` … source status”
- “`grok sessions search` combines a local SQLite index with **remote results**”

Source: `~/.grok/docs/user-guide/17-sessions.md` and https://docs.x.ai/build/features/sessions (the public page omits the “remote results” sentence).

Changelog 1.0.1 (**DOCUMENTED**): “preserves manual titles **across machines**.”  
Source: `~/.grok/CHANGELOG.md` / https://github.com/xai-org/grok-build (synced changelog).

CLI `--help` (**DOCUMENTED / OBSERVED**):

```
--restore-code
  Restore the original session's repository snapshot when resuming.
  Remote sessions require --worktree (never checks out into the current
  directory). Without this flag, resume restores conversation only.
```

That sentence only makes sense if **full conversation content** (and optionally a codebase snapshot) is stored server-side.

### Unified history with grok.com / desktop / mobile?

**DOCUMENTED: no such claim for consumer grok.com chat.**  
Consumer FAQ is scoped to “Grok mobile app or the Grok.com website” and describes History there. It does not mention the CLI.  
https://x.ai/legal/faq

**DOCUMENTED: grok.com Build mode is a different, retained surface.**  
“chats and build sessions are retained for product functionality… Private Chats … are not available for Build mode.”  
https://docs.x.ai/developers/faq/security#grokcom-build-mode

**UNKNOWN:** whether the Grok **macOS desktop app** (consumer) embeds the same session registry. Terminal-support docs mention “Grok Desktop” as a terminal brand; Grok Bot docs describe a separate desktop product with a cloud computer. No primary source says “CLI sessions appear in the Grok macOS app’s chat list.”

**INFERRED:** CLI-to-CLI is the documented cross-device path. CLI-to-grok.com-History is not.

### `grok sessions list` STATUS values

**DOCUMENTED** in merge.rs:

> Where this entry came from: `"local"`, `"remote"`, or `"both"`.

Source: https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-shell/src/session/merge.rs

| STATUS | Meaning |
| --- | --- |
| `local` | Present only in `~/.grok/sessions/` on this machine |
| `remote` | Present only in the account session registry (not on this disk) |
| `both` | Same session id exists locally **and** in the registry (remote title wins on collision) |

Server-side replica records use a different field (`status: "active"` in the wire tests). The **column you see** is the merge `source`, not the server enum.

**OBSERVED** in this scratchpad (not a git repo):

```
SESSION ID                            CREATED     UPDATED     STATUS  SUMMARY
019ffc2f-…ee12                        2026-08-13  2026-08-13  local   Grok CLI Session Sync Privacy Recon Report
019f4de9-…9911                        2026-07-10  2026-07-11  remote  Recover Memory Sessions Train Malmo Tools at 0.5
019f4c1c-…741e1                       2026-07-10  2026-07-10  remote  Recovering Figlyph Sessions: Failed 3.7 Flash Pi D
019f492b-…cdde                        2026-07-09  2026-07-10  remote  Explore Figlyph Projects App and Database Structur
```

The three `remote` ids are **absent** from `~/.grok/sessions/**/summary.json` on this Windows machine.

**INFERRED / OBSERVED filter behavior:** `grok sessions list` uses `CwdScope::WithSiblings`. Remote rows are filtered by **normalized git remote URL**, not by cwd (cwd differs across machines). If the current directory has **no git remotes**, `local_repo_urls` is empty and **all account remotes pass through**. That is why Figlyph sessions appear in this Temp scratchpad. Source: `merge.rs` (`remote_no_repo_urls_passes_all_remotes_through` test).

The original “every session is `local`” observation is cwd-dependent. In a real git checkout that matches only local remotes, you mostly see `local`/`both`. In a non-repo directory, you see the whole account.

---

## 2. What is visible cross-device

### Full content or titles only?

**Both, at different layers.**

| Layer | What the other device can see | Evidence |
| --- | --- | --- |
| `grok sessions list` | Title/summary, dates, STATUS, session id. Remote rows also carry `firstPrompt`, `cwd`, `hostname`, `modelId` on the wire | **DOCUMENTED** `SessionRecord` + **OBSERVED** list |
| `grok sessions search` | Local FTS over titles **and prompts**; remote hits print `(remote)` + first 80 chars of `firstPrompt` | **DOCUMENTED** `sessions_cmd.rs` |
| `grok --resume <remote-id>` | **Conversation restored** (“conversation is restored either way”) | **DOCUMENTED** `--help` / `--worktree` help |
| `grok --resume <remote-id> --restore-code --worktree` | Conversation **plus** snapshot codebase | **DOCUMENTED** `--restore-code` |
| GCS download | Named files per turn via signed URL; “hundreds of MB” | **DOCUMENTED** `download_file` |

So: the *list UI* is metadata. The *resume path* is full conversation. The *restore-code path* is a repo snapshot. That is strictly more than “titles leaked.”

### Where on macOS would Windows CLI sessions surface?

| Surface | Likelihood | Basis |
| --- | --- | --- |
| `grok sessions list` / `search` / `/resume` on the Mac CLI | **High — this is the designed surface** | **DOCUMENTED** merge + enterprise `code.grok.com` + inverse OBSERVED here |
| Grok macOS app chat History | **UNKNOWN** (no primary source). Do not assume Codex-on-chatgpt.com behavior. | Consumer FAQ is grok.com/mobile only |
| grok.com History | **UNKNOWN / unlikely as documented** | Same |
| grok.com **Build mode** | **Plausible but not proven** for *CLI* sessions. Build mode retains its own sessions. | https://docs.x.ai/developers/faq/security#grokcom-build-mode |
| `/share` URL | Only if someone ran `/share` | **DOCUMENTED** https://docs.x.ai/build/modes-and-commands |

**INFERRED explanation of the owner’s Mac sighting (most likely first):** they opened the Grok CLI (or a Grok Build UI that calls `x.ai/session/list`) on the Mac while logged into the same xAI account. `fetch_merged` pulled registry rows. If they were not inside the same git remote, they saw Windows titles/cwd/hostnames as `remote`. Resume would pull the transcript.

If they only opened the consumer Grok macOS app / grok.com chat, **that sighting is not explained by any documented mechanism** — list the undocumented alternatives at the end.

---

## 3. Retention & training

### Three regimes (do not mix them)

| Regime | Training | Retention | Source |
| --- | --- | --- | --- |
| **Consumer grok.com / mobile** | Default: used for training unless you turn off “Improve the model.” Private Chat: not used for training; deleted in 30 days. | History kept until you delete; deletion within 30 days | https://x.ai/legal/faq · https://x.ai/legal/privacy-policy |
| **xAI API** | “xAI **never trains** on your API inputs or outputs without your explicit permission.” | Encrypted 30-day abuse store, then delete. Team ZDR: never persisted to disk | https://docs.x.ai/developers/faq/security |
| **Grok Build CLI** | First-run screen + `/privacy` “Coding data, retention, and training.” Opt-in grants retain+train on “prompts, traces, & metrics.” Opt-out: “We may still collect simple user metrics.” | Without ZDR, code/trace can be retained. With ZDR: “no trace or code data is retained.” `/privacy` opt-out is claimed to **delete previously synced data** | https://docs.x.ai/developers/faq/security#grok-build-cli · https://x.com/SpaceXAI/status/2076692402442846289 |

The consumer Privacy Policy **explicitly does not apply** to “data that we process on behalf of customers of our business offerings, such as the xAI API.”  
https://x.ai/legal/privacy-policy

The CLI sits in the crack: OIDC consumer login (this machine) talking to the **Build / cli-chat-proxy** stack, with a *separate* coding-data toggle.

### This account

**OBSERVED:** `coding_data_retention_opt_out = true`. Training on CLI coding data should be off *if* the server honors the flag. That flag is **not** the same as “do not replicate sessions.” Source comments: `/privacy` “doesn't change `[features] telemetry`, `trace_upload`, or your external OTEL settings.”  
https://docs.x.ai/build/cli (slash `/privacy` in local `04-slash-commands.md`)

### Enterprise / ZDR

**DOCUMENTED:**

- Team-level. Console → Team Settings → Zero Data Retention.  
  https://docs.x.ai/developers/faq/security#how-to-enable-zdr
- CLI with ZDR: “no trace or code data is retained.”
- `sessions_cmd.rs`: “ZDR teams never upload, so there is nothing remote to delete.” Relay sync string in the binary: `ZDR team: skipping relay sync`.
- Video tools under ZDR need user-supplied output storage.  
  https://docs.x.ai/build/settings/zdr-video-storage
- Official @SpaceXAI (2026-07-13): “For teams using zero data retention, no trace and code data is ever retained. All API key use of Grok Build also respects ZDR. If ZDR is disabled, the `/privacy` command … disable data retention, **which also deletes previously synced data**.”  
  https://x.com/SpaceXAI/status/2076692402442846289

This login has a `team_id` but **no ZDR flag** in `auth.json`. Treat as **non-ZDR consumer/team**. On team accounts, only an admin can flip coding-data sharing (`04-slash-commands.md`).

### July 2026 repo-upload incident (context, not a new claim)

Independent researchers (July 2026) wire-captured Grok Build uploading a full git bundle (history + unread files) to xAI GCS, independent of “Improve the model.” xAI’s *primary* response is the tweet above plus later open-sourcing (`https://github.com/xai-org/grok-build`, `https://x.ai/open-source`). Whether codebase upload is still on for this account is a **server remote-settings** question (`disable_codebase_upload`). The code path still exists.

---

## 4. Disclosure

### First-run privacy banner (actual text)

**OBSERVED** in `grok.exe` 1.0.3 strings (not a paraphrase):

> Help improve Grok  
> [Opt out] [Opt in]  
> Terms and Privacy Policy

Links resolved from the same binary: https://x.ai/legal/terms-of-service · https://x.ai/legal/privacy-policy

Settings row that `/privacy` opens (**DOCUMENTED** source):

> **Coding data, retention, and training**  
> Opt-in to provide SpaceXAI the ability to retain and train on coding data, e.g., prompts, traces, & metrics, for training and debugging purposes. We may still collect simple user metrics, e.g. how many times you use the product or a feature.

Source: https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/src/settings/defs.rs

Default in that file: local default is **opt-out** (`coding_data_retention_opt_out = true`), “safer consumer default; **server enrichment may still opt the user in**.”

This machine: banner acked 2026-08-12; auth flag is opted out.

### Is cross-device session sync disclosed user-visibly?

| Place | Mentions session replication? |
| --- | --- |
| First-run banner | **No** |
| `/privacy` copy | **No** (training/retention of coding data) |
| https://docs.x.ai/build/features/sessions | **No** (local disk story only) |
| Local `17-sessions.md` | Partial (“source status”, “remote results”) |
| `grok --help` `--restore-code` | **Yes**, if you read flags |
| Changelog 1.0.1 “across machines” | **Yes**, one line, titles only |
| https://docs.x.ai/build/enterprise | **Yes**, but it is an enterprise firewall table |
| Open source `session_registry_client.rs` | **Yes**, explicit |

**Blunt:** syncing session metadata, first prompts, cwd, hostname, and restorable conversation/code snapshots to the account is **on by remote settings / product design** and is **not** what the first-run banner describes. Calling that “undisclosed” is fair for a normal user. Calling it “secret” is not — it is in `--help`, enterprise docs, and the public repo. It is **quietly documented in the wrong places**.

---

## 5. Opt-outs (practical)

Independent knobs. Turning one off does not turn the others off.

### (a) Disable session sync / upload

**This does not break `-c`, `--session-id`, `--resume` of *local* sessions.** Those read `~/.grok/sessions/`.

1. **Hard local override** (beats remote settings):

```toml
# ~/.grok/config.toml
[cli]
session_registry = false
```

or:

```powershell
$env:GROK_SESSION_REGISTRY = "0"   # also: false / off
```

Precedence **DOCUMENTED** (`util/config/mcp.rs`): env → `[cli] session_registry` → remote `/v1/settings` `session_registry_enabled` → **default disabled**.

2. **Stop workspace / codebase snapshot upload** (separate from the replica index):

```toml
[harness]
disable_workspace_teleport = true
disable_codebase_upload = true
```

3. **Network (enterprise):** blocking `code.grok.com` → “Sessions stay local-only; share links unavailable.”  
   **Caveat (INFERRED):** the replica REST client talks to **`cli-chat-proxy.grok.com`**, which you cannot block without killing inference. So `session_registry = false` is the real upload kill switch. Blocking `code.grok.com` kills teleport/share/WS, not necessarily `/v1/sessions/*`.

4. **ZDR** (team admin, Console): stops upload entirely. Breaks features that need xAI-side storage (see security FAQ).

**Note:** `grok sessions list` / `search` **still query remote** even when register hooks are off (`sessions_cmd.rs` always builds a registry client). You will still *see* old remotes until they are deleted. You will not *create* new ones if hooks are off.

### (b) Disable telemetry

```toml
[features]
telemetry = false

[telemetry]
trace_upload = false
mixpanel_enabled = false
```

Env: `GROK_TELEMETRY_ENABLED=0`, `GROK_TELEMETRY_TRACE_UPLOAD=0`, `GROK_TELEMETRY_MIXPANEL_ENABLED=0`.

`/privacy` **does not** touch these.  
https://docs.x.ai/build/settings (local `05-configuration.md` / `24-monitoring-usage.md`)

`grok trace <id>` **uploads by default**; pass `--local` to skip.

External OTEL (`GROK_EXTERNAL_OTEL`) is off unless you double-opt-in. Irrelevant here.

### (c) Exclude data from training

1. In the TUI: `/privacy` → **Opt out**.  
2. grok.com: Settings → Data → uncheck “Improve the model.”  
   https://x.ai/legal/faq  
3. Mobile: Settings → Data Controls → uncheck “Improve the model.”  
4. Team: admin only; ZDR freezes the row.

This machine already has `coding_data_retention_opt_out = true`.

**INFERRED gap:** opt-out of *training* ≠ opt-out of *session registry*. Official tweet claims `/privacy` “deletes previously synced data.” That is xAI’s word. We did not observe a live delete.

### (d) Delete server-side history

`grok sessions delete <id>` (**DOCUMENTED** in `sessions_cmd.rs`):

- Always deletes **local** history for that id (any cwd).
- **Also attempts remote delete** when authenticated **and not ZDR**.
- Backend 404 is treated as success (idempotent).
- Help text only says “Permanently delete a session from history” — it does not say “and the cloud copy.”

`/delete` in the TUI is the same persistence path (changelog: “Deleting a session now properly stops … before wiping history”).

There is **no** documented “delete all remote CLI sessions” command. Per-id only. Official `/privacy` opt-out is the claimed bulk wipe.

Consumer grok.com History delete does **not** document any effect on CLI replicas.

---

## 6. Our exposure assessment

### Secrets in our prompts?

**OBSERVED:** ripgrep over `~/.grok/sessions/**/chat_history.jsonl` for `sk-…`, `xai-…`, `ghp_…`, `AKIA…`, PEM private keys, and `password=` / `api_key=` string literals did **not** surface live credentials. Hits were code *about* secret-stripping and unrelated URLs. This is a pattern scan, not a formal DLP pass.

What **is** in prompts (and therefore in every inference request, and in any replica that was uploaded): **absolute Windows paths**, **model names**, **research findings**, **project/code structure**. That is enough to map what this account is working on.

### What xAI has server-side from our usage

Assume non-ZDR, OIDC personal/team login, CLI traffic through `cli-chat-proxy.grok.com`.

| Data | Almost certainly on xAI right now | Why |
| --- | --- | --- |
| Every prompt + tool result + model output of every turn | **Yes (inference path)** | That is how the product works. TLS to `cli-chat-proxy.grok.com`. |
| 30-day API-style audit copy of those requests | **Likely** if the CLI path is treated like API; **UNKNOWN** if consumer OIDC gets a different store | API default is 30-day encrypted audit (security FAQ). CLI is not explicitly given a number. |
| Training use of those prompts | **Should be No** for this account | `coding_data_retention_opt_out = true`. Official API line is “never trains without permission.” |
| Session registry rows (id, title, first prompt, cwd, hostname, device id, git remote, turn counts) | **Yes for at least the July Figlyph sessions** (we pulled them). **Uncertain for this Windows session** (`STATUS=local`, not `both`) | **OBSERVED** + **DOCUMENTED** |
| Full conversation blobs / GCS restore archives | **Yes if** the session was finalized with hooks on. July sessions were uploaded in the default-on era. Current hooks: remote-settings-dependent | **DOCUMENTED** download API |
| Workspace teleport / git-bundle snapshots | **Historically yes (July 2026).** **Now:** server can force `disable_codebase_upload`. Local default after the incident is unclear without dumping `/v1/settings`. | Official tweet + remaining code path |
| Mixpanel product analytics | **Only if telemetry is on.** Local config does not set it; sample docs show `telemetry = false` as the example. **UNKNOWN** live default without a network capture. | `05-configuration.md` |
| `~/.grok/memory/**` experimental memory | Local unless a “memory upload” hook fired (`session_registry_enabled` comment: “register, update, finalize, **memory upload**”) | **DOCUMENTED** remote-settings comment |
| `active_sessions.json`, `leader.sock` | **Local only** | Process coordination on one machine |

**This session (`019ffc2f-…`) listing as `local`:** INFERRED that register hooks are currently off *or* have not succeeded. That does **not** erase the inference-path copy of every prompt we just sent.

### Minimal lockdown that keeps `-c` / `--session-id` / agents working

Do this. Do not enable ZDR unless a team admin decides the feature loss is acceptable.

```toml
# ~/.grok/config.toml  — add; do not remove existing [ui]/[plugins]/[mcp_servers]

[cli]
session_registry = false          # stop replica register/update/finalize

[features]
telemetry = false

[telemetry]
trace_upload = false
mixpanel_enabled = false

[harness]
disable_workspace_teleport = true
disable_codebase_upload = true
```

Optional belt:

```powershell
[System.Environment]::SetEnvironmentVariable("GROK_SESSION_REGISTRY","0","User")
[System.Environment]::SetEnvironmentVariable("GROK_TELEMETRY_ENABLED","0","User")
[System.Environment]::SetEnvironmentVariable("GROK_TELEMETRY_TRACE_UPLOAD","0","User")
```

Already done, keep it:

- `/privacy` → Opt out (auth.json already `true`).
- Do not run `grok trace <id>` without `--local`.
- Do not run `/share`.

Then, if you want the July remote ghosts gone:

```
grok sessions delete 019f4de9-2698-7130-bb4b-692c656a9911
grok sessions delete 019f4c1c-9648-7811-95da-c6fcacd741e1
grok sessions delete 019f492b-8186-7af1-a580-80d5876dcdde
```

(Those ids are remote-only here; delete still hits the registry.)

**What this does not do:** stop xAI seeing prompts on the live inference channel. There is no local toggle for “don’t send the prompt to the model.” That’s the product.

**What this does not break:** local session files, `-c`, `-r`/`--resume` of local ids, `--session-id` for new sessions, subagents, leader socket, memory-on-disk.

---

## If the Mac sighting is *not* the CLI list

If the owner is sure they never ran `grok` / Grok Build on the Mac and only opened the consumer Grok app or grok.com, the documented CLI registry does not explain it. Remaining **undocumented / unproven** channels:

1. Consumer Grok macOS app silently sharing the Build session registry (no primary source).
2. grok.com Build mode ingesting CLI sessions under the same account (documented as retaining *its own* build sessions, not CLI replicas).
3. Account activity / “devices” UI showing CLI launches without transcripts (UNKNOWN).
4. Shared iCloud/`~/.grok` is **impossible** across Windows ↔ Mac unless they also sync that folder themselves. `active_sessions.json` is local pid/cwd.
5. The owner saw *titles* that originated on the Mac, reflected back (what we just reproduced), and attributed the wrong direction.

---

## Primary sources

| Claim area | URL |
| --- | --- |
| Sessions (public, local-disk framing) | https://docs.x.ai/build/features/sessions |
| Enterprise network + `code.grok.com` sync | https://docs.x.ai/build/enterprise |
| CLI `/privacy`, ZDR, first-run screen, grok.com Build mode | https://docs.x.ai/developers/faq/security |
| How to enable ZDR | https://docs.x.ai/developers/faq/security#how-to-enable-zdr |
| `/share`, `/privacy` command list | https://docs.x.ai/build/modes-and-commands |
| CLI reference | https://docs.x.ai/build/cli/reference |
| Settings / env reference | https://docs.x.ai/build/settings/reference |
| Consumer training / history / delete | https://x.ai/legal/faq |
| Consumer privacy policy (excludes API) | https://x.ai/legal/privacy-policy |
| Official /privacy deletes synced data | https://x.com/SpaceXAI/status/2076692402442846289 |
| Open-source CLI | https://github.com/xai-org/grok-build |
| Session registry client | https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-shell/src/agent/session_registry_client.rs |
| Merge / STATUS values | https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-shell/src/session/merge.rs |
| `grok sessions` list/search/delete | https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/src/sessions_cmd.rs |
| Privacy settings copy | https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/src/settings/defs.rs |
| `GROK_SESSION_REGISTRY` / `[cli] session_registry` | https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-shell/src/util/config/mcp.rs |
| Install / product | https://docs.x.ai/build/overview · https://x.ai/cli/install.ps1 |

Shipped-with-binary copies used as ground truth for 1.0.3: `~/.grok/docs/user-guide/{02,04,05,17,24}-*.md`, `~/.grok/CHANGELOG.md`, `~/.grok/config.toml`, `~/.grok/auth.json` (non-secret fields only), live `grok sessions list` / `grok --help`.

---

DONE
