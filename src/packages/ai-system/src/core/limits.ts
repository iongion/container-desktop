// Shared resource ceilings for AI operations. These are product limits, not transport implementation details.

export const MAX_ACTIVE_AGENT_SESSIONS = 16;
export const MAX_DIAGNOSTICS_BUNDLE_CHARS = 256_000;
export const MAX_SUBMISSION_HISTORY_ENTRIES = 100;
export const MAX_ASSISTANT_COMMAND_CHARS = 8_000;
export const MAX_ASSISTANT_COMMAND_ARGUMENTS = 64;
export const MAX_ASSISTANT_COMMAND_MATCHES = 100;
export const MAX_QUEUED_ASSISTANT_COMMANDS = 32;
export const MODEL_DISCOVERY_TIMEOUT_MS = 15_000;
export const MAX_MODEL_DISCOVERY_RESPONSE_BYTES = 2 * 1024 * 1024;
export const MAX_DISCOVERED_MODELS = 5_000;
export const MAX_MODEL_ID_CHARS = 512;
export const MAX_MODEL_DISCOVERY_PAGES = 20;

// Ceiling for a skill's tool allowlist. Comfortably above the ~30 built-in tool ids, with room for future toolsets.
export const MAX_ALLOWED_TOOLS = 256;

export const MAX_RETAINED_SESSIONS = 100;
export const MAX_SESSION_FILE_BYTES = 32 * 1024 * 1024;
export const MAX_SESSION_RECORD_BYTES = 4 * 1024 * 1024;
export const MAX_SESSION_TIMELINE_ITEMS = 5_000;
export const MAX_SESSION_MODEL_MESSAGES = 2_000;
export const MAX_SESSION_COMPACTIONS = 32;
export const MAX_SESSION_COMPACTION_SUMMARY_CHARS = 64_000;
export const MAX_SESSION_COMPACTION_INSTRUCTIONS_CHARS = 8_000;
export const MAX_TOOL_ARTIFACTS = 256;
export const MAX_TOOL_ARTIFACT_BYTES = 4 * 1024 * 1024;
export const MAX_TOOL_ARTIFACT_TOTAL_BYTES = 48 * 1024 * 1024;
export const MAX_TOOL_ARTIFACT_FILE_BYTES = 64 * 1024 * 1024;
export const MAX_TOOL_RESULT_INLINE_BYTES = 32 * 1024;
export const MAX_TOOL_RESULT_PREVIEW_CHARS = 8_000;
