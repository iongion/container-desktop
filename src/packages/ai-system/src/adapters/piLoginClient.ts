// The app's end of a provider sign-in. Same socket, same codec and same handshake as the session bridge, and a
// deliberately tiny conversation: one login, the prompts it raises, and the outcome.
//
// It does NOT wait for a `ready` event the way the session client does — a login container has no session, no cwd and
// no model to announce, so the handshake's own response is what says the peer is authenticated. Inventing a session
// id to fit the session client's shape would be a fiction in the one place a credential is decided.

import type { WebSocketLike } from "@/ai-system/adapters/piBridgeClient";
import { createLogger } from "@/logger";
import { decodeEvent, encodeCommand } from "@/pi-bridge/codec";
import {
  type BridgeEvent,
  PI_BRIDGE_PROTOCOL_VERSION,
  type PiAuthLoginOutcome,
  type PiAuthRefreshOutcome,
} from "@/pi-bridge/protocol";
import { randomUUID } from "@/utils/randomUUID";

const logger = createLogger("ai.piLoginClient");

// The container's bridge binds its port a few hundred milliseconds AFTER `run --detach` returns, so a single-shot
// connect is a coin flip — the same reason the session client retries.
const CONNECT_ATTEMPTS = 40;
const CONNECT_DELAY_MS = 250;

// pi gives its OpenRouter login five minutes and every other flow its own budget; the app must outlast all of them, or
// it would report a timeout while the user is still typing their password.
const LOGIN_TIMEOUT_MS = 900_000;

// A refresh asks the user nothing — it is one token call — so it gets a request timeout, not a login's patience.
const REFRESH_TIMEOUT_MS = 30_000;

export type PiLoginEvent = Extract<BridgeEvent, { type: "auth_prompt" | "auth_prompt_closed" | "auth_event" }>;

export interface PiLoginClient {
  connect(): Promise<void>;
  // Run pi's flow for one provider, by PI's provider id. Answers with an outcome rather than throwing: a cancelled
  // login and a refused code are things to show, not faults.
  login(piProviderId: string): Promise<PiAuthLoginOutcome>;
  // Exchange the credential this container was handed for a live one, through pi's own flow. Same container and same
  // reason as a login — plus the credential itself, which the web view cannot read out of the vault.
  refresh(piProviderId: string): Promise<PiAuthRefreshOutcome>;
  answerPrompt(promptId: string, ok: boolean, value?: string): void;
  cancel(): void;
  onEvent(listener: (event: PiLoginEvent) => void): () => void;
  close(): void;
}

export function createPiLoginClient(options: {
  url: string;
  token: string;
  socketFactory?: (url: string) => WebSocketLike;
  connectRetry?: { attempts: number; delayMs: number };
}): PiLoginClient {
  const listeners = new Set<(event: PiLoginEvent) => void>();
  let socket: WebSocketLike | undefined;
  const pending = new Map<
    string,
    { settle: (result: unknown) => void; fail: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();

  const failAllPending = (reason: string) => {
    for (const [id, waiting] of [...pending]) {
      pending.delete(id);
      clearTimeout(waiting.timer);
      waiting.fail(new Error(reason));
    }
  };

  const send = (command: Parameters<typeof encodeCommand>[0]) => socket?.send(encodeCommand(command));

  return {
    connect(): Promise<void> {
      const attempts = options.connectRetry?.attempts ?? CONNECT_ATTEMPTS;
      const delayMs = options.connectRetry?.delayMs ?? CONNECT_DELAY_MS;
      return new Promise<void>((resolve, reject) => {
        let attempt = 0;
        let greeted = false;

        const open = () => {
          attempt += 1;
          const created = options.socketFactory
            ? options.socketFactory(options.url)
            : (new WebSocket(options.url) as unknown as WebSocketLike);
          socket = created;
          const helloId = randomUUID();
          // One attempt reports one outcome: a refused socket fires both error and close.
          let done = false;
          const failed = (error: Error) => {
            if (greeted || done) return;
            done = true;
            if (attempt >= attempts) {
              reject(error);
              return;
            }
            setTimeout(open, delayMs);
          };

          created.onopen = () => {
            created.send(
              encodeCommand({
                id: helloId,
                type: "hello",
                token: options.token,
                protocolVersion: PI_BRIDGE_PROTOCOL_VERSION,
              }),
            );
          };
          created.onmessage = (message) => {
            let event: BridgeEvent;
            try {
              event = decodeEvent(String(message.data));
            } catch (error) {
              logger.error("login bridge frame rejected", error);
              return;
            }
            if (event.type === "response") {
              if (event.id === helloId && !greeted) {
                greeted = true;
                done = true;
                if (event.success) resolve();
                else reject(new Error(event.error ?? "the sign-in container refused the handshake"));
                return;
              }
              const waiting = pending.get(event.id);
              if (!waiting) return;
              pending.delete(event.id);
              clearTimeout(waiting.timer);
              if (event.success) waiting.settle(event.result);
              else waiting.fail(new Error(event.error ?? "the sign-in container rejected the command"));
              return;
            }
            if (event.type === "auth_prompt" || event.type === "auth_prompt_closed" || event.type === "auth_event") {
              for (const listener of [...listeners]) {
                try {
                  listener(event);
                } catch (error) {
                  logger.error("login listener threw", error);
                }
              }
            }
          };
          created.onclose = () => {
            failAllPending("the sign-in container closed the connection");
            failed(new Error("the sign-in bridge closed before the handshake"));
          };
          created.onerror = (error) => {
            logger.debug("login bridge socket error", error);
            failed(new Error("the sign-in bridge could not be reached"));
          };
        };

        open();
      });
    },

    login(piProviderId: string): Promise<PiAuthLoginOutcome> {
      if (!socket) return Promise.reject(new Error("the sign-in bridge is not connected"));
      const id = randomUUID();
      return new Promise<PiAuthLoginOutcome>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error("the sign-in did not finish in time"));
        }, LOGIN_TIMEOUT_MS);
        pending.set(id, { settle: (result) => resolve(result as PiAuthLoginOutcome), fail: reject, timer });
        send({ id, type: "auth_login", provider: piProviderId });
      });
    },

    refresh(piProviderId: string): Promise<PiAuthRefreshOutcome> {
      if (!socket) return Promise.reject(new Error("the sign-in bridge is not connected"));
      const id = randomUUID();
      return new Promise<PiAuthRefreshOutcome>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error("the refresh did not finish in time"));
        }, REFRESH_TIMEOUT_MS);
        pending.set(id, { settle: (result) => resolve(result as PiAuthRefreshOutcome), fail: reject, timer });
        send({ id, type: "auth_refresh", provider: piProviderId });
      });
    },

    answerPrompt(promptId, ok, value) {
      send({ id: randomUUID(), type: "auth_prompt_answer", promptId, ok, ...(value === undefined ? {} : { value }) });
    },

    cancel() {
      send({ id: randomUUID(), type: "auth_cancel" });
    },

    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    close() {
      failAllPending("the sign-in was stopped");
      socket?.close();
      listeners.clear();
    },
  };
}
