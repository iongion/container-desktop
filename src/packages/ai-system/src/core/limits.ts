// Shared resource ceilings for AI operations. These are product limits, not transport implementation details.

export const DEFAULT_MODEL_TIMEOUT_MS = 10 * 60_000;
export const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 60_000;
export const DEFAULT_ENGINE_TOOL_TIMEOUT_MS = 2 * 60_000;

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

// Team runs fan a goal out over Worker tasks, so their ceilings are deliberately
// tighter than chat's: every task costs a full model turn, and the token budget is the user-facing cost cap.
// Generous STATIC wire/DoS backstops for Run counts. These are hard ceilings the wire schemas validate
// against; the OPERATIONAL values (how many runs the host actually keeps, how many tasks a plan may hold) are
// AI-settings-controlled under these ceilings (a zod .max() cannot read a runtime setting). Byte/timeline caps
// below stay as safety limits.
export const MAX_ACTIVE_RUNS = 1_000;
export const MAX_GOAL_CHARS = 8_000;
export const MAX_RUN_TASKS = 500;
export const MAX_RUN_SPANS = 20_000;
export const MAX_RUN_SPAN_BYTES = 8 * 1024 * 1024;
export const MAX_RUN_SPAN_BATCH = 64;
export const MAX_RUN_TASK_TOOL_RESULTS = 128;
export const MAX_RUN_TASK_DESCRIPTION_CHARS = 8_000;
export const MAX_RUN_TASK_OUTPUT_CHARS = 32_000;
export const MAX_RUN_SYNTHESIS_CHARS = 100_000;
export const DEFAULT_RUN_TOKEN_BUDGET = 200_000;
export const MAX_RUN_TOKEN_BUDGET = 5_000_000;
export const DEFAULT_RUN_MAX_CONCURRENCY = 3;

// The workers library + per-run roster. Generous STATIC backstops; the operational roster size is AI-settings-
// controlled (a large roster crowds the coordinator's prompt, so the default stays small even though the ceiling
// is high).
export const MAX_WORKERS = 256;
export const MAX_RUN_WORKERS = 128;
export const MAX_WORKER_FILE_BYTES = 4 * 1024 * 1024;
export const MAX_WORKER_NAME_CHARS = 120;
export const MAX_WORKER_SPECIALTY_CHARS = 280;
export const MAX_WORKER_PROMPT_CHARS = 32_000;
// Ceiling for a granular allowlist. Comfortably above the ~30 built-in tool ids, with room for future toolsets.
export const MAX_WORKER_ALLOWED_TOOLS = 256;

// The avatar library — custom uploads only (presets are shipped assets). A record is a downscaled ~128px WebP
// stored inline, so per-record bytes are bounded well above that to tolerate PNG fallbacks.
export const MAX_AVATARS = 64;
export const MAX_AVATAR_NAME_CHARS = 120;
export const MAX_AVATAR_DATA_URL_BYTES = 256 * 1024;
export const MAX_AVATAR_FILE_BYTES = 24 * 1024 * 1024;

export const MAX_RETAINED_THREADS = 100;
export const MAX_THREAD_FILE_BYTES = 32 * 1024 * 1024;
export const MAX_THREAD_RECORD_BYTES = 4 * 1024 * 1024;
export const MAX_THREAD_TIMELINE_ITEMS = 5_000;
export const MAX_THREAD_MODEL_MESSAGES = 2_000;
export const MAX_THREAD_COMPACTIONS = 32;
export const MAX_THREAD_COMPACTION_SUMMARY_CHARS = 64_000;
export const MAX_THREAD_COMPACTION_INSTRUCTIONS_CHARS = 8_000;
export const MAX_TOOL_ARTIFACTS = 256;
export const MAX_TOOL_ARTIFACT_BYTES = 4 * 1024 * 1024;
export const MAX_TOOL_ARTIFACT_TOTAL_BYTES = 48 * 1024 * 1024;
export const MAX_TOOL_ARTIFACT_FILE_BYTES = 64 * 1024 * 1024;
export const MAX_TOOL_RESULT_INLINE_BYTES = 32 * 1024;
export const MAX_TOOL_RESULT_PREVIEW_CHARS = 8_000;
