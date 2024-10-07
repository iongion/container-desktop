export function getWindowsPipePath(name: string) {
  return `\\\\.\\pipe\\${name}`;
}
