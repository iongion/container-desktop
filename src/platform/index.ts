export function getWindowsPipePath(key: string, keyAsPipeName?: boolean) {
  if (keyAsPipeName) {
    return `\\\\.\\pipe\\${key}`;
  }
  return `\\\\.\\pipe\\container-desktop-ssh-relay-${key}`;
}
