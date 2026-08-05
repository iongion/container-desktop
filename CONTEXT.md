# Container Desktop AI

The AI context provides conversational assistance and coordinated execution against container environments and
workspaces.

## Language

**Thread**:
A durable, resumable, and branchable conversation record between the user and the Assistant.
_Avoid_: Chat, Conversation, Agent Session, chat run

**Agent Session**:
The live agent runtime processing work for one Thread.
_Avoid_: Thread, Chat, Conversation

**Execution Target**:
The concrete environment where a Thread runs tools and owns workspace state.
_Avoid_: connection, workspace, host

**Access Profile**:
A named upper bound on the tools an Agent Session may receive. It limits capability independently of approvals or
Execution Target.
_Avoid_: permission mode, approval policy, tool preset

**Approval Mode**:
The user preference governing whether an available gated operation asks for confirmation or may reuse a valid
Permission Decision.
_Avoid_: Access Profile, permission scope

**Permission Decision**:
A host-owned allow or reject verdict scoped to a concrete workspace, Execution Target, operation, arguments, and
content-trust epoch, with external-server identity when relevant.
_Avoid_: permission mode, blanket approval

**Content Trust**:
The authority and taint classification of context injected into an Agent Session. It may invalidate remembered
Permission Decisions but never widens available tools.
_Avoid_: Access Profile, extension approval

**Extension Trust**:
The host-owned decision that a fingerprinted Skill or future extension definition may be loaded. It never grants
permission for the operations that extension requests.
_Avoid_: tool approval, Content Trust

**Reasoning Level**:
A Thread-owned, provider-supported choice for model reasoning effort. It changes model behavior without changing
tool availability, approval, or Execution Target.
_Avoid_: model, permission level

**Workspace Change Set**:
A bounded Git status or diff observation tied to one workspace and one Execution Target.
_Avoid_: host changes, global changes

**Branch**:
A new Thread derived from an immutable message boundary in another Thread. It inherits conversation context but
no active or pending runtime authority.
_Avoid_: rewind, rollback, clone

**Checkpoint**:
An immutable message boundary that identifies a coherent conversation state within a Thread. It does not imply
that container, filesystem, remote, or external-service state can be restored.
_Avoid_: environment snapshot, rollback point

**Slash Command**:
A deterministic user instruction that controls the Assistant application without becoming a model message or tool.
_Avoid_: Command, prompt, tool command

**Skill**:
A reusable prompt-backed workflow explicitly invoked within a Thread.
_Avoid_: Slash Command, plugin

**Plugin**:
A pi package the Agent Session loads: extensions, commands, skills and prompts it contributes.
_Avoid_: extension, add-on, tool
