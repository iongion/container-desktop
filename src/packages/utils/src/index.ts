import merge from "deepmerge";
import { randomUUID } from "./randomUUID";

export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

// Expand a leading `~` in a path to the given home dir. Shared by the SSH preflight diagnostic and
// the executor's `StartSSHConnection` so a key path resolves identically in both (otherwise preflight
// can report "key missing" while the real connect succeeds, or vice-versa).
export function expandHome(filePath: string, homeDir: string): string {
  if (!filePath) {
    return filePath;
  }
  let result = filePath;
  if (result.startsWith("~")) {
    result = result.replace("~", homeDir);
  }
  if (result.includes("$HOME")) {
    result = result.replace("$HOME", homeDir);
  }
  return result;
}

export function isEmpty(value: unknown): boolean {
  if (value == null) {
    return true;
  }
  if (typeof value === "string" || Array.isArray(value)) {
    return value.length === 0;
  }
  if (value instanceof Map || value instanceof Set) {
    return value.size === 0;
  }
  if (isObject(value)) {
    return Object.keys(value).length === 0;
  }
  return false;
}

export function debounce<T extends (...args: any[]) => void>(fn: T, delayMs: number) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  return (...args: Parameters<T>) => {
    if (timeout) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(() => fn(...args), delayMs);
  };
}

export function deepMerge<T = any>(x: Partial<T>, ...y: Partial<T & any>[]) {
  return merge.all<Partial<T>>([x, ...y], {
    arrayMerge: (_, source) => source,
    isMergeableObject: isObject,
  }) as T;
}

export function axiosConfigToCURL(
  config,
  opts?: {
    as_array?: boolean;
    silent?: boolean;
    with_headers?: boolean;
    raw?: boolean;
    without_buffer?: boolean;
  },
) {
  if (!config?.baseURL || !config.socketPath) {
    throw new Error("Unable to construct curl from config");
  }
  let requestUrl = `${config.baseURL}${config.url}`;
  if (Object.keys(config.params || {}).length) {
    const searchParams = new URLSearchParams();
    Object.entries(config.params).forEach(([key, value]) => {
      searchParams.set(key, `${value}`);
    });
    requestUrl = `${requestUrl}?${searchParams}`;
  }
  const socketPath = `"${config.socketPath.replace("unix://", "").replace("npipe://", "")}"`;
  const command = ["curl"];
  if (opts?.silent) {
    command.push("-s");
  }
  command.push(opts?.with_headers ? "-i" : "-v");
  if (opts?.raw) {
    command.push("--raw");
  }
  if (opts?.without_buffer) {
    command.push("--no-buffer");
  }
  command.push("-X", config.method?.toUpperCase() || "GET");
  command.push("--unix-socket");
  command.push(socketPath);
  command.push(`"${requestUrl}"`);
  // Headers
  const exclude = ["common", "delete", "get", "head", "patch", "post", "put"];
  const extractHeaders = (bag) => {
    const headers = {};
    Object.entries(bag || {}).forEach(([key, value]) => {
      if (exclude.includes(key)) {
        return;
      }
      headers[key] = `${value}`;
    });
    return headers;
  };
  const commonHeaders = extractHeaders(config.headers?.common);
  const methodHeaders = config.method ? extractHeaders(config.headers[config.method]) : {};
  const userHeaders = extractHeaders(config.headers);
  const headers = { ...commonHeaders, ...methodHeaders, ...userHeaders };
  Object.entries(headers).forEach(([key, value]) => {
    command.push(`-H "${key}: ${value}"`);
  });
  if (typeof config.data !== "undefined") {
    let data = config.data;
    if (headers["Content-Type"] === "application/json" || typeof data !== "string") {
      data = JSON.stringify(data);
    }
    command.push("-d", `'${data}'`);
  }
  return opts?.as_array ? command : command.join(" ");
}

// Windows named-pipe path builder (pure string). Used by container-client transports/dialects.
export function getWindowsPipePath(key: string, keyAsPipeName?: boolean) {
  if (keyAsPipeName) {
    return `\\\\.\\pipe\\${key}`;
  }
  return `\\\\.\\pipe\\container-desktop-ssh-relay-${key}`;
}
