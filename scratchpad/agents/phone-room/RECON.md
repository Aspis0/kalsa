# Phone Room v1 recon (luna 9f61a7d6, 2026-10-04) - summary kept for the coder brief

Contract (kalsa-brain docs/ROOM-PROTOCOL.md): members join by the owner's Allow (no join endpoint); `info` gives
room_id, `you`, members (host/phone/ai), AI status (55-83); naming optional via PUT /kalsa/room/name, 1-40 UTF-8 bytes,
refusals name_taken / name_reserved / name_framing / name_mixed_scripts / name_too_long with owner-approved copy in
kalsa-brain chat/src/i18n/en/room.ts:90-95 (+ it/room.ts); history oldest-first, after/before, limit 1-200, only
post-join (85-120); SSE message/ai_message (numbered) + member/ai_status/ai_delta, Last-Event-ID, ping <=15 s
(381-456); epoch change -> drop + refetch (364-376); posts carry client id (idempotent), ack seq/time/ai_call/refusal
(124-164); call Kalsa = call_ai:true or @Kalsa (166-193); removal = empty 401 (44-49); text 1-8000 B, body 16 KiB.

Phone today (src/room): roomApi fetchRoomInfo/fetchRoomHistory/postRoomMessage/putRoomName (247-321, info binds
roomId to the pairing record); roomStream/roomStreamDispatch (events, dedupe, resume floor); roomQueue/roomQueueStore
(persisted FIFO, 200 cap, queued/sending/failed); callsKalsa, roomBounds, roomEpochs, roomSubscriptions (callbacks,
no UI store); roomAppState.bindRoomStreamsToAppState exists but is NOT mounted (App.tsx:200-207). No hook, no screen.

Desktop prior art: chat/src/surfaces/RoomSurface.tsx + useRoomFeed.ts; copy chat/src/i18n/{en,it}/room.ts.
Phone UI seams: drawer items src/host/conversationActions.ts:266-324, overlay union src/host/hostOverlay.ts:18-28 +
HostOverlays.tsx:106-119, ShellComposer, Transcript/TranscriptRow (role-based), HostNotice; i18n en + it only.

Plan v1 (text only): src/room/useRoom.ts (one pairing localId; info + newest history; stream + queue fold; dedupe;
name/send/discard/retry); src/screens/RoomScreen.tsx (members, name form + refusals, rows with author + AI identity,
empty/loading/error, queued/sending/failed, reconnecting, removed, composer + Ask Kalsa); Room overlay + drawer entry
only when a usable pairing exists (pick which computer if several); mount bindRoomStreamsToAppState once (check iOS
inactive does not close streams); en+it keys; tests for hook reconciliation + lifecycle. Risks: unmounted AppState
binding, stream only while subscribed, bounded history (transcript unbounded server-side).
