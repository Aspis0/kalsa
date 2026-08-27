export type UnifiedChatMessage = { role: string; content: string };

export type UnifiedChatParams = {
  endpoint: string;
  token?: string | null;
  surface: string;
  context?: unknown;
  messages: UnifiedChatMessage[];
  fetchImpl?: typeof fetch;
};

export type UnifiedChatCallbacks = {
  onDelta?: (delta: string, full: string) => void;
  onStatus?: (status: { label: string }) => void;
  onSources?: (items: any[]) => void;
  onMiniapp?: (miniapp: any) => void;
  onActions?: (payload: any) => void;
  onCta?: (payload: any) => void;
  onUsage?: (usage: any) => void;
  onError?: (error: Error) => void;
  onDone?: () => void;
};

export function streamUnifiedChat(
  params: UnifiedChatParams,
  callbacks?: UnifiedChatCallbacks,
  options?: { signal?: AbortSignal },
): Promise<{ answer: string; usage: any; finish: string | null; ok: boolean }>;
