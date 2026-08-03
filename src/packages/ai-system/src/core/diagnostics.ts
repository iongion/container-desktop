import type { EncryptionStatus } from "@/host-contract/capabilities";
import type { ProviderKind } from "./providers";

export type AIDiagnosticState = "ok" | "warning" | "error" | "unavailable";

export interface AIProviderDiagnostic {
  id: string;
  kind: ProviderKind;
  model: string;
  destination: "local" | "cloud";
  credential: "not-required" | "stored" | "missing";
  reachability: "reachable" | "unreachable" | "not-checked";
  modelCount?: number;
  message?: string;
}

export interface AIRecordedError {
  at: number;
  message: string;
  context?: string;
}

export interface AIDiagnosticsSnapshot {
  capturedAt: number;
  provider: AIProviderDiagnostic;
  security: {
    encryption: EncryptionStatus;
    permissions: "ok" | "missing" | "error" | "unavailable";
    webSearch: "enabled" | "disabled" | "unavailable";
  };
  capabilities: {
    agentSessions: boolean;
    teamRuns: boolean;
    sandbox: boolean;
    containerTools: boolean;
    workspaceTools: boolean;
    executionTargets: boolean;
  };
  extensions: {
    skills: { state: AIDiagnosticState; count: number; diagnostics: number };
    mcp: { state: "unavailable" };
  };
  recentErrors: AIRecordedError[];
}
