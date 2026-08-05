# Assistant command catalogue

<!-- Generated from commandCatalog.ts. Update the registry, then regenerate this document. -->

Registry revision: `builtin-v12`

| Command | Aliases | Description | Arguments | Bypass tier | Availability | Confirmation |
| --- | --- | --- | --- | --- | --- | --- |
| `/help` | `/h` | Find an available command | [query] | `immediate-ui` | `always` | `none` |
| `/skills` | — | Open the skill library | — | `immediate-ui` | `always` | `none` |
| `/reload` | — | Reload keybindings, extensions, skills, prompts, themes, and context files | — | `side-effect-free` | `always` | `none` |
| `/tokens` | — | Inspect context and token usage | — | `immediate-ui` | `session` | `none` |
| `/tools` | — | Inspect effective tools | — | `immediate-ui` | `session` | `none` |
| `/doctor` | `/status` | Check AI system health | — | `immediate-ui` | `always` | `none` |
| `/changes status` | `/changes` | Inspect workspace changes | — | `immediate-ui` | `always` | `none` |
| `/changes diff` | `/diff` | Review the full workspace diff | — | `immediate-ui` | `always` | `none` |
| `/memory list` | `/memory` | Open Project Memory | — | `immediate-ui` | `always` | `none` |
| `/memory add` | `/remember` | Prepare a Project Memory entry | <text> | `immediate-ui` | `always` | `none` |
| `/memory remove` | — | Find a Project Memory entry to remove | <id> | `immediate-ui` | `always` | `none` |
| `/memory clear` | — | Review Project Memory before clearing it | — | `immediate-ui` | `always` | `none` |
| `/rules list` | `/rules` | Open Project Rules | — | `immediate-ui` | `always` | `none` |
| `/rules init` | `/init` | Prepare Project Rules initialization | — | `immediate-ui` | `always` | `none` |
| `/new` | — | Start a new session | — | `queued` | `idle` | `none` |
| `/quit` | — | Stop the session | — | `queued` | `always` | `required` |
| `/session` | — | Show session info and stats | — | `immediate-ui` | `session` | `none` |
| `/stop` | — | Stop the active turn | — | `always` | `session-active` | `none` |
| `/copy` | — | Copy last agent message to clipboard | — | `side-effect-free` | `session` | `none` |
| `/export` | — | Export session (HTML default, or specify path: .html/.jsonl) | — | `immediate-ui` | `session` | `none` |
| `/import` | — | Import and resume a session from a JSONL file | — | `queued` | `session-idle` | `none` |
| `/share` | — | Share the session as one standalone HTML file | — | `immediate-ui` | `session` | `none` |
| `/login` | — | Configure provider authentication | — | `immediate-ui` | `always` | `none` |
| `/logout` | — | Remove provider authentication | — | `immediate-ui` | `always` | `required` |
| `/model` | — | Select model (opens selector UI) | <provider/model> | `immediate-ui` | `session-idle-only` | `none` |
| `/permissions` | — | Open AI permissions settings | — | `immediate-ui` | `always` | `none` |
