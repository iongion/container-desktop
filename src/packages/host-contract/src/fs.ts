// Filesystem + path host PORTS — part of the AI-free host-contract leaf (alongside capabilities.ts). Imports
// nothing internal, so consumers (ai-system runtimes, container-client) depend on it without pulling in the
// platform package. platform IMPLEMENTS these; IHostRuntime (platform/contract.ts) aggregates them.
export interface IPath {
  join: (...paths: string[]) => Promise<string>;
  basename: (location: string, ext?: string) => Promise<string>;
  dirname: (location: string) => Promise<string>;
  resolve: (...paths: string[]) => Promise<string>;
}

export interface IFileSystem {
  readTextFile(location: string): Promise<string>;
  writeTextFile(location: string, contents: string): Promise<void>;
  // Write a file that must NOT be world-readable (AI credentials / permissions / knowledge). The Node impl
  // hardens it to 0600. Kept DISTINCT from writeTextFile so ordinary app writes (config, containerfiles) are
  // never forced private.
  writePrivateTextFile(location: string, contents: string): Promise<void>;
  isFilePresent(filePath: string): Promise<boolean>;
  mkdir(location: string, options?: any): Promise<string | undefined>;
  rename(oldPath: string | URL, newPath: string | URL, options?: any): Promise<void>;
}

export type FileSystemEntryKind = "file" | "directory" | "symlink" | "other";

export interface FileSystemDirEntry {
  name: string;
  kind: FileSystemEntryKind;
}

export interface FileSystemStat {
  kind: FileSystemEntryKind;
  size: number;
  modifiedMs: number;
}

// Host facts required when loading bounded data trees such as AI skills. Kept separate from IFileSystem so small
// persistence-store fakes do not need to pretend they can make security decisions about canonical paths.
export interface IFileDiscoverySystem extends IFileSystem {
  listDirectory(location: string): Promise<FileSystemDirEntry[]>;
  lstat(location: string): Promise<FileSystemStat>;
  realPath(location: string): Promise<string>;
  isPathWithin(root: string, location: string): Promise<boolean>;
}
