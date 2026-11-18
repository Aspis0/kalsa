export type Role = "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  createdAt: number;
  reasoning?: string;
}

export interface ConversationMeta {
  id: string;
  title: string;
  preview: string;
  updatedAt: number;
  search: string;
}

export interface Conversation extends ConversationMeta {
  messages: ChatMessage[];
}
