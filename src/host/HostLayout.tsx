/**
 * The root's composition: the three children it arranges, and nothing else.
 * Cut out of `HostRoot.tsx` so the root stays a hook-and-state composer under
 * its ratchet (`fileSize.test.ts`): the root decides WHAT exists, this file
 * arranges HOW the strip/surface, the drawer and the furniture sit together.
 *
 * Every prop arrives flat and already built by the root — no decisions are
 * made here, so a reader looking for "who owns this state" still finds it in
 * one place: the root.
 */
import type { ChatSurfaceProps } from "./HostChatSurface";
import type { HostDrawerProps } from "./HostDrawer";
import type { HostFurnitureProps } from "./HostFurniture";
import { HostChatSurface } from "./HostChatSurface";
import { HostDrawer } from "./HostDrawer";
import { HostFurniture } from "./HostFurniture";

export interface HostLayoutProps {
  /** Safe-area insets: `top` paints the strip below the notch, `bottom`
   *  feeds the drawer and the notice band. */
  insets: { top: number; bottom: number };
  draft: ChatSurfaceProps["draft"];
  onDraftChange: ChatSurfaceProps["onDraftChange"];
  view: ChatSurfaceProps["view"];
  modelHost: ChatSurfaceProps["modelHost"];
  showNoticeKey: ChatSurfaceProps["showNoticeKey"];
  sendHost: ChatSurfaceProps["sendHost"];
  onMenuPress: ChatSurfaceProps["onMenuPress"];
  onNewChatPress: ChatSurfaceProps["onNewChatPress"];
  flags: ChatSurfaceProps["flags"];
  arms: ChatSurfaceProps["arms"];
  /** The message-interaction bundle (menu, copy, translate, edit, read-aloud). */
  actions: ChatSurfaceProps["actions"];
  onMiniappOpen: ChatSurfaceProps["onMiniappOpen"];
  drawerOpen: HostDrawerProps["open"];
  setDrawerOpen: HostDrawerProps["setOpen"];
  conv: HostDrawerProps["conv"];
  /** The conversation actions the root builds (`createConversationActions`);
   *  renamed here so the sheet's `actions` prop above stays unambiguous. */
  conversationActions: HostDrawerProps["actions"];
  personas: HostDrawerProps["personas"];
  onExportPress: HostDrawerProps["onExportPress"];
  activeOverlay: HostFurnitureProps["overlay"];
  setActiveOverlay: HostFurnitureProps["setOverlay"];
  /** The one-slot notice: `showNoticeKey` feeds it keys, `showNotice` text. */
  notice: HostFurnitureProps["notice"];
  showNotice: HostFurnitureProps["onNoticeText"];
  memory: HostFurnitureProps["memory"];
  library: HostFurnitureProps["library"];
  streaming: HostFurnitureProps["streaming"];
}

export function HostLayout({
  insets,
  draft,
  onDraftChange,
  view,
  modelHost,
  showNoticeKey,
  sendHost,
  onMenuPress,
  onNewChatPress,
  flags,
  arms,
  actions,
  onMiniappOpen,
  drawerOpen,
  setDrawerOpen,
  conv,
  conversationActions,
  personas,
  onExportPress,
  activeOverlay,
  setActiveOverlay,
  notice,
  showNotice,
  memory,
  library,
  streaming,
}: HostLayoutProps) {
  return (
    <>
      <HostChatSurface
        insets={insets}
        draft={draft}
        onDraftChange={onDraftChange}
        view={view}
        modelHost={modelHost}
        showNoticeKey={showNoticeKey}
        sendHost={sendHost}
        onMenuPress={onMenuPress}
        onNewChatPress={onNewChatPress}
        conversationId={conv.conversationsReady ? conv.conversations.activeId : undefined}
        flags={flags}
        arms={arms}
        actions={actions}
        onMiniappOpen={onMiniappOpen}
      />

      <HostDrawer
        insets={insets}
        open={drawerOpen}
        setOpen={setDrawerOpen}
        conv={conv}
        actions={conversationActions}
        personas={personas}
        setActiveOverlay={setActiveOverlay}
        onExportPress={onExportPress}
      />

      <HostFurniture
        overlay={activeOverlay}
        setOverlay={setActiveOverlay}
        onNotice={showNoticeKey}
        onNoticeText={showNotice}
        notice={notice}
        memory={memory}
        flags={flags}
        library={library}
        personas={personas}
        modelHost={modelHost}
        streaming={streaming}
      />
    </>
  );
}
