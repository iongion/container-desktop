// In-process transport for trusted single-webview shells. Brokers register invoke/message handlers and clients
// invoke, send or subscribe through the same realm without pretending there is an Electron process boundary.

export type InRealmEvent = { readonly local: true };

type InvokeHandler = (event: InRealmEvent, payload: unknown) => unknown;
type MessageHandler = (event: InRealmEvent, payload: unknown) => void;
type Subscriber = (payload: unknown) => void;

const LOCAL_EVENT: InRealmEvent = Object.freeze({ local: true });

export interface InRealmBus {
  onInvoke(channel: string, handler: InvokeHandler): void;
  onMessage(channel: string, handler: MessageHandler): void;
  dispatch(channel: string, payload: unknown): void;
  isAllowedSender(): boolean;
  senderId(): number;
  invoke(channel: string, payload?: unknown): unknown;
  send(channel: string, payload?: unknown): void;
  subscribe(channel: string, callback: Subscriber): () => void;
  handles(channel: string): boolean;
  clear(): void;
}

export function createInRealmBus(): InRealmBus {
  const invokeHandlers = new Map<string, InvokeHandler>();
  const messageHandlers = new Map<string, MessageHandler>();
  const subscribers = new Map<string, Set<Subscriber>>();

  return {
    onInvoke: (channel, handler) => invokeHandlers.set(channel, handler),
    onMessage: (channel, handler) => messageHandlers.set(channel, handler),
    dispatch: (channel, payload) => {
      const set = subscribers.get(channel);
      if (!set) return;
      for (const callback of set) {
        try {
          callback(payload);
        } catch {
          // One renderer observer cannot break delivery to the rest.
        }
      }
    },
    isAllowedSender: () => true,
    senderId: () => 1,
    invoke: (channel, payload) => invokeHandlers.get(channel)?.(LOCAL_EVENT, payload),
    send: (channel, payload) => {
      messageHandlers.get(channel)?.(LOCAL_EVENT, payload);
    },
    subscribe: (channel, callback) => {
      let set = subscribers.get(channel);
      if (!set) {
        set = new Set();
        subscribers.set(channel, set);
      }
      set.add(callback);
      return () => {
        subscribers.get(channel)?.delete(callback);
      };
    },
    handles: (channel) => invokeHandlers.has(channel) || messageHandlers.has(channel),
    clear: () => {
      invokeHandlers.clear();
      messageHandlers.clear();
      subscribers.clear();
    },
  };
}
