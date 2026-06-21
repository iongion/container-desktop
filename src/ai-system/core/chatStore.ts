// Pluggable chat-session storage. Program against the ChatStore PORT; the default
// adapter is in-memory (ephemeral). A custom store (file/SQLite/IndexedDB/cloud/IPC→main) implements the
// same interface and is installed once at bootstrap via setChatStore(). No Electron/React/AI-SDK imports.

export type ChatRole = "user" | "assistant" | "system";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: number;
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  providerId?: string;
  model?: string;
  messages: ChatMessage[];
}

// The seam. Async so any backend fits without changing callers; saveSession upserts a whole session by id.
export interface ChatStore {
  loadSessions(): Promise<ChatSession[]>;
  saveSession(session: ChatSession): Promise<void>;
  deleteSession(id: string): Promise<void>;
  clearSessions(): Promise<void>;
}

// Default adapter: dies with the renderer process. Stores deep copies so callers can't mutate held state.
export class InMemoryChatStore implements ChatStore {
  private readonly sessions = new Map<string, ChatSession>();

  async loadSessions(): Promise<ChatSession[]> {
    return Array.from(this.sessions.values()).map((s) => structuredClone(s));
  }

  async saveSession(session: ChatSession): Promise<void> {
    this.sessions.set(session.id, structuredClone(session));
  }

  async deleteSession(id: string): Promise<void> {
    this.sessions.delete(id);
  }

  async clearSessions(): Promise<void> {
    this.sessions.clear();
  }
}

let current: ChatStore = new InMemoryChatStore();

export function getChatStore(): ChatStore {
  return current;
}

// Install a custom storage adapter (call once at bootstrap, before sessions load).
export function setChatStore(store: ChatStore): void {
  current = store;
}
