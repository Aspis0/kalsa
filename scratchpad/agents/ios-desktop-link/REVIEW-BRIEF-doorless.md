# Max-recall review brief: doorless iroh pairing + remote use (2026-10-03)

READ-ONLY, critique only (do not fix; the only write is your own review file). Be hostile. Find everything wrong.
This is the ONE review this work gets (owner rule), so recall matters - but rank every finding:
P0 = security/privacy leak, crash, data loss, regression of a shipping Android flow; P1 = wrong behaviour a user
hits; P2 = could affect app/users/performance; P3 = everything else.

Subject: Kalsa phone app (Android ships; iOS builds). Worktree ~/Projects/kalsa-node22, local branch
pairing/iroh-no-door: two commits on app main 1d51f196 (main has since moved to c7bee6db, unrelated file):
- daab9f2f: a desktop invite carrying an iroh `node` pairs with NO saved door address (claim/complete over the iroh
  `desk` lane; record saved with doorUrl "" + {node, pairedVia:"iroh"}; /props probe over the iroh door road with
  request-line Host `iroh.kalsa.invalid` = IROH_TUNNEL_URL in src/pairing/pairingUrls.ts).
- 3d0b07d0: every post-pair remote path (probe /props /v1/models /health, chat turn, room API + room event stream)
  resolves its request base via src/engine/remote/doorRequestBase.ts: saved URL if non-empty, else IROH_TUNNEL_URL
  when the record came from pairing and the iroh road is chosen, else a new `remote_brain_iroh_missing` error.
Owner/desktop contract (kalsa-brain): normal users scan/tap and iroh does the rest; a door URL is advanced only;
the invite's `reachable` (127.0.0.1) is signed as scanned and never dialed or stored. Context:
`PAIRING-VALIDATE-DIAG.md` in this folder. Review `git -C ~/Projects/kalsa-node22 diff origin/main...HEAD`.

Trace across files end to end: invite open (deep link / paste / QR) -> PairingScreen run() -> chooseRoad ->
pairingDeskFetch -> claim/complete -> saved record -> RemoteEngine probe/turn -> road.ts -> iroh tunnel; and room.
Your angle is in your prompt; cover it fully and report any P0/P1 you see elsewhere. Quote the line you read for every
finding (file:line + text); CONFIRMED / PLAUSIBLE / REFUTED. `export PATH=/opt/homebrew/opt/node@22/bin:$PATH`;
targeted jest only, `| tail -5`, real exit codes. Leave the worktree exactly as found (verify with git status).
