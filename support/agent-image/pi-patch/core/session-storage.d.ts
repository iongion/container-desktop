/**
 * The file operations a session's storage needs.
 *
 * `SessionManager` reaches the filesystem directly today, which means a session can only ever be stored on the machine
 * the agent process runs on. A host that runs the agent somewhere else — a GUI running it inside a container, while the
 * user's history belongs on the user's own machine — has no seam to reach for. The harness layer already has one
 * (`FileSystem` in `@earendil-works/pi-agent`); this is the same idea for the coding agent's session store, and the
 * method names are lifted from it deliberately.
 *
 * It is SYNCHRONOUS because `SessionManager` is: `appendMessage` returns an entry id, and `create`/`open` touch the
 * disk in their constructors. An async port would change every one of those signatures.
 */
export interface SessionStorage {
    exists(path: string): boolean;
    /** Metadata for an existing file. Throws when it is missing, as `statSync` does. */
    fileInfo(path: string): SessionFileInfo;
    readTextFile(path: string): string;
    /**
     * Iterate UTF-8 lines LAZILY, stopping as soon as the caller stops or either bound is reached.
     *
     * Lazy is not a preference here: a session file can exceed Node's maximum string length, so it can neither be
     * read as one string nor held as an array of its lines — the caller parses each line and drops it. The bounds are
     * for the header scan, which reads the first entry of a file it may not want to open at all.
     */
    readTextLines(path: string, options?: {
        maxLines?: number;
        maxBytes?: number;
    }): Iterable<string>;
    /**
     * Stream UTF-8 lines. Optional: a storage that does not implement it is read with `readTextLines` instead.
     *
     * It exists because listing a directory of sessions reads EVERY file in it to count messages and build the search
     * text, and holding each one whole is a cost the local filesystem never had to pay.
     */
    readTextLineStream?(path: string): AsyncIterable<string>;
    listDir(path: string): SessionDirEntry[];
    /** Create a directory and its parents. Existing is not an error. */
    createDir(path: string): void;
    /** Create or overwrite. `exclusive` must fail when the path already exists (node's `wx`). */
    writeTextFile(path: string, contents: string, options?: {
        exclusive?: boolean;
    }): void;
    appendTextFile(path: string, contents: string): void;
}
export interface SessionFileInfo {
    size: number;
    modifiedMs: number;
}
export interface SessionDirEntry {
    name: string;
    isDirectory: boolean;
}
/** The filesystem, which is what every session store has used until now and stays the default. */
export declare const nodeSessionStorage: SessionStorage;
/**
 * Replace the storage every session store uses. Called once, before any session is created — the same shape as the
 * theme handshake, so a host does not have to thread a parameter through every `SessionManager` static.
 */
export declare function setSessionStorage(storage: SessionStorage): void;
export declare function getSessionStorage(): SessionStorage;
//# sourceMappingURL=session-storage.d.ts.map