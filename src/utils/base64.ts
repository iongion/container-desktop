// UTF-8 ⇄ base64 over the Web APIs (TextEncoder/btoa + atob/TextDecoder) — NO Node Buffer, so it is neutral and
// works identically in main/dialect and the renderer. The single owner of base64 string conversion for the
// container-client adapters (swarm secrets/configs, remote Containerfile injection, buildx rawjson logs).

// UTF-8 string → base64.
export function toBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

// base64 → UTF-8 string.
export function fromBase64(value: string): string {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}
