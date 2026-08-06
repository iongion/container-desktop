import { appendFileSync, closeSync, createReadStream, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, statSync, writeFileSync, } from "fs";
import { createInterface } from "readline";
import { StringDecoder } from "string_decoder";
// A session file can hold very long stretches without a newline — a legacy entry, or a sparse file — and the pending
// text is built by concatenation, so a small buffer turns one long line into thousands of copies of a growing string.
// 1 MiB is what the chunked reader this replaces used, and the "larger than Node's max string length" case is the one
// that measures it.
const READ_BUFFER_SIZE = 1024 * 1024;
/** The filesystem, which is what every session store has used until now and stays the default. */
export const nodeSessionStorage = {
    exists(path) {
        return existsSync(path);
    },
    fileInfo(path) {
        const stats = statSync(path);
        return { size: stats.size, modifiedMs: stats.mtime.getTime() };
    },
    readTextFile(path) {
        return readFileSync(path, "utf8");
    },
    *readTextLines(path, options) {
        const maxLines = options?.maxLines ?? Number.POSITIVE_INFINITY;
        const maxBytes = options?.maxBytes ?? Number.POSITIVE_INFINITY;
        const fd = openSync(path, "r");
        try {
            const decoder = new StringDecoder("utf8");
            const buffer = Buffer.allocUnsafe(READ_BUFFER_SIZE);
            let pending = "";
            let readBytes = 0;
            let yielded = 0;
            while (readBytes < maxBytes && yielded < maxLines) {
                const length = Math.min(buffer.length, maxBytes - readBytes);
                const bytesRead = readSync(fd, buffer, 0, length, null);
                if (bytesRead === 0) {
                    pending += decoder.end();
                    // The last line of a file that does not end in a newline.
                    if (pending)
                        yield pending;
                    return;
                }
                readBytes += bytesRead;
                pending += decoder.write(buffer.subarray(0, bytesRead));
                let start = 0;
                let newline = pending.indexOf("\n", start);
                while (newline !== -1 && yielded < maxLines) {
                    yield pending.slice(start, newline);
                    yielded++;
                    start = newline + 1;
                    newline = pending.indexOf("\n", start);
                }
                pending = pending.slice(start);
            }
            // A bound cut a line in half: it is not yielded, so a caller cannot mistake a fragment for a whole line.
            // Whether that matters is the caller's to decide from the file's own size.
        }
        finally {
            // Reached however the loop ends, including a caller that breaks out early — which is what makes the
            // header scan cheap on a file nobody wants to read.
            closeSync(fd);
        }
    },
    async *readTextLineStream(path) {
        const lines = createInterface({ input: createReadStream(path, { encoding: "utf8" }), crlfDelay: Infinity });
        try {
            for await (const line of lines)
                yield line;
        }
        finally {
            lines.close();
        }
    },
    listDir(path) {
        return readdirSync(path, { withFileTypes: true }).map((entry) => ({
            name: entry.name,
            isDirectory: entry.isDirectory(),
        }));
    },
    createDir(path) {
        mkdirSync(path, { recursive: true });
    },
    writeTextFile(path, contents, options) {
        if (!options?.exclusive) {
            writeFileSync(path, contents);
            return;
        }
        const fd = openSync(path, "wx");
        try {
            writeFileSync(fd, contents);
        }
        finally {
            closeSync(fd);
        }
    },
    appendTextFile(path, contents) {
        appendFileSync(path, contents);
    },
};
let installed = nodeSessionStorage;
/**
 * Replace the storage every session store uses. Called once, before any session is created — the same shape as the
 * theme handshake, so a host does not have to thread a parameter through every `SessionManager` static.
 */
export function setSessionStorage(storage) {
    installed = storage;
}
export function getSessionStorage() {
    return installed;
}
//# sourceMappingURL=session-storage.js.map