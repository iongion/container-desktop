# Assistant command catalogue

<!-- Generated from commandCatalog.ts. Update the registry, then regenerate this document. -->

Registry revision: `builtin-v8`

| Command | Aliases | Description | Arguments | Bypass tier | Availability | Confirmation |
| --- | --- | --- | --- | --- | --- | --- |
| `/help` | `/h` | Find an available command | [query] | `immediate-ui` | `always` | `none` |
| `/skills` | — | Open the skill library | — | `immediate-ui` | `always` | `none` |
| `/reload` | — | Reload skills from disk | — | `side-effect-free` | `always` | `none` |
| `/tokens` | `/context` | Inspect context and token usage | — | `immediate-ui` | `thread` | `none` |
| `/tools` | — | Inspect effective tools | — | `immediate-ui` | `thread` | `none` |
| `/doctor` | `/status` | Check AI system health | — | `immediate-ui` | `always` | `none` |
| `/changes status` | `/changes` | Inspect workspace changes | — | `immediate-ui` | `always` | `none` |
| `/changes diff` | `/diff` | Review the full workspace diff | — | `immediate-ui` | `always` | `none` |
| `/memory list` | `/memory` | Open Project Memory | — | `immediate-ui` | `always` | `none` |
| `/memory add` | `/remember` | Prepare a Project Memory entry | <text> | `immediate-ui` | `always` | `none` |
| `/memory remove` | — | Find a Project Memory entry to remove | <id> | `immediate-ui` | `always` | `none` |
| `/memory clear` | — | Review Project Memory before clearing it | — | `immediate-ui` | `always` | `none` |
| `/rules list` | `/rules` | Open Project Rules | — | `immediate-ui` | `always` | `none` |
| `/rules init` | `/init` | Prepare Project Rules initialization | — | `immediate-ui` | `always` | `none` |
| `/thread list` | `/thread`, `/threads`, `/session`, `/session list`, `/sessions`, `/resume` | Open Thread history | — | `immediate-ui` | `always` | `none` |
| `/thread new` | `/session new`, `/clear`, `/cls` | Start a new Thread | — | `queued` | `idle` | `none` |
| `/thread switch` | `/session switch` | Switch to a Thread | <id-or-title> | `queued` | `idle` | `none` |
| `/thread rename` | `/session rename` | Rename the current Thread | <title> | `queued` | `thread-idle` | `none` |
| `/thread branch` | `/session fork`, `/branch`, `/fork` | Branch from a Thread checkpoint | [checkpoint] | `immediate-ui` | `thread` | `none` |
| `/thread compact` | `/compact`, `/offload` | Compact earlier Thread context | [instructions] | `immediate-ui` | `thread-idle-only` | `none` |
| `/thread delete` | `/session delete` | Delete a Thread | [id-or-title] | `queued` | `thread-idle` | `required` |
| `/thread stop` | `/session stop` | Stop the active Thread turn | — | `always` | `thread-active` | `none` |
| `/copy` | — | Copy the latest Assistant response | — | `side-effect-free` | `thread` | `none` |
| `/export` | — | Export this Thread | — | `immediate-ui` | `thread` | `none` |
| `/model` | — | Choose the inference model | — | `immediate-ui` | `thread-idle-only` | `none` |
| `/access` | `/security` | Choose the Assistant access profile | [observe\|workspace\|operator] | `immediate-ui` | `thread-idle-only` | `none` |
| `/reasoning` | `/effort`, `/thinking`, `/think` | Choose the Thread reasoning level | [default\|low\|medium\|high] | `immediate-ui` | `thread-idle-only` | `none` |
| `/permissions` | — | Open AI permissions settings | — | `immediate-ui` | `always` | `none` |
| `/worker list` | `/workers`, `/agents` | Open the Worker library | — | `immediate-ui` | `always` | `none` |
| `/worker show` | `/worker open` | Find a Worker | <id-or-name> | `immediate-ui` | `always` | `none` |
| `/worker create` | — | Create a Worker | — | `immediate-ui` | `always` | `none` |
| `/run start` | `/plan` | Start a Team Run | <goal> | `queued` | `idle` | `none` |
| `/run list` | — | Open Runs | — | `immediate-ui` | `always` | `none` |
| `/run show` | — | Open an exact Run | <id-or-goal> | `immediate-ui` | `always` | `none` |
| `/run stop` | — | Stop an exact Run | <id-or-goal> | `always` | `always` | `required` |
