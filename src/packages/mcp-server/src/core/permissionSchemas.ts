// The permission records: one remembered allow/reject, and the snapshot of both lists. Validated on the wire and on
// load from disk.
import { z } from "zod";

export const MAX_PERMISSION_KEY_CHARS = 8_192;

export const permissionsList = z.enum(["allowed", "blocked"]);

// One remembered allow/reject, scoped to a workspace, target, authority subject, typed operation, normalized
// arguments and trust epoch.
export const permissionRule = z
  .object({
    workspaceId: z.string().min(1).max(MAX_PERMISSION_KEY_CHARS),
    targetId: z.string().min(1).max(MAX_PERMISSION_KEY_CHARS),
    subject: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("access-profile"), id: z.string().min(1).max(MAX_PERMISSION_KEY_CHARS) }).strict(),
      z.object({ kind: z.literal("server"), id: z.string().min(1).max(MAX_PERMISSION_KEY_CHARS) }).strict(),
    ]),
    operation: z
      .object({
        kind: z.literal("tool"),
        id: z.string().min(1).max(MAX_PERMISSION_KEY_CHARS),
        serverId: z.string().min(1).max(MAX_PERMISSION_KEY_CHARS).optional(),
      })
      .strict(),
    normalizedArgs: z.string().max(MAX_PERMISSION_KEY_CHARS),
    contentTrustEpoch: z.string().min(1).max(MAX_PERMISSION_KEY_CHARS),
    addedAt: z.string().max(64).optional(),
  })
  .strict();

export const permissionsSnapshot = z
  .object({
    version: z.string().max(64),
    allowed: z.array(permissionRule).max(10_000),
    blocked: z.array(permissionRule).max(10_000),
    status: z.enum(["ok", "missing", "error"]),
    path: z.string().max(8_192),
  })
  .strict();
