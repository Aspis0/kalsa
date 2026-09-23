# Does `.metadata_never_index` inside a folder stop Spotlight indexing it?

Bounded experiment, `/tmp` only, no installs, no sudo, no config changes.
Host: macOS 26.6.2 (25G83). Probe timestamp `1790131645`.

## Verdict: INCONCLUSIVE

Neither the marker tree (A) nor the control tree (B) was found in the index, so the A-vs-B
comparison the question needs produced no signal. The reason is visible in the controls:
`/tmp` itself is not indexed at all, so a marker inside `/tmp` cannot be the cause of A's
absence. Per the pre-agreed rule, this is reported as inconclusive, not as "works" or
"doesn't work".

## Setup

```
$ mkdir -p /tmp/sp-idx-test-A /tmp/sp-idx-test-B
$ touch /tmp/sp-idx-test-A/.metadata_never_index
# A: /tmp/sp-idx-test-A/kalsa-spotlight-probe-1790131645.txt  (82 bytes)
# B: /tmp/sp-idx-test-B/kalsa-spotlight-probe-1790131645.txt  (77 bytes, no marker)

$ ls -la /tmp/sp-idx-test-A /tmp/sp-idx-test-B
/tmp/sp-idx-test-A:
total 8
drwxr-xr-x     4 marco  wheel     128 Sep 22 22:47 .
drwxrwxrwt  6051 root   wheel  193632 Sep 22 22:47 ..
-rw-r--r--     1 marco  wheel       0 Sep 22 22:47 .metadata_never_index
-rw-r--r--     1 marco  wheel      82 Sep 22 22:47 kalsa-spotlight-probe-1790131645.txt

/tmp/sp-idx-test-B:
total 8
drwxr-xr-x     3 marco  wheel      96 Sep 22 22:47 .
drwxrwxrwt  6051 root   wheel  193632 Sep 22 22:47 ..
-rw-r--r--     1 marco  wheel      77 Sep 22 22:47 kalsa-spotlight-probe-1790131645.txt
```

Waited ~4.5 minutes total (no way to force indexing; checked at t+2 min and t+4.5 min,
identical results).

## Index queries (final round, t+~4.5 min)

```
$ mdfind -name 'kalsa-spotlight-probe-1790131645'
(no output, exit=1)

$ mdfind "kMDItemFSName == 'kalsa-spotlight-probe-1790131645.txt'"
(no output)

$ mdfind "kMDItemFSName == '*kalsa-spotlight-probe*'"
(no output)

$ mdls /tmp/sp-idx-test-A/kalsa-spotlight-probe-1790131645.txt
kMDItemFSContentChangeDate = 2026-09-23 02:47:25 +0000
kMDItemFSCreationDate      = 2026-09-23 02:47:25 +0000
kMDItemFSName              = "kalsa-spotlight-probe-1790131645.txt"
kMDItemFSNodeCount         = 82
kMDItemFSSize              = 82
... (kMDItemFSCreatorCode/Invisible/Label etc. only)

$ mdls /tmp/sp-idx-test-B/kalsa-spotlight-probe-1790131645.txt
... identical shape, FSSize/NodeCount = 77 ...
```

Both files show only the `kMDItemFS*` group. Neither shows `kMDItemContentType`,
`kMDItemDisplayName`, or `kMDItemTextContent` - i.e. no imported metadata, no content
extraction, for A **and** B alike. A and B are indistinguishable.

```
$ mdutil -s /
/:
	Indexing enabled.
$ mdutil -s /System/Volumes/Data:
/System/Volumes/Data:
	Indexing enabled.
```

## Controls: why "neither found" is a `/tmp` property, not the marker

```
# Pre-existing /tmp files, never touched by this test:
$ mdfind -name '621-bw-out'
(no output)
$ mdfind "kMDItemFSName == 'AdvancedPanel.tsx.bak'"
(no output)
$ mdfind -onlyin /tmp "kMDItemFSName == '*'"
(no output)
$ mdfind -onlyin /private/tmp "kMDItemFSName == '*'"
(no output)
```

Zero hits for *any* file under `/tmp` or `/private/tmp`, including files days old.
The index itself answers queries and is fresh:

```
$ mdfind -name 'independent-build.log'
/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/phone-line-audit/independent-build.log
```

(that file is <24 h old), and `mdfind -onlyin .../kalsa-moe-experiments ... 'REPORT.md'`
returns hits. So the index works, is current, and simply does not cover `/tmp`. The
experiment therefore cannot separate A from B.

## Supported routes on this macOS version (inspected, not modified)

- `mdutil -h` is not a valid option (`mdutil: invalid option -- h`). Usage shows
  **volume-level** controls only: `-i on|off`, `-d`, `-E`, `-s`, `-a`, `-V`, `-t`, `-p`,
  `-r plugins`, `-L`, `-P`, `-X`. **No per-path/per-folder exclusion exists in `mdutil`.**
- `/System/Volumes/Data/.Spotlight-V100/` -> `ls: Operation not permitted`.
  `VolumeConfiguration.plist` -> `Permission denied` / "couldn't be opened because you
  don't have permission". `mdutil -P /System/Volumes/Data` -> `Must be root to run this
  command`. Same for `mdutil -L`. So the exclusion plist exists but is **not readable
  without sudo**, and was not read or written.
- Documented per-folder mechanisms (external sources, not tested here): the graphical
  **System Settings > Spotlight/Privacy** list (the supported route), renaming the folder
  to a `*.noindex` extension, and `.metadata_never_index` at a **volume root**. Community
  and Eclectic Light sources state the in-folder `.metadata_never_index` stopped working
  in recent macOS - consistent with our null result, but our test does not prove it.

## Advice for the owner

1. Do **not** rely on a `.metadata_never_index` file dropped into
   `kalsa-brain/target`, `kalsallama/build`, or `kalsa/node_modules`. Treat it as an
   unproven lever for folders; this test supplied no evidence for it.
2. The only supported automatic-per-folder route on this machine is the **graphical
   Privacy list** (System Settings -> Spotlight -> Privacy, drag the folder in). It has no
   CLI; `mdutil` cannot do it and the plist cannot even be read without sudo.
3. A real automatic route also exists at the **volume root** (`.metadata_never_index` on a
   volume) - irrelevant here, since these folders live on the boot volume.
4. Optional, cheap, supported: renaming a build dir to `foo.noindex` excludes it, but
   changes paths in build configs - only worth it if the owner accepts that trade.

## What this test does NOT cover

- It says nothing about whether the marker works in an **indexed** directory: the whole
  contrast was blocked by `/tmp` being outside the index. Settling the question needs the
  same A/B pair created inside a known-indexed tree (e.g. a scratch dir under
  `~/Projects`, outside any `target`/`build`/`node_modules`), then the same `mdfind`
  queries. That was out of scope here (touch `/tmp` only).
- It does not test the Privacy list, `*.noindex` renames, or volume-root markers.
- It covers one macOS build (26.6.2), one 4.5-minute window, one machine.
- `mds` load contribution and the three hot directories were not re-measured.

## Cleanup

```
$ rm -rf /tmp/sp-idx-test-A /tmp/sp-idx-test-B
$ ls -d /tmp/sp-idx-test-*
ls: /tmp/sp-idx-test-*: No such file or directory
```

Both scratch trees are gone.
