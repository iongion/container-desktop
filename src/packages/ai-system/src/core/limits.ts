// Shared resource ceilings for AI operations. These are product limits, not transport implementation details.

export const DEFAULT_MODEL_TIMEOUT_MS = 10 * 60_000;
export const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 60_000;
export const DEFAULT_ENGINE_TOOL_TIMEOUT_MS = 2 * 60_000;

export const MAX_ACTIVE_CHAT_SESSIONS = 16;
export const MAX_DIAGNOSTICS_BUNDLE_CHARS = 256_000;
export const MAX_COMMAND_HISTORY_ENTRIES = 100;
export const MODEL_DISCOVERY_TIMEOUT_MS = 15_000;
export const MAX_MODEL_DISCOVERY_RESPONSE_BYTES = 2 * 1024 * 1024;
export const MAX_DISCOVERED_MODELS = 5_000;
export const MAX_MODEL_ID_CHARS = 512;
export const MAX_MODEL_DISCOVERY_PAGES = 20;

// Goal mode (multi-agent runs). A run fans a goal out over worker tasks, so its ceilings are deliberately
// tighter than chat's: every task costs a full model turn, and the token budget is the user-facing cost cap.
// Concurrent runs the host will carry. Raised from 4 once the Goals screen became a list rather than a single
// run: the worst case is this × DEFAULT_RUN_MAX_CONCURRENCY live model streams, so the per-run token budget
// stays the real cost cap.
export const MAX_ACTIVE_GOAL_RUNS = 8;
export const MAX_GOAL_CHARS = 8_000;
export const MAX_RUN_TASKS = 32;
export const MAX_RUN_TASK_DESCRIPTION_CHARS = 8_000;
export const MAX_RUN_TASK_OUTPUT_CHARS = 32_000;
export const MAX_RUN_SYNTHESIS_CHARS = 100_000;
export const DEFAULT_RUN_TOKEN_BUDGET = 200_000;
export const MAX_RUN_TOKEN_BUDGET = 5_000_000;
export const DEFAULT_RUN_MAX_CONCURRENCY = 3;

// The workers library — reusable agent definitions the coordinator assigns to plan tasks. Bounded because the
// whole library is handed to the coordinator as a roster in its prompt: a huge roster crowds out the goal itself.
export const MAX_WORKERS = 64;
export const MAX_RUN_WORKERS = 16;
export const MAX_WORKER_FILE_BYTES = 4 * 1024 * 1024;
export const MAX_WORKER_NAME_CHARS = 120;
export const MAX_WORKER_SPECIALTY_CHARS = 280;
export const MAX_WORKER_PROMPT_CHARS = 32_000;
// Ceiling for a granular allowlist. Comfortably above the ~30 built-in tool ids, with room for future toolsets.
export const MAX_WORKER_ALLOWED_TOOLS = 256;

export const MAX_RETAINED_CONVERSATIONS = 100;
export const MAX_CONVERSATION_FILE_BYTES = 32 * 1024 * 1024;
export const MAX_CONVERSATION_RECORD_BYTES = 4 * 1024 * 1024;
export const MAX_CONVERSATION_TIMELINE_ITEMS = 5_000;
export const MAX_CONVERSATION_MODEL_MESSAGES = 2_000;
