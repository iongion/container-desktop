// What a conversation looks like to the app's UI.
//
// A pi session IS one conversation, held inside the container, so there is no durable thread record here any more:
// the record, its checkpoints, its lineage, its compactions and the file they were persisted to went with the in-app
// engine that wrote them. What survives is the summary the transcript, the export drawer and the session store
// render, and the configuration patch the composer's bindings are typed by.

import type { z } from "zod";

import type { AccessProfileId } from "./accessProfiles";
import type { ReasoningLevel } from "./reasoning";
import type { threadSummarySchema } from "./schemas";

export type ThreadSummary = z.infer<typeof threadSummarySchema>;

export interface ThreadConfigurationPatch {
  accessProfile?: AccessProfileId;
  reasoningLevel?: ReasoningLevel;
}
