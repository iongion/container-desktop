import type { ReachabilityDiagnosis } from "@/container-client/reachability/model";

import type { FleetConnection, FleetSummary } from "./fleet";
import type { SubnetOverlap } from "./subnets";
import type { VerdictLevel } from "./verdict";

// Per-connection issue aggregation for the cockpit: turns the runtime verdict + detected subnet overlaps into
// Diagnosis stripes (reusing the node-free ReachabilityDiagnosis shape), folds them back into an effective
// verdict level (issues downgrade a healthy connection to "degraded"), and serializes the whole fleet for the
// header's "Copy diagnostics". Pure → unit-tested.

export interface FleetEntry {
  card: FleetConnection;
  level: VerdictLevel;
  diagnoses: ReachabilityDiagnosis[];
}

export function buildDiagnoses(card: FleetConnection, overlaps: SubnetOverlap[]): ReachabilityDiagnosis[] {
  const diagnoses: ReachabilityDiagnosis[] = [];
  if (card.verdict.level === "unreachable") {
    diagnoses.push({
      tone: "err",
      icon: "error",
      headline: `\`${card.name}\` is unreachable`,
      explanation: card.verdict.reasons[0] || "The engine API did not respond.",
      actions: [
        { id: "connections", icon: "data-connection", text: "Open Connections", href: "#/screens/connections" },
      ],
      learnMore: true,
    });
  }
  for (const overlap of overlaps) {
    diagnoses.push({
      tone: "warn",
      icon: "warning-sign",
      headline: `Subnet overlap — \`${overlap.a}\` collides with \`${overlap.b}\``,
      explanation: `Both use \`${overlap.cidr}\`, so cross-network container reachability is unreliable. Re-create one network on a free subnet.`,
      fixCommand: `${card.engine} network rm ${overlap.a}`,
      actions: [{ id: "networks", icon: "graph", text: "Open Networks", href: "#/screens/networks" }],
      learnMore: true,
    });
  }
  return diagnoses;
}

// Issues never make a running engine "unreachable" (that's a transport verdict); they only downgrade a healthy
// connection to "degraded". A transitional/unreachable base level is preserved.
export function foldLevel(base: VerdictLevel, diagnoses: ReachabilityDiagnosis[]): VerdictLevel {
  if (base !== "healthy") {
    return base;
  }
  return diagnoses.length > 0 ? "degraded" : "healthy";
}

export function summarizeEntries(entries: FleetEntry[]): FleetSummary {
  const summary: FleetSummary = { healthy: 0, degraded: 0, unreachable: 0, total: entries.length };
  for (const entry of entries) {
    summary[entry.level] += 1;
  }
  return summary;
}

// A plain-text, paste-anywhere snapshot of the whole fleet's health for the header's "Copy diagnostics" button.
export function serializeDiagnostics(entries: FleetEntry[]): string {
  const summary = summarizeEntries(entries);
  const lines: string[] = [
    `Engine Health — ${summary.total} connection(s): ${summary.healthy} healthy, ${summary.degraded} degraded, ${summary.unreachable} unreachable`,
    "",
  ];
  for (const { card, level, diagnoses } of entries) {
    lines.push(`## ${card.name} — ${card.subtitle}`);
    lines.push(`verdict: ${level}${card.version ? ` · ${card.version}` : ""}`);
    for (const reason of card.verdict.reasons) {
      lines.push(`  - ${reason}`);
    }
    for (const diagnosis of diagnoses) {
      lines.push(`  ! ${diagnosis.headline.replace(/`/g, "")}`);
      if (diagnosis.fixCommand) {
        lines.push(`    fix: ${diagnosis.fixCommand}`);
      }
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}
