import { IconNames } from "@blueprintjs/icons";
import { mdiNetwork } from "@mdi/js";
import type React from "react";
import { isValidElement } from "react";
import { describe, expect, it } from "vitest";

import { getContainerCrumbs } from "@/web-app/screens/Container/Navigation";
import { getSwarmCrumbs } from "@/web-app/screens/Swarm/Navigation";
import { getVolumeCrumbs } from "@/web-app/screens/Volume/Navigation";
import { crumb, type RootCrumbId, rootCrumb } from "./crumbs";

describe("rootCrumb", () => {
  it("builds a root crumb with a translatable label, sidebar icon, and a list href carrying connId", () => {
    const c = rootCrumb("containers", "c1");
    expect(c.textKey).toBe("Containers");
    expect(c.icon).toBe(IconNames.CUBE);
    expect(c.href).toContain("#/screens/containers");
    expect(c.href).toContain("connId=c1");
    expect(c.current).toBeFalsy();
  });

  it("omits the connId query when no connection is given", () => {
    const c = rootCrumb("images");
    expect(c.textKey).toBe("Images");
    expect(c.href).toContain("#/screens/images");
    expect(c.href).not.toContain("connId");
  });

  it("uses the sidebar icon for every entity root", () => {
    const sidebarIcons: Array<[RootCrumbId, unknown]> = [
      ["containers", IconNames.CUBE],
      ["images", IconNames.BOX],
      ["pods", IconNames.CUBE_ADD],
      ["machines", IconNames.HEAT_GRID],
      ["volumes", IconNames.DATABASE],
      ["secrets", IconNames.KEY],
      ["swarm", IconNames.LAYERS],
    ];

    for (const [rootId, icon] of sidebarIcons) {
      expect(rootCrumb(rootId).icon).toBe(icon);
    }

    const networkIcon = rootCrumb("networks").icon;
    expect(isValidElement(networkIcon)).toBe(true);
    expect((networkIcon as React.ReactElement<{ path: string }>).props.path).toBe(mdiNetwork);
  });

  it("resolves the networks root to its list crumb", () => {
    const c = rootCrumb("networks");
    expect(c.textKey).toBe("Networks");
    expect(c.href).toContain("#/screens/networks");
  });
});

describe("crumb", () => {
  it("passes a literal current leaf through without a textKey (resource names are never translated)", () => {
    const c = crumb({ text: "nginx-proxy", current: true });
    expect(c).toEqual({ text: "nginx-proxy", current: true });
    expect(c.textKey).toBeUndefined();
  });
});

describe("getContainerCrumbs", () => {
  it("default/inspect view: leads with the owning connection, resource name is the current leaf (Connection > Containers > name)", () => {
    const trail = getContainerCrumbs("nginx", "abc", "container.inspect", "c1");
    expect(trail).toHaveLength(3);
    expect(trail[0].connectionId).toBe("c1");
    expect(trail[0].href).toContain("#/screens/connections/c1/connection-info");
    expect(trail[1].textKey).toBe("Containers");
    expect(trail[1].href).toContain("connId=c1");
    expect(trail[2]).toEqual({ text: "nginx", current: true });
  });

  it("sub-tab view: name links to inspect and the tab is the current leaf (Connection > Containers > name > Logs)", () => {
    const trail = getContainerCrumbs("nginx", "abc", "container.logs", "c1");
    expect(trail).toHaveLength(4);
    expect(trail[0].connectionId).toBe("c1");
    expect(trail[1].textKey).toBe("Containers");
    expect(trail[2].text).toBe("nginx");
    expect(trail[2].href).toContain("/screens/container/abc/inspect");
    expect(trail[2].href).toContain("connId=c1");
    expect(trail[2].current).toBeFalsy();
    expect(trail[3]).toEqual({ textKey: "Logs", current: true });
  });
});

describe("getVolumeCrumbs (single-view entity)", () => {
  it("is [Connection, Volumes, name(current)] with the resource name as the current leaf", () => {
    const trail = getVolumeCrumbs("pgdata", "c1");
    expect(trail).toHaveLength(3);
    expect(trail[0].connectionId).toBe("c1");
    expect(trail[0].href).toContain("#/screens/connections/c1/connection-info");
    expect(trail[1].textKey).toBe("Volumes");
    expect(trail[1].href).toContain("connId=c1");
    expect(trail[2]).toEqual({ text: "pgdata", current: true });
  });
});

describe("getSwarmCrumbs", () => {
  it("service: [Connection, Swarm, Services (links to tab), name(current)]", () => {
    const trail = getSwarmCrumbs("services", "shop_web", "c1");
    expect(trail).toHaveLength(4);
    expect(trail[0].connectionId).toBe("c1");
    expect(trail[1].textKey).toBe("Swarm");
    expect(trail[2].textKey).toBe("Services");
    expect(trail[2].href).toContain("/screens/swarm");
    expect(trail[2].href).toContain("tab=services");
    expect(trail[2].href).toContain("connId=c1");
    expect(trail[3]).toEqual({ text: "shop_web", current: true });
  });

  it("stack: the kind crumb is Stacks and links to the stacks tab", () => {
    const trail = getSwarmCrumbs("stacks", "shop", "c1");
    expect(trail[1].textKey).toBe("Swarm");
    expect(trail[2].textKey).toBe("Stacks");
    expect(trail[2].href).toContain("tab=stacks");
    expect(trail[3]).toEqual({ text: "shop", current: true });
  });
});
