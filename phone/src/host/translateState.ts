/**
 * The translate job's cross-module guard, as its own tiny module the way
 * `src/engine/regenState.ts` holds the send's locks: `sendHost.send` and the
 * menu's opener must see a translate in flight SYNCHRONOUSLY, before the
 * run's first await (`AiChatPage.tsx:3536-3540` sets the same ref at the
 * same moment; `Chat:2233` and `Chat:3495` read it).
 *
 * The run id and the AbortController stay component-local in
 * `useTranslateMessage.ts`: nothing outside that hook reads them, exactly as
 * the controller kept `translateRunRef` / `translateAbortRef` beside the
 * state they guard.
 */
export const translationInFlightRef = { current: false };
