# Jelly document-chat functional test — 2026-09-09

Device: physical Jelly Star, Android 13, USB JELLYS0000053795 only; app main@332aeed, debuggable, LFM2.5-2.6B-QAD-Q4_0. The keep-awake helper was active for the complete run and restored its settings afterward.

## Test material and import

- SMALL: 1 page, 270 words/1,955 chars, SHA-256 eae977be…bb9fa4; verified text layer. Facts: 22 September 2026, €1,860, Marta Bellini, third floor, deadline 11 September.
- LARGE: source 40 pages, 15,570 words/106,619 chars, SHA-256 9b1c9af4…0a6c4f8d; text layer verified. Buried facts: AXR-7Q4-031 p.3, 42.6 N·m p.17, QX9-YYWW-NNNN p.31.
- Both pushed to /sdcard/Download/; MediaStore IDs were 1000000705/0706. cmd media returned rc=20 (“Can't find service: media”).
- Explicit SEND with content://media/external/file/1000000705 and file:///sdcard/Download/... returned rc=0 but imported neither file. Picker fallback worked; UI dump/tap evidence is retained under import-small/picker and import-large/picker.
- App-side records: SMALL docCount=1,pageCount=1,estimatedTokens=489,extractionStatus=ok; LARGE docCount=5,pageCount=5,estimatedTokens=3362,extractionStatus=ok. PDF bridge logged successful extraction.
- At ctxTokens=16384, both imported records route full_context (<8192); the intended LARGE retrieval path was not reached. The source LARGE facts beyond page 5 were discarded.

## Scenario results

| Scenario | Result | Evidence and timing |
|---|---|---|
| 1 SMALL, two facts | PASS | Reply: “martedì 22 settembre 2026 … 1.860 euro” with source small_condominium_notice_it.pdf. Full-context injection: KALSA_TELEMETRY tool=document_chat strategy=full_context executed=0; 4.16 tok/s. First visible ~18 s; valid completion ~199 s. RSS HWM 2,651,780 kB; thermal status max 3, battery 36.0°C; no chat error. |
| 2 SMALL, absent fact | FAIL | Final persisted text contains “Documento non trovato in libreria (id=small_condominium_notice_it)” and ends as interrupted reasoning; it never clearly answered that the phone number was absent. Tool executed; 3.87 tok/s. Prefix visible/completion marker 161.5/161.6 s, but no valid completion. RSS HWM 2,667,088 kB; thermal 3, 38.0°C; error text reached chat. |
| 3a LARGE p.3 | FAIL/PARTIAL | No AXR-7Q4-031 or citation. Reply says the document is “a truncated version of the manual” and loops. Telemetry: full_context, executed=1, 2.97 tok/s; no BM25/hybrid/chunk count. First useful text <=388 s; no valid completion. RSS HWM 2,659,012 kB; thermal 3, 39.0°C. |
| 3b LARGE p.17 | FAIL | No 42.6 N·m or citation; reply ends “Let me use document_chat…”. Tool executed; 2.74 tok/s; strategy field absent in this log line, but routing was full_context by the stored estimate. First useful text <=415 s; no valid completion. RSS HWM 2,658,776 kB; thermal 3, 40.0°C. |
| 3c LARGE p.31 | FAIL | No QX9-YYWW-NNNN or citation; reply is an interrupted search loop. Tool executed; 2.64 tok/s; no retrieval/chunk telemetry. First useful text <=148 s; later round interrupted. RSS HWM 2,650,792 kB; thermal 3, 40.0°C. |
| 4 same-chat torque follow-up | FAIL | Reply hallucinated “The torque value … was 1.860 euro”, then admitted the documents had no torque data. Telemetry 2.46 tok/s; first visible ~500 s, telemetry ~710 s; no valid completion. RSS HWM 2,670,344 kB; thermal 3, 40.0°C; hallucinated answer reached chat. |
| 5 force-stop/relaunch | FAIL/PARTIAL | Force-stop/relaunch succeeded; library survived, but the active attachment had to be reselected (XML evidence retained). Reply sees “large_asterion_manual_en.pdf (5 pages)” and loops without the product code. Telemetry: full_context, executed=1, 2.36 tok/s, promptMs 563,981 ms; first visible ~3 min, telemetry ~687 s; no valid completion. RSS HWM 2,426,968 kB; thermal 3, 40.0°C. |

Every reply is saved verbatim under JELLY-DOCCHAT-2026-09-09/replies/; logcat excerpts, probe samples, PDFs, hashes, and import details are in the same artifact directory.

## Top defects

1. PDF import hard-caps every document at five pages: src/util/pdfBridgeProtocol.ts:28 (MAX_PDF_PAGES=5). This made the 40-page test record only five pages and made p.17/p.31 impossible.
2. Android SEND filters are malformed: android/app/src/main/AndroidManifest.xml:36-43 uses android.intent.action.android.intent.action.SEND and a duplicated category prefix. Both explicit SEND variants returned rc=0 but did not import.
3. Document selection requires exact library IDs: src/documents/documentChatTool.ts:1206-1211 matches d.id only. The model repeatedly supplied the filename stem small_condominium_notice_it, causing “document not found”; combined with DocumentLibrary.ts:311-334, the capped LARGE stayed full-context instead of retrieval.

Could not validate BM25/hybrid retrieval, chunk counts, or citations because the shipped import cap routed the imported LARGE to full-context and the tool/model repeatedly interrupted. No git changes, commit, or push was made.

