export type ToolPrivacyMode = "local" | "lan" | "cloud-blocked" | "export";

export type ToolPrivacyBadge = {
  detail: string;
  label: string;
  mode: ToolPrivacyMode;
};

export const TOOL_PRIVACY_BADGES: Record<string, ToolPrivacyBadge>;
export function getToolPrivacyBadge(id: string): ToolPrivacyBadge;
