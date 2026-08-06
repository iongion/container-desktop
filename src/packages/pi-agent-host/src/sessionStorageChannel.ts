// The layout of the shared window the two threads hand conversation bytes across, and how a payload is cut to fit it.
//
// Both ends import this: the blocked caller (`sessionStorage.ts`) and the worker that owns the socket
// (`sessionStorageWorker.ts`). One origin, because an answer written under one layout and read under another is a
// silent corruption rather than an error.

// Indices into the control array. BOTH threads wait, which is why there are two flags rather than one: the caller
// waits for a chunk to appear, and the worker waits for that chunk to be drained before overwriting the window.
export const CONTROL_ANSWER = 0;
export const CONTROL_DRAINED = 1;
export const CONTROL_LENGTH = 2;
export const CONTROL_MORE = 3;
export const CONTROL_SLOTS = 4;
export const CONTROL_BYTES = CONTROL_SLOTS * 4;

// One window, reused by every call and drained in as many chunks as the answer needs. FIXED, so a long conversation
// cannot make the container's memory grow with it; 1 MiB because that is the buffer pi's own chunked reader used, and
// a conversation's whole JSONL crosses in a handful of chunks at that size.
export const STORAGE_WINDOW_BYTES = 1024 * 1024;

export interface StorageChunk {
  bytes: Uint8Array;
  // False on the last chunk. The caller stops draining on it, so an answer whose length is an exact multiple of the
  // window must NOT report one more.
  more: boolean;
}

// Cut a payload into window-sized pieces. A zero-length payload still yields one chunk: the caller is blocked waiting
// for something, and "nothing to send" is still an answer it has to be handed.
export function* chunkPayload(bytes: Uint8Array, windowBytes: number): Generator<StorageChunk> {
  let offset = 0;
  do {
    const length = Math.min(windowBytes, bytes.length - offset);
    const chunk = bytes.subarray(offset, offset + length);
    offset += length;
    yield { bytes: chunk, more: offset < bytes.length };
  } while (offset < bytes.length);
}
