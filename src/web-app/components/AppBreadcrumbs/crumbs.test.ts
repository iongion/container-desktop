import { describe, expect, it } from "vitest";

import { getContainerCrumbs } from "@/web-app/screens/Container/Navigation";
import { getSwarmCrumbs } from "@/web-app/screens/Swarm/Navigation";
import { getVolumeCrumbs } from "@/web-app/screens/Volume/Navigation";
import { crumb, rootCrumb } from "./crumbs";

describe("rootCrumb", () => {
  it("builds a root crumb with a translatable label and a list href carrying connId", () => {
    const c = rootCrumb("containers", "c1");
    expect(c.textKey).toBe("Containers");
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

  it("resolves the networks root to a text-only crumb", () => {
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
  it("default/inspect view: the resource name is the current leaf (Containers > name)", () => {
    const trail = getContainerCrumbs("nginx", "abc", "container.inspect", "c1");
    expect(trail).toHaveLength(2);
    expect(trail[0].textKey).toBe("Containers");
    expect(trail[0].href).toContain("connId=c1");
    expect(trail[1]).toEqual({ text: "nginx", current: true });
  });

  it("sub-tab view: name links to inspect and the tab is the current leaf (Containers > name > Logs)", () => {
    const trail = getContainerCrumbs("nginx", "abc", "container.logs", "c1");
    expect(trail).toHaveLength(3);
    expect(trail[1].text).toBe("nginx");
    expect(trail[1].href).toContain("/screens/container/abc/inspect");
    expect(trail[1].href).toContain("connId=c1");
    expect(trail[1].current).toBeFalsy();
    expect(trail[2]).toEqual({ textKey: "Logs", current: true });
  });
});

describe("getVolumeCrumbs (single-view entity)", () => {
  it("is [Volumes, name(current)] with the resource name as the current leaf", () => {
    const trail = getVolumeCrumbs("pgdata", "c1");
    expect(trail).toHaveLength(2);
    expect(trail[0].textKey).toBe("Volumes");
    expect(trail[0].href).toContain("connId=c1");
    expect(trail[1]).toEqual({ text: "pgdata", current: true });
  });
});

describe("getSwarmCrumbs", () => {
  it("service: [Swarm, Services (links to tab), name(current)]", () => {
    const trail = getSwarmCrumbs("services", "shop_web", "c1");
    expect(trail).toHaveLength(3);
    expect(trail[0].textKey).toBe("Swarm");
    expect(trail[1].textKey).toBe("Services");
    expect(trail[1].href).toContain("/screens/swarm");
    expect(trail[1].href).toContain("tab=services");
    expect(trail[1].href).toContain("connId=c1");
    expect(trail[2]).toEqual({ text: "shop_web", current: true });
  });

  it("stack: the middle crumb is Stacks and links to the stacks tab", () => {
    const trail = getSwarmCrumbs("stacks", "shop", "c1");
    expect(trail[1].textKey).toBe("Stacks");
    expect(trail[1].href).toContain("tab=stacks");
    expect(trail[2]).toEqual({ text: "shop", current: true });
  });
});
