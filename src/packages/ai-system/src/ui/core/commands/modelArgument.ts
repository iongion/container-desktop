// pi's `/model <provider/model>`, resolved against the session that is running.
//
// pi lists every provider it has configured, so a pi user names one. Here there is exactly one: the gateway container
// holds a single upstream and a single credential, so a prefix can only be that source — and anything else is part of
// the model id itself. That matters because an aggregator's ids CONTAIN slashes
// (`anthropic/claude-3.5-sonnet`): splitting on the first one would rename half of OpenRouter.

export function modelFromCommandArgument(argument: string, sessionProviderId: string): string {
  const typed = argument.trim();
  const prefix = `${sessionProviderId}/`;
  return typed.startsWith(prefix) ? typed.slice(prefix.length) : typed;
}
