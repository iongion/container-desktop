// The Electron main↔renderer IPC collapse for the single-realm Tauri shell. Under Tauri a host-side broker
// (ResourceSyncBroker / AIBroker) runs in the SAME realm as the UI, so its ipcMain/ipcRenderer transport becomes
// an in-process bus: register() stashes the broker's handlers in Maps; the window.* client surface dispatches to
// them; pushes fan out to per-channel subscriber Sets. This was hand-rolled identically in resourceSyncHost.ts
// and aiSystemHost.ts — it lives here once. Tauri-agnostic (no @tauri-apps) so both hosts stay unit-testable.

type InvokeHandler = (event: any, payload: any) => unknown;
type MessageHandler = (event: any, payload: any) => void;
type Subscriber = (payload: any) => void;

// Single realm: there is no cross-process sender to validate (the Electron process-isolation boundary is
// collapsed — an accepted trade-off of the one-realm model). This sentinel stands in for the IpcMainInvokeEvent
// the broker's injected handlers expect; isAllowedSender always accepts it.
const LOCAL_EVENT = Object.freeze({ local: true });

export interface InRealmBus {
  // Broker-facing transport (what a broker's register() calls). `dispatch` is the broadcast/send target; it is
  // event-agnostic, so the AIBroker's (event, channel, payload) send wraps it while ResourceSyncBroker's
  // (channel, payload) broadcast uses it directly. senderId/isAllowedSender model the single trusted webview.
  onInvoke(channel: string, handler: InvokeHandler): void;
  onMessage(channel: string, handler: MessageHandler): void;
  dispatch(channel: string, payload: unknown): void;
  isAllowedSender(): boolean;
  senderId(): number;
  // Client-facing surface (the window.* side): reach an invoke handler / post a message / subscribe to a push.
  invoke(channel: string, payload?: any): unknown;
  send(channel: string, payload?: any): void;
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
      if (!set) {
        return;
      }
      for (const cb of set) {
        try {
          cb(payload);
        } catch {
          // A throwing subscriber must never break delivery to the others (matches resourceBus.ts).
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
