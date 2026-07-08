import { Icon, type IconName } from "@blueprintjs/core";
import { Fragment } from "react";
import { useTranslation } from "react-i18next";

import type { ReachabilityHop } from "@/container-client/reachability/model";

// ChainPipe — the reachability trace pipeline: fixed-width hops left→right, arrows colored by the transition,
// the break highlighted. SSH-remote hops (hop.remote) nest inside a dashed "remote host" wrapper — the port
// lives on the remote host, not the laptop. Ported from the locked mockup (.scratch/port-dns-debugger).

type ArrowState = "ok" | "warn" | "dead";

// The arrow leaving a hop degrades to dead when the next hop was never reached, warn when leaving a warned hop.
const arrowState = (from: ReachabilityHop, to: ReachabilityHop): ArrowState => {
  if (to.state === "dead") {
    return "dead";
  }
  if (from.state === "warn") {
    return "warn";
  }
  return "ok";
};

const dotTone = (state: ReachabilityHop["state"]): string =>
  state === "err" ? "err" : state === "warn" ? "warn" : state === "dead" ? "idle" : "ok";

function HopCell({ hop }: { hop: ReachabilityHop }) {
  const className = [
    "hop",
    hop.state === "err" ? "err" : hop.state === "warn" ? "warn" : hop.state === "dead" ? "dead" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={className}>
      <span className={`dot ${dotTone(hop.state)} hstate`} />
      <div className="hicon">
        <Icon icon={hop.icon as IconName} />
      </div>
      <div className="hname">{hop.name}</div>
      {hop.meta ? <div className="hmeta">{hop.meta}</div> : null}
    </div>
  );
}

function Arrow({ state }: { state: ArrowState }) {
  return <div className={state === "ok" ? "arrow" : `arrow ${state}`} />;
}

// A run of hops with interleaved, transition-colored arrows.
function HopSequence({ hops }: { hops: ReachabilityHop[] }) {
  return (
    <>
      {hops.map((hop, index) => (
        <Fragment key={hop.id}>
          {index > 0 ? <Arrow state={arrowState(hops[index - 1], hop)} /> : null}
          <HopCell hop={hop} />
        </Fragment>
      ))}
    </>
  );
}

export function ChainPipe({ hops, remoteLabel }: { hops: ReachabilityHop[]; remoteLabel?: string }) {
  const { t } = useTranslation();
  const firstRemote = hops.findIndex((hop) => hop.remote);
  if (firstRemote < 0) {
    return (
      <div className="ChainPipe">
        <HopSequence hops={hops} />
      </div>
    );
  }
  const leading = hops.slice(0, firstRemote);
  const remote = hops.slice(firstRemote);
  return (
    <div className="ChainPipe">
      <HopSequence hops={leading} />
      {leading.length > 0 ? <Arrow state={arrowState(leading[leading.length - 1], remote[0])} /> : null}
      <div className="remoteWrap">
        <span className="rtag">{remoteLabel ?? t("remote host")}</span>
        <HopSequence hops={remote} />
      </div>
    </div>
  );
}
