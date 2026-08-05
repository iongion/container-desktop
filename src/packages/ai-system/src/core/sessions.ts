// What a conversation looks like to the app's UI.
//
// A pi session IS one conversation, held inside the container, so there is no durable session record here any more:
// the record, its checkpoints, its lineage, its compactions and the file they were persisted to went with the in-app
// engine that wrote them. What survives is the summary the transcript, the export drawer and the session store
// render. Access and reasoning are not on it: a session is started with them and they cannot be changed afterwards.

import type { z } from "zod";

import type { sessionSummarySchema } from "./schemas";

export type SessionSummary = z.infer<typeof sessionSummarySchema>;
