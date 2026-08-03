// OMA's root module links its provider fallbacks even when every app agent injects our AI-SDK adapter. These
// bindings keep those unreachable adapters linkable without shipping a second provider SDK stack.
class UnavailableOptionalProvider {
  constructor() {
    throw new Error("OMA optional provider adapters are disabled; inject the app AI-SDK adapter instead");
  }
}

export default class OpenAI extends UnavailableOptionalProvider {}

export class AzureOpenAI extends UnavailableOptionalProvider {}

export class Anthropic extends UnavailableOptionalProvider {}

export class GoogleGenAI extends UnavailableOptionalProvider {}

export const FunctionCallingConfigMode = { AUTO: "AUTO" } as const;

export class BedrockRuntimeClient extends UnavailableOptionalProvider {}

export class ConverseCommand extends UnavailableOptionalProvider {}

export class ConverseStreamCommand extends UnavailableOptionalProvider {}
