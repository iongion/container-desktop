// file-saver ships no types and we only use saveAs; declare it precisely instead of pulling @types.
declare module "file-saver" {
  export function saveAs(data: Blob | string, filename?: string, options?: { autoBom?: boolean }): void;
}
