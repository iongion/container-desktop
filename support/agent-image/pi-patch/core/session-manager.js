import { uuidv7 } from "@earendil-works/pi-ai";
import { randomUUID } from "crypto";
import { join, resolve } from "path";
import { getAgentDir as getDefaultAgentDir, getSessionsDir } from "../config.js";
import { normalizePath, resolvePath } from "../utils/paths.js";
import { createBranchSummaryMessage, createCompactionSummaryMessage, createCustomMessage, } from "./messages.js";
import { getSessionStorage } from "./session-storage.js";
export const CURRENT_SESSION_VERSION = 3;
function createSessionId() {
    return uuidv7();
}
export function assertValidSessionId(id) {
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(id)) {
        throw new Error("Session id must be non-empty, contain only alphanumeric characters, '-', '_', and '.', and start and end with an alphanumeric character");
    }
}
/** Generate a unique short ID (8 hex chars, collision-checked) */
function generateId(byId) {
    for (let i = 0; i < 100; i++) {
        const id = randomUUID().slice(0, 8);
        if (!byId.has(id))
            return id;
    }
    // Fallback to full UUID if somehow we have collisions
    return randomUUID();
}
/** Migrate v1 → v2: add id/parentId tree structure. Mutates in place. */
function migrateV1ToV2(entries) {
    const ids = new Set();
    let prevId = null;
    for (const entry of entries) {
        if (entry.type === "session") {
            entry.version = 2;
            continue;
        }
        entry.id = generateId(ids);
        entry.parentId = prevId;
        prevId = entry.id;
        // Convert firstKeptEntryIndex to firstKeptEntryId for compaction
        if (entry.type === "compaction") {
            const comp = entry;
            if (typeof comp.firstKeptEntryIndex === "number") {
                const targetEntry = entries[comp.firstKeptEntryIndex];
                if (targetEntry && targetEntry.type !== "session") {
                    comp.firstKeptEntryId = targetEntry.id;
                }
                delete comp.firstKeptEntryIndex;
            }
        }
    }
}
/** Migrate v2 → v3: rename hookMessage role to custom. Mutates in place. */
function migrateV2ToV3(entries) {
    for (const entry of entries) {
        if (entry.type === "session") {
            entry.version = 3;
            continue;
        }
        // Update message entries with hookMessage role
        if (entry.type === "message") {
            const msgEntry = entry;
            if (msgEntry.message && msgEntry.message.role === "hookMessage") {
                msgEntry.message.role = "custom";
            }
        }
    }
}
/**
 * Run all necessary migrations to bring entries to current version.
 * Mutates entries in place. Returns true if any migration was applied.
 */
function migrateToCurrentVersion(entries) {
    const header = entries.find((e) => e.type === "session");
    const version = header?.version ?? 1;
    if (version >= CURRENT_SESSION_VERSION)
        return false;
    if (version < 2)
        migrateV1ToV2(entries);
    if (version < 3)
        migrateV2ToV3(entries);
    return true;
}
/** Exported for testing */
export function migrateSessionEntries(entries) {
    migrateToCurrentVersion(entries);
}
/** Exported for compaction.test.ts */
export function parseSessionEntries(content) {
    const entries = [];
    const lines = content.trim().split("\n");
    for (const line of lines) {
        if (!line.trim())
            continue;
        try {
            const entry = JSON.parse(line);
            entries.push(entry);
        }
        catch {
            // Skip malformed lines
        }
    }
    return entries;
}
export function getLatestCompactionEntry(entries) {
    for (let i = entries.length - 1; i >= 0; i--) {
        if (entries[i].type === "compaction") {
            return entries[i];
        }
    }
    return null;
}
function buildEntryIndex(entries, byId) {
    if (byId)
        return byId;
    const index = new Map();
    for (const entry of entries) {
        index.set(entry.id, entry);
    }
    return index;
}
function buildSessionPath(entries, leafId, byId) {
    const index = buildEntryIndex(entries, byId);
    let leaf;
    if (leafId === null) {
        return [];
    }
    if (leafId) {
        leaf = index.get(leafId);
    }
    leaf ??= entries[entries.length - 1];
    if (!leaf) {
        return [];
    }
    const path = [];
    let current = leaf;
    while (current) {
        path.push(current);
        current = current.parentId ? index.get(current.parentId) : undefined;
    }
    path.reverse();
    return path;
}
function getSessionContextSettings(path) {
    let thinkingLevel = "off";
    let model = null;
    for (const entry of path) {
        if (entry.type === "thinking_level_change") {
            thinkingLevel = entry.thinkingLevel;
        }
        else if (entry.type === "model_change") {
            model = { provider: entry.provider, modelId: entry.modelId };
        }
        else if (entry.type === "message" && entry.message.role === "assistant") {
            model = { provider: entry.message.provider, modelId: entry.message.model };
        }
    }
    return { thinkingLevel, model };
}
/**
 * Project one selected session entry into LLM/runtime messages.
 * Plain custom entries are display/state entries and do not participate in context.
 */
export function sessionEntryToContextMessages(entry) {
    if (entry.type === "message") {
        const message = entry.message;
        // Session files are parsed without validation; old versions, forks, or
        // hand-edited files can contain messages with null/missing content.
        if ((message.role === "user" || message.role === "assistant" || message.role === "toolResult") &&
            message.content == null) {
            return [{ ...message, content: [] }];
        }
        return [message];
    }
    if (entry.type === "custom_message") {
        return [
            createCustomMessage(entry.customType, entry.content ?? [], entry.display, entry.details, entry.timestamp),
        ];
    }
    if (entry.type === "branch_summary" && entry.summary) {
        return [createBranchSummaryMessage(entry.summary, entry.fromId, entry.timestamp)];
    }
    if (entry.type === "compaction") {
        return [createCompactionSummaryMessage(entry.summary, entry.tokensBefore, entry.timestamp)];
    }
    return [];
}
/**
 * Build the active, compaction-aware session entry list.
 *
 * This follows the current leaf path. If the path contains compaction entries,
 * the latest compaction is represented by the compaction entry itself, followed
 * by the kept entries starting at firstKeptEntryId and all entries after the
 * compaction entry. Older summarized entries are omitted.
 */
export function buildContextEntries(entries, leafId, byId) {
    const path = buildSessionPath(entries, leafId, byId);
    let compaction = null;
    for (const entry of path) {
        if (entry.type === "compaction") {
            compaction = entry;
        }
    }
    if (!compaction) {
        return path;
    }
    const compactionIdx = path.findIndex((entry) => entry.id === compaction.id);
    if (compactionIdx < 0) {
        return path;
    }
    const contextEntries = [compaction];
    let foundFirstKept = false;
    for (let i = 0; i < compactionIdx; i++) {
        const entry = path[i];
        if (entry.id === compaction.firstKeptEntryId) {
            foundFirstKept = true;
        }
        if (foundFirstKept) {
            contextEntries.push(entry);
        }
    }
    contextEntries.push(...path.slice(compactionIdx + 1));
    return contextEntries;
}
/**
 * Build the session context from entries using tree traversal.
 * If leafId is provided, walks from that entry to root.
 * Handles compaction and branch summaries along the path.
 */
export function buildSessionContext(entries, leafId, byId) {
    const path = buildSessionPath(entries, leafId, byId);
    const { thinkingLevel, model } = getSessionContextSettings(path);
    const messages = buildContextEntries(entries, leafId, byId).flatMap(sessionEntryToContextMessages);
    return { messages, thinkingLevel, model };
}
/**
 * Compute the default session directory for a cwd.
 * Encodes cwd into a safe directory name under ~/.pi/agent/sessions/.
 */
function getDefaultSessionDirPath(cwd, agentDir = getDefaultAgentDir()) {
    const resolvedCwd = resolvePath(cwd);
    const resolvedAgentDir = resolvePath(agentDir);
    const safePath = `--${resolvedCwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
    return join(resolvedAgentDir, "sessions", safePath);
}
export function getDefaultSessionDir(cwd, agentDir = getDefaultAgentDir()) {
    const sessionDir = getDefaultSessionDirPath(cwd, agentDir);
    const storage = getSessionStorage();
    if (!storage.exists(sessionDir)) {
        storage.createDir(sessionDir);
    }
    return sessionDir;
}
/** Bound synchronous header discovery while allowing large cwd and custom metadata fields. */
const MAX_SESSION_HEADER_SCAN_BYTES = 1024 * 1024;
class SessionHeaderScanLimitError extends Error {
    constructor(filePath) {
        super(`Session header exceeds ${MAX_SESSION_HEADER_SCAN_BYTES}-byte scan limit: ${filePath}`);
        this.name = "SessionHeaderScanLimitError";
    }
}
/** One JSONL line. A session file is append-only, which is why a new entry costs one line and never a rewrite. */
function serializeEntry(entry) {
    return `${JSON.stringify(entry)}\n`;
}
function serializeEntries(entries) {
    return entries.map(serializeEntry).join("");
}
function parseSessionEntryLine(line) {
    if (!line.trim())
        return null;
    try {
        return JSON.parse(line);
    }
    catch {
        // Skip malformed lines
        return null;
    }
}
/** Exported for testing */
export function loadEntriesFromFile(filePath) {
    const resolvedFilePath = normalizePath(filePath);
    const storage = getSessionStorage();
    if (!storage.exists(resolvedFilePath))
        return [];
    const entries = [];
    for (const line of storage.readTextLines(resolvedFilePath)) {
        const entry = parseSessionEntryLine(line);
        if (entry)
            entries.push(entry);
    }
    // Validate session header
    if (entries.length === 0)
        return entries;
    const header = entries[0];
    if (header.type !== "session" || typeof header.id !== "string") {
        return [];
    }
    return entries;
}
/**
 * Inspect a physical line while searching for the first parsed session entry.
 * Blank and malformed lines are skipped to match loadEntriesFromFile().
 * Returns undefined to keep scanning, null for a parsed non-header entry, or the header.
 */
function parseSessionHeaderCandidate(line) {
    if (!line.trim())
        return undefined;
    const entry = parseSessionEntryLine(line);
    if (!entry)
        return undefined;
    if (entry.type !== "session" || typeof entry.id !== "string")
        return null;
    return entry;
}
function readSessionHeader(filePath) {
    const storage = getSessionStorage();
    // Bounded so a session file with a very large first line cannot cost an unbounded read. Storage stops AT the
    // bound, and a line the bound cut in half is not returned — so a header not found within it is either absent or
    // bigger than the limit, which the file's own size tells apart.
    const lines = storage.readTextLines(filePath, { maxBytes: MAX_SESSION_HEADER_SCAN_BYTES });
    for (const line of lines) {
        const header = parseSessionHeaderCandidate(line);
        if (header !== undefined)
            return header;
    }
    if (storage.fileInfo(filePath).size > MAX_SESSION_HEADER_SCAN_BYTES) {
        throw new SessionHeaderScanLimitError(filePath);
    }
    return null;
}
function readSessionHeaderForDiscovery(filePath) {
    try {
        return readSessionHeader(filePath);
    }
    catch {
        // Discovery is best-effort: unreadable or oversized files are not sessions,
        // and one corrupt file must not prevent other sessions from being found.
        return null;
    }
}
function getSessionHeaderCwd(header) {
    const cwd = header.cwd;
    return typeof cwd === "string" ? cwd : undefined;
}
function sessionCwdMatches(cwd, resolvedCwd) {
    return cwd !== undefined && cwd !== "" && resolvePath(cwd) === resolvedCwd;
}
/** Exported for testing */
export function findMostRecentSession(sessionDir, cwd) {
    const resolvedSessionDir = normalizePath(sessionDir);
    const resolvedCwd = cwd ? resolvePath(cwd) : undefined;
    const storage = getSessionStorage();
    try {
        const files = storage
            .listDir(resolvedSessionDir)
            .filter((entry) => !entry.isDirectory && entry.name.endsWith(".jsonl"))
            .map((entry) => join(resolvedSessionDir, entry.name))
            .map((path) => ({ path, header: readSessionHeaderForDiscovery(path) }))
            .filter((file) => file.header !== null &&
            (!resolvedCwd || sessionCwdMatches(getSessionHeaderCwd(file.header), resolvedCwd)))
            .map(({ path }) => ({ path, modifiedMs: storage.fileInfo(path).modifiedMs }))
            .sort((a, b) => b.modifiedMs - a.modifiedMs);
        return files[0]?.path || null;
    }
    catch {
        // Directory access and stat races make recent-session discovery unavailable.
        return null;
    }
}
function isMessageWithContent(message) {
    return typeof message.role === "string" && "content" in message;
}
function extractTextContent(message) {
    const content = message.content;
    if (typeof content === "string") {
        return content;
    }
    return content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join(" ");
}
function getMessageActivityTime(entry) {
    const message = entry.message;
    if (!isMessageWithContent(message))
        return undefined;
    if (message.role !== "user" && message.role !== "assistant")
        return undefined;
    const msgTimestamp = message.timestamp;
    if (typeof msgTimestamp === "number") {
        return msgTimestamp;
    }
    const t = new Date(entry.timestamp).getTime();
    return Number.isNaN(t) ? undefined : t;
}
async function buildSessionInfo(filePath) {
    try {
        const storage = getSessionStorage();
        const stats = storage.fileInfo(filePath);
        let header = null;
        let messageCount = 0;
        let firstMessage = "";
        const allMessages = [];
        let name;
        let lastActivityTime;
        // Streamed when the storage can: listing a directory reads EVERY session in it, and holding each one whole is
        // a cost the filesystem never had to pay. A storage with no stream is read as lines instead.
        const lines = storage.readTextLineStream?.(filePath) ?? storage.readTextLines(filePath);
        for await (const line of lines) {
            const entry = parseSessionEntryLine(line);
            if (!entry)
                continue;
            if (!header) {
                if (entry.type !== "session")
                    return null;
                header = entry;
                continue;
            }
            // Extract session name (use latest, including explicit clears)
            if (entry.type === "session_info") {
                name = entry.name?.trim() || undefined;
            }
            if (entry.type !== "message")
                continue;
            messageCount++;
            const activityTime = getMessageActivityTime(entry);
            if (typeof activityTime === "number") {
                lastActivityTime = Math.max(lastActivityTime ?? 0, activityTime);
            }
            const message = entry.message;
            if (!isMessageWithContent(message))
                continue;
            if (message.role !== "user" && message.role !== "assistant")
                continue;
            const textContent = extractTextContent(message);
            if (!textContent)
                continue;
            allMessages.push(textContent);
            if (!firstMessage && message.role === "user") {
                firstMessage = textContent;
            }
        }
        if (!header)
            return null;
        const cwd = typeof header.cwd === "string" ? header.cwd : "";
        const parentSessionPath = header.parentSession;
        const headerTime = typeof header.timestamp === "string" ? new Date(header.timestamp).getTime() : NaN;
        const modified = typeof lastActivityTime === "number" && lastActivityTime > 0
            ? new Date(lastActivityTime)
            : !Number.isNaN(headerTime)
                ? new Date(headerTime)
                : new Date(stats.modifiedMs);
        return {
            path: filePath,
            id: header.id,
            cwd,
            name,
            parentSessionPath,
            created: new Date(header.timestamp),
            modified,
            messageCount,
            firstMessage: firstMessage || "(no messages)",
            allMessagesText: allMessages.join(" "),
        };
    }
    catch {
        return null;
    }
}
const MAX_CONCURRENT_SESSION_INFO_LOADS = 10;
async function buildSessionInfosWithConcurrency(files, onLoaded) {
    const results = new Array(files.length).fill(null);
    const inFlight = new Set();
    let nextIndex = 0;
    const startNext = () => {
        const index = nextIndex++;
        const file = files[index];
        if (!file)
            return;
        let task;
        task = buildSessionInfo(file)
            .then((info) => {
            results[index] = info;
        })
            .catch(() => {
            results[index] = null;
        })
            .finally(() => {
            inFlight.delete(task);
            onLoaded();
        });
        inFlight.add(task);
    };
    while (nextIndex < files.length || inFlight.size > 0) {
        while (nextIndex < files.length && inFlight.size < MAX_CONCURRENT_SESSION_INFO_LOADS) {
            startNext();
        }
        if (inFlight.size > 0) {
            await Promise.race(inFlight);
        }
    }
    return results;
}
async function listSessionsFromDir(dir, onProgress, progressOffset = 0, progressTotal) {
    const sessions = [];
    const storage = getSessionStorage();
    if (!storage.exists(dir)) {
        return sessions;
    }
    try {
        const files = storage
            .listDir(dir)
            .filter((entry) => !entry.isDirectory && entry.name.endsWith(".jsonl"))
            .map((entry) => join(dir, entry.name));
        const total = progressTotal ?? files.length;
        let loaded = 0;
        const results = await buildSessionInfosWithConcurrency(files, () => {
            loaded++;
            onProgress?.(progressOffset + loaded, total);
        });
        for (const info of results) {
            if (info) {
                sessions.push(info);
            }
        }
    }
    catch {
        // Return empty list on error
    }
    return sessions;
}
/**
 * Manages conversation sessions as append-only trees stored in JSONL files.
 *
 * Each session entry has an id and parentId forming a tree structure. The "leaf"
 * pointer tracks the current position. Appending creates a child of the current leaf.
 * Branching moves the leaf to an earlier entry, allowing new branches without
 * modifying history.
 *
 * Use buildSessionContext() to get the resolved message list for the LLM, which
 * handles compaction summaries and follows the path from root to current leaf.
 */
export class SessionManager {
    sessionId = "";
    sessionFile;
    sessionDir;
    cwd;
    persist;
    /** Resolved once per session, so a storage installed later cannot move a session that is already open. */
    storage;
    flushed = false;
    fileEntries = [];
    byId = new Map();
    labelsById = new Map();
    labelTimestampsById = new Map();
    leafId = null;
    constructor(cwd, sessionDir, sessionFile, persist, newSessionOptions, preloadedFileEntries) {
        this.cwd = resolvePath(cwd);
        this.sessionDir = normalizePath(sessionDir);
        this.persist = persist;
        this.storage = getSessionStorage();
        if (persist && this.sessionDir && !this.storage.exists(this.sessionDir)) {
            this.storage.createDir(this.sessionDir);
        }
        if (sessionFile) {
            this._setSessionFile(sessionFile, preloadedFileEntries);
        }
        else {
            this.newSession(newSessionOptions);
        }
    }
    /** Switch to a different session file (used for resume and branching) */
    setSessionFile(sessionFile) {
        this._setSessionFile(sessionFile);
    }
    _setSessionFile(sessionFile, preloadedFileEntries) {
        this.sessionFile = resolvePath(sessionFile);
        if (this.storage.exists(this.sessionFile)) {
            this.fileEntries = preloadedFileEntries ?? loadEntriesFromFile(this.sessionFile);
            // If file was empty, initialize it with a valid session header. If it was
            // non-empty but did not parse as a pi session, fail without modifying it.
            if (this.fileEntries.length === 0) {
                const explicitPath = this.sessionFile;
                if (this.storage.fileInfo(explicitPath).size > 0) {
                    throw new Error(`Session file is not a valid pi session: ${explicitPath}`);
                }
                this.newSession();
                this.sessionFile = explicitPath;
                this._rewriteFile();
                this.flushed = true;
                return;
            }
            const header = this.fileEntries.find((e) => e.type === "session");
            this.sessionId = header?.id ?? createSessionId();
            if (migrateToCurrentVersion(this.fileEntries)) {
                this._rewriteFile();
            }
            this._buildIndex();
            this.flushed = true;
        }
        else {
            const explicitPath = this.sessionFile;
            this.newSession();
            this.sessionFile = explicitPath; // preserve explicit path from --session flag
        }
    }
    newSession(options) {
        if (options?.id !== undefined) {
            assertValidSessionId(options.id);
        }
        this.sessionId = options?.id ?? createSessionId();
        const timestamp = new Date().toISOString();
        const header = {
            type: "session",
            version: CURRENT_SESSION_VERSION,
            id: this.sessionId,
            timestamp,
            cwd: this.cwd,
            parentSession: options?.parentSession,
        };
        this.fileEntries = [header];
        this.byId.clear();
        this.labelsById.clear();
        this.labelTimestampsById.clear();
        this.leafId = null;
        this.flushed = false;
        if (this.persist) {
            const fileTimestamp = timestamp.replace(/[:.]/g, "-");
            this.sessionFile = join(this.getSessionDir(), `${fileTimestamp}_${this.sessionId}.jsonl`);
        }
        return this.sessionFile;
    }
    _buildIndex() {
        this.byId.clear();
        this.labelsById.clear();
        this.labelTimestampsById.clear();
        this.leafId = null;
        for (const entry of this.fileEntries) {
            if (entry.type === "session")
                continue;
            this.byId.set(entry.id, entry);
            this.leafId = entry.id;
            if (entry.type === "label") {
                if (entry.label) {
                    this.labelsById.set(entry.targetId, entry.label);
                    this.labelTimestampsById.set(entry.targetId, entry.timestamp);
                }
                else {
                    this.labelsById.delete(entry.targetId);
                    this.labelTimestampsById.delete(entry.targetId);
                }
            }
        }
    }
    _rewriteFile() {
        if (!this.persist || !this.sessionFile)
            return;
        this.storage.writeTextFile(this.sessionFile, serializeEntries(this.fileEntries));
    }
    isPersisted() {
        return this.persist;
    }
    getCwd() {
        return this.cwd;
    }
    getSessionDir() {
        return this.sessionDir;
    }
    usesDefaultSessionDir() {
        return this.sessionDir === getDefaultSessionDirPath(this.cwd);
    }
    getSessionId() {
        return this.sessionId;
    }
    getSessionFile() {
        return this.sessionFile;
    }
    _persist(entry) {
        if (!this.persist || !this.sessionFile)
            return;
        const hasAssistant = this.fileEntries.some((e) => e.type === "message" && e.message.role === "assistant");
        if (!hasAssistant) {
            if (this.flushed) {
                this.storage.appendTextFile(this.sessionFile, serializeEntry(entry));
            }
            else {
                // Mark as not flushed so when assistant arrives, all entries get written
                this.flushed = false;
            }
            return;
        }
        if (!this.flushed) {
            // Exclusive: the file is being created here for the first time, and a second header would be written if
            // something else had made it in the meantime.
            this.storage.writeTextFile(this.sessionFile, serializeEntries(this.fileEntries), { exclusive: true });
            this.flushed = true;
        }
        else {
            this.storage.appendTextFile(this.sessionFile, serializeEntry(entry));
        }
    }
    _appendEntry(entry) {
        this.fileEntries.push(entry);
        this.byId.set(entry.id, entry);
        this.leafId = entry.id;
        this._persist(entry);
    }
    /** Append a message as child of current leaf, then advance leaf. Returns entry id.
     * Does not allow writing CompactionSummaryMessage and BranchSummaryMessage directly.
     * Reason: we want these to be top-level entries in the session, not message session entries,
     * so it is easier to find them.
     * These need to be appended via appendCompaction() and appendBranchSummary() methods.
     */
    appendMessage(message) {
        const entry = {
            type: "message",
            id: generateId(this.byId),
            parentId: this.leafId,
            timestamp: new Date().toISOString(),
            message,
        };
        this._appendEntry(entry);
        return entry.id;
    }
    /** Append a thinking level change as child of current leaf, then advance leaf. Returns entry id. */
    appendThinkingLevelChange(thinkingLevel) {
        const entry = {
            type: "thinking_level_change",
            id: generateId(this.byId),
            parentId: this.leafId,
            timestamp: new Date().toISOString(),
            thinkingLevel,
        };
        this._appendEntry(entry);
        return entry.id;
    }
    /** Append a model change as child of current leaf, then advance leaf. Returns entry id. */
    appendModelChange(provider, modelId) {
        const entry = {
            type: "model_change",
            id: generateId(this.byId),
            parentId: this.leafId,
            timestamp: new Date().toISOString(),
            provider,
            modelId,
        };
        this._appendEntry(entry);
        return entry.id;
    }
    /** Append a compaction summary as child of current leaf, then advance leaf. Returns entry id. */
    appendCompaction(summary, firstKeptEntryId, tokensBefore, details, fromHook, usage) {
        const entry = {
            type: "compaction",
            id: generateId(this.byId),
            parentId: this.leafId,
            timestamp: new Date().toISOString(),
            summary,
            firstKeptEntryId,
            tokensBefore,
            details,
            usage,
            fromHook,
        };
        this._appendEntry(entry);
        return entry.id;
    }
    /** Append a custom entry (for extensions) as child of current leaf, then advance leaf. Returns entry id. */
    appendCustomEntry(customType, data) {
        const entry = {
            type: "custom",
            customType,
            data,
            id: generateId(this.byId),
            parentId: this.leafId,
            timestamp: new Date().toISOString(),
        };
        this._appendEntry(entry);
        return entry.id;
    }
    /** Append a session info entry (e.g., display name). Returns entry id. */
    appendSessionInfo(name) {
        const sanitizedName = name.replace(/[\r\n]+/g, " ").trim();
        const entry = {
            type: "session_info",
            id: generateId(this.byId),
            parentId: this.leafId,
            timestamp: new Date().toISOString(),
            name: sanitizedName,
        };
        this._appendEntry(entry);
        return entry.id;
    }
    /** Get the current session name from the latest session_info entry, if any. */
    getSessionName() {
        // Walk entries in reverse to find the latest session_info entry.
        // Empty names explicitly clear the session title.
        const entries = this.getEntries();
        for (let i = entries.length - 1; i >= 0; i--) {
            const entry = entries[i];
            if (entry.type === "session_info") {
                return entry.name?.trim() || undefined;
            }
        }
        return undefined;
    }
    /**
     * Append a custom message entry (for extensions) that participates in LLM context.
     * @param customType Extension identifier for filtering on reload
     * @param content Message content (string or TextContent/ImageContent array)
     * @param display Whether to show in TUI (true = styled display, false = hidden)
     * @param details Optional extension-specific metadata (not sent to LLM)
     * @returns Entry id
     */
    appendCustomMessageEntry(customType, content, display, details) {
        const entry = {
            type: "custom_message",
            customType,
            content,
            display,
            details,
            id: generateId(this.byId),
            parentId: this.leafId,
            timestamp: new Date().toISOString(),
        };
        this._appendEntry(entry);
        return entry.id;
    }
    // =========================================================================
    // Tree Traversal
    // =========================================================================
    getLeafId() {
        return this.leafId;
    }
    getLeafEntry() {
        return this.leafId ? this.byId.get(this.leafId) : undefined;
    }
    getEntry(id) {
        return this.byId.get(id);
    }
    /**
     * Get all direct children of an entry.
     */
    getChildren(parentId) {
        const children = [];
        for (const entry of this.byId.values()) {
            if (entry.parentId === parentId) {
                children.push(entry);
            }
        }
        return children;
    }
    /**
     * Get the label for an entry, if any.
     */
    getLabel(id) {
        return this.labelsById.get(id);
    }
    /**
     * Set or clear a label on an entry.
     * Labels are user-defined markers for bookmarking/navigation.
     * Pass undefined or empty string to clear the label.
     */
    appendLabelChange(targetId, label) {
        if (!this.byId.has(targetId)) {
            throw new Error(`Entry ${targetId} not found`);
        }
        const entry = {
            type: "label",
            id: generateId(this.byId),
            parentId: this.leafId,
            timestamp: new Date().toISOString(),
            targetId,
            label,
        };
        this._appendEntry(entry);
        if (label) {
            this.labelsById.set(targetId, label);
            this.labelTimestampsById.set(targetId, entry.timestamp);
        }
        else {
            this.labelsById.delete(targetId);
            this.labelTimestampsById.delete(targetId);
        }
        return entry.id;
    }
    /**
     * Walk from entry to root, returning all entries in path order.
     * Includes all entry types (messages, compaction, model changes, etc.).
     * Use buildSessionContext() to get the resolved messages for the LLM.
     */
    getBranch(fromId) {
        const path = [];
        const startId = fromId ?? this.leafId;
        let current = startId ? this.byId.get(startId) : undefined;
        while (current) {
            path.push(current);
            current = current.parentId ? this.byId.get(current.parentId) : undefined;
        }
        path.reverse();
        return path;
    }
    /**
     * Build the active, compaction-aware entry list for context/rendering.
     * Uses tree traversal from current leaf.
     */
    buildContextEntries() {
        return buildContextEntries(this.getEntries(), this.leafId, this.byId);
    }
    /**
     * Build the session context (what gets sent to the LLM).
     * Uses tree traversal from current leaf.
     */
    buildSessionContext() {
        return buildSessionContext(this.getEntries(), this.leafId, this.byId);
    }
    /**
     * Get session header.
     */
    getHeader() {
        const h = this.fileEntries.find((e) => e.type === "session");
        return h ? h : null;
    }
    /**
     * Get all session entries (excludes header). Returns a shallow copy.
     * The session is append-only: use appendXXX() to add entries, branch() to
     * change the leaf pointer. Entries cannot be modified or deleted.
     */
    getEntries() {
        return this.fileEntries.filter((e) => e.type !== "session");
    }
    /**
     * Get the session as a tree structure. Returns a shallow defensive copy of all entries.
     * A well-formed session has exactly one root (first entry with parentId === null).
     * Orphaned entries (broken parent chain) are also returned as roots.
     */
    getTree() {
        const entries = this.getEntries();
        const nodeMap = new Map();
        const roots = [];
        // Create nodes with resolved labels
        for (const entry of entries) {
            const label = this.labelsById.get(entry.id);
            const labelTimestamp = this.labelTimestampsById.get(entry.id);
            nodeMap.set(entry.id, { entry, children: [], label, labelTimestamp });
        }
        // Build tree
        for (const entry of entries) {
            const node = nodeMap.get(entry.id);
            if (entry.parentId === null || entry.parentId === entry.id) {
                roots.push(node);
            }
            else {
                const parent = nodeMap.get(entry.parentId);
                if (parent) {
                    parent.children.push(node);
                }
                else {
                    // Orphan - treat as root
                    roots.push(node);
                }
            }
        }
        // Sort children by timestamp (oldest first, newest at bottom)
        // Use iterative approach to avoid stack overflow on deep trees
        const stack = [...roots];
        while (stack.length > 0) {
            const node = stack.pop();
            node.children.sort((a, b) => new Date(a.entry.timestamp).getTime() - new Date(b.entry.timestamp).getTime());
            stack.push(...node.children);
        }
        return roots;
    }
    // =========================================================================
    // Branching
    // =========================================================================
    /**
     * Start a new branch from an earlier entry.
     * Moves the leaf pointer to the specified entry. The next appendXXX() call
     * will create a child of that entry, forming a new branch. Existing entries
     * are not modified or deleted.
     */
    branch(branchFromId) {
        if (!this.byId.has(branchFromId)) {
            throw new Error(`Entry ${branchFromId} not found`);
        }
        this.leafId = branchFromId;
    }
    /**
     * Reset the leaf pointer to null (before any entries).
     * The next appendXXX() call will create a new root entry (parentId = null).
     * Use this when navigating to re-edit the first user message.
     */
    resetLeaf() {
        this.leafId = null;
    }
    /**
     * Start a new branch with a summary of the abandoned path.
     * Same as branch(), but also appends a branch_summary entry that captures
     * context from the abandoned conversation path.
     */
    branchWithSummary(branchFromId, summary, details, fromHook, usage) {
        if (branchFromId !== null && !this.byId.has(branchFromId)) {
            throw new Error(`Entry ${branchFromId} not found`);
        }
        this.leafId = branchFromId;
        const entry = {
            type: "branch_summary",
            id: generateId(this.byId),
            parentId: branchFromId,
            timestamp: new Date().toISOString(),
            fromId: branchFromId ?? "root",
            summary,
            details,
            usage,
            fromHook,
        };
        this._appendEntry(entry);
        return entry.id;
    }
    /**
     * Create a new session file containing only the path from root to the specified leaf.
     * Useful for extracting a single conversation path from a branched session.
     * Returns the new session file path, or undefined if not persisting.
     */
    createBranchedSession(leafId) {
        const previousSessionFile = this.sessionFile;
        const path = this.getBranch(leafId);
        if (path.length === 0) {
            throw new Error(`Entry ${leafId} not found`);
        }
        // Filter out LabelEntry from path - we'll recreate them from the resolved map.
        // Because labels are real tree entries, later entries can be children of labels;
        // removing labels requires re-chaining the retained path to avoid orphaned subtrees.
        const pathWithoutLabels = [];
        let pathParentId = null;
        for (const entry of path) {
            if (entry.type === "label")
                continue;
            pathWithoutLabels.push({ ...entry, parentId: pathParentId });
            pathParentId = entry.id;
        }
        const newSessionId = createSessionId();
        const timestamp = new Date().toISOString();
        const fileTimestamp = timestamp.replace(/[:.]/g, "-");
        const newSessionFile = join(this.getSessionDir(), `${fileTimestamp}_${newSessionId}.jsonl`);
        const header = {
            type: "session",
            version: CURRENT_SESSION_VERSION,
            id: newSessionId,
            timestamp,
            cwd: this.cwd,
            parentSession: this.persist ? previousSessionFile : undefined,
        };
        // Collect labels for entries in the path
        const pathEntryIds = new Set(pathWithoutLabels.map((e) => e.id));
        const labelsToWrite = [];
        for (const [targetId, label] of this.labelsById) {
            if (pathEntryIds.has(targetId)) {
                labelsToWrite.push({ targetId, label, timestamp: this.labelTimestampsById.get(targetId) });
            }
        }
        if (this.persist) {
            // Build label entries
            const lastEntryId = pathWithoutLabels[pathWithoutLabels.length - 1]?.id || null;
            let parentId = lastEntryId;
            const labelEntries = [];
            for (const { targetId, label, timestamp: labelTimestamp } of labelsToWrite) {
                const labelEntry = {
                    type: "label",
                    id: generateId(new Set(pathEntryIds)),
                    parentId,
                    timestamp: labelTimestamp,
                    targetId,
                    label,
                };
                pathEntryIds.add(labelEntry.id);
                labelEntries.push(labelEntry);
                parentId = labelEntry.id;
            }
            this.fileEntries = [header, ...pathWithoutLabels, ...labelEntries];
            this.sessionId = newSessionId;
            this.sessionFile = newSessionFile;
            this._buildIndex();
            // Only write the file now if it contains an assistant message.
            // Otherwise defer to _persist(), which creates the file on the
            // first assistant response, matching the newSession() contract
            // and avoiding the duplicate-header bug when _persist()'s
            // no-assistant guard later resets flushed to false.
            const hasAssistant = this.fileEntries.some((e) => e.type === "message" && e.message.role === "assistant");
            if (hasAssistant) {
                this._rewriteFile();
                this.flushed = true;
            }
            else {
                this.flushed = false;
            }
            return newSessionFile;
        }
        // In-memory mode: replace current session with the path + labels
        const labelEntries = [];
        let parentId = pathWithoutLabels[pathWithoutLabels.length - 1]?.id || null;
        for (const { targetId, label, timestamp: labelTimestamp } of labelsToWrite) {
            const labelEntry = {
                type: "label",
                id: generateId(new Set([...pathEntryIds, ...labelEntries.map((e) => e.id)])),
                parentId,
                timestamp: labelTimestamp,
                targetId,
                label,
            };
            labelEntries.push(labelEntry);
            parentId = labelEntry.id;
        }
        this.fileEntries = [header, ...pathWithoutLabels, ...labelEntries];
        this.sessionId = newSessionId;
        this._buildIndex();
        return undefined;
    }
    /**
     * Create a new session.
     * @param cwd Working directory (stored in session header)
     * @param sessionDir Optional session directory. If omitted, uses default (~/.pi/agent/sessions/<encoded-cwd>/).
     */
    static create(cwd, sessionDir, options) {
        const dir = sessionDir ? normalizePath(sessionDir) : getDefaultSessionDir(cwd);
        return new SessionManager(cwd, dir, undefined, true, options);
    }
    /**
     * Open a specific session file.
     * @param path Path to session file
     * @param sessionDir Optional session directory for /new or /branch. If omitted, derives from file's parent.
     * @param cwdOverride Optional cwd override instead of the session header cwd.
     */
    static open(path, sessionDir, cwdOverride) {
        const resolvedPath = resolvePath(path);
        let header = null;
        let preloadedFileEntries;
        if (cwdOverride === undefined && getSessionStorage().exists(resolvedPath)) {
            try {
                header = readSessionHeader(resolvedPath);
            }
            catch (error) {
                if (!(error instanceof SessionHeaderScanLimitError))
                    throw error;
                // The bounded scan is only a discovery optimization. A full load remains
                // authoritative for legacy files with very large headers or prefixes.
                preloadedFileEntries = loadEntriesFromFile(resolvedPath);
                const firstEntry = preloadedFileEntries[0];
                header = firstEntry?.type === "session" ? firstEntry : null;
            }
        }
        const cwd = cwdOverride ?? (header ? getSessionHeaderCwd(header) : undefined) ?? process.cwd();
        // If no sessionDir provided, derive from file's parent directory
        const dir = sessionDir ? normalizePath(sessionDir) : resolve(resolvedPath, "..");
        return new SessionManager(cwd, dir, resolvedPath, true, undefined, preloadedFileEntries);
    }
    /**
     * Continue the most recent session, or create new if none.
     * @param cwd Working directory
     * @param sessionDir Optional session directory. If omitted, uses default (~/.pi/agent/sessions/<encoded-cwd>/).
     */
    static continueRecent(cwd, sessionDir) {
        const dir = sessionDir ? normalizePath(sessionDir) : getDefaultSessionDir(cwd);
        const filterCwd = sessionDir !== undefined && dir !== getDefaultSessionDirPath(cwd);
        const mostRecent = findMostRecentSession(dir, filterCwd ? cwd : undefined);
        if (mostRecent) {
            return new SessionManager(cwd, dir, mostRecent, true);
        }
        return new SessionManager(cwd, dir, undefined, true);
    }
    /** Create an in-memory session (no file persistence) */
    static inMemory(cwd = process.cwd(), options) {
        return new SessionManager(cwd, "", undefined, false, options);
    }
    /**
     * Fork a session from another project directory into the current project.
     * Creates a new session in the target cwd with the full history from the source session.
     * @param sourcePath Path to the source session file
     * @param targetCwd Target working directory (where the new session will be stored)
     * @param sessionDir Optional session directory. If omitted, uses default for targetCwd.
     */
    static forkFrom(sourcePath, targetCwd, sessionDir, options) {
        const resolvedSourcePath = resolvePath(sourcePath);
        const resolvedTargetCwd = resolvePath(targetCwd);
        const sourceEntries = loadEntriesFromFile(resolvedSourcePath);
        if (sourceEntries.length === 0) {
            throw new Error(`Cannot fork: source session file is empty or invalid: ${resolvedSourcePath}`);
        }
        const sourceHeader = sourceEntries.find((e) => e.type === "session");
        if (!sourceHeader) {
            throw new Error(`Cannot fork: source session has no header: ${resolvedSourcePath}`);
        }
        const storage = getSessionStorage();
        const dir = sessionDir ? normalizePath(sessionDir) : getDefaultSessionDir(resolvedTargetCwd);
        if (!storage.exists(dir)) {
            storage.createDir(dir);
        }
        // Create new session file with new ID but forked content
        if (options?.id !== undefined) {
            assertValidSessionId(options.id);
        }
        const newSessionId = options?.id ?? createSessionId();
        const timestamp = new Date().toISOString();
        const fileTimestamp = timestamp.replace(/[:.]/g, "-");
        const newSessionFile = join(dir, `${fileTimestamp}_${newSessionId}.jsonl`);
        // Write new header pointing to source as parent, with updated cwd
        const newHeader = {
            type: "session",
            version: CURRENT_SESSION_VERSION,
            id: newSessionId,
            timestamp,
            cwd: resolvedTargetCwd,
            parentSession: resolvedSourcePath,
        };
        // Exclusive, because a fork must never land on top of a session that already holds this name.
        storage.writeTextFile(newSessionFile, serializeEntry(newHeader), { exclusive: true });
        // Copy all non-header entries from source
        storage.appendTextFile(newSessionFile, serializeEntries(sourceEntries.filter((e) => e.type !== "session")));
        return new SessionManager(resolvedTargetCwd, dir, newSessionFile, true);
    }
    /**
     * List all sessions for a directory.
     * @param cwd Working directory (used to compute default session directory)
     * @param sessionDir Optional session directory. If omitted, uses default (~/.pi/agent/sessions/<encoded-cwd>/).
     * @param onProgress Optional callback for progress updates (loaded, total)
     */
    static async list(cwd, sessionDir, onProgress) {
        const dir = sessionDir ? normalizePath(sessionDir) : getDefaultSessionDir(cwd);
        const filterCwd = sessionDir !== undefined && dir !== getDefaultSessionDirPath(cwd);
        const resolvedCwd = resolvePath(cwd);
        const sessions = (await listSessionsFromDir(dir, onProgress)).filter((session) => !filterCwd || sessionCwdMatches(session.cwd, resolvedCwd));
        sessions.sort((a, b) => b.modified.getTime() - a.modified.getTime());
        return sessions;
    }
    static async listAll(sessionDirOrOnProgress, onProgress) {
        const customSessionDir = typeof sessionDirOrOnProgress === "string" ? normalizePath(sessionDirOrOnProgress) : undefined;
        const progress = typeof sessionDirOrOnProgress === "function" ? sessionDirOrOnProgress : onProgress;
        if (customSessionDir) {
            const sessions = await listSessionsFromDir(customSessionDir, progress);
            sessions.sort((a, b) => b.modified.getTime() - a.modified.getTime());
            return sessions;
        }
        const sessionsDir = getSessionsDir();
        const storage = getSessionStorage();
        try {
            if (!storage.exists(sessionsDir)) {
                return [];
            }
            const dirs = storage
                .listDir(sessionsDir)
                .filter((entry) => entry.isDirectory)
                .map((entry) => join(sessionsDir, entry.name));
            // Count total files first for accurate progress
            let totalFiles = 0;
            const dirFiles = [];
            for (const dir of dirs) {
                try {
                    const files = storage
                        .listDir(dir)
                        .filter((entry) => !entry.isDirectory && entry.name.endsWith(".jsonl"))
                        .map((entry) => join(dir, entry.name));
                    dirFiles.push(files);
                    totalFiles += files.length;
                }
                catch {
                    dirFiles.push([]);
                }
            }
            // Process all files with progress tracking
            let loaded = 0;
            const sessions = [];
            const allFiles = dirFiles.flat();
            const results = await buildSessionInfosWithConcurrency(allFiles, () => {
                loaded++;
                progress?.(loaded, totalFiles);
            });
            for (const info of results) {
                if (info) {
                    sessions.push(info);
                }
            }
            sessions.sort((a, b) => b.modified.getTime() - a.modified.getTime());
            return sessions;
        }
        catch {
            return [];
        }
    }
}
//# sourceMappingURL=session-manager.js.map