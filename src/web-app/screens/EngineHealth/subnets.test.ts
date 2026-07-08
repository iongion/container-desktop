import { describe, expect, it } from "vitest";

import { findSubnetOverlaps } from "./subnets";

const net = (name: string, ...subnets: string[]) => ({ name, subnets });

describe("findSubnetOverlaps", () => {
  it("flags two networks sharing the same /24", () => {
    const overlaps = findSubnetOverlaps([
      net("myapp_default", "10.89.0.0/24"),
      net("dev-net", "10.89.0.0/24"),
      net("podman", "10.88.0.0/16"),
    ]);
    expect(overlaps).toHaveLength(1);
    expect([overlaps[0].a, overlaps[0].b].sort()).toEqual(["dev-net", "myapp_default"]);
    expect(overlaps[0].cidr).toContain("10.89.0.0/24");
  });

  it("flags a subset (/24 inside /16)", () => {
    expect(findSubnetOverlaps([net("a", "10.89.0.0/16"), net("b", "10.89.5.0/24")])).toHaveLength(1);
  });

  it("does not flag disjoint or adjacent subnets", () => {
    expect(findSubnetOverlaps([net("a", "10.89.0.0/24"), net("b", "10.90.0.0/24")])).toHaveLength(0);
    expect(findSubnetOverlaps([net("a", "10.89.0.0/24"), net("b", "10.89.1.0/24")])).toHaveLength(0);
  });

  it("never flags ipv4 against ipv6", () => {
    expect(findSubnetOverlaps([net("a", "10.0.0.0/8"), net("b", "fd00::/8")])).toHaveLength(0);
  });

  it("detects an ipv6 overlap", () => {
    expect(findSubnetOverlaps([net("a", "fd00::/16"), net("b", "fd00::/32")])).toHaveLength(1);
  });

  it("ignores malformed CIDRs without crashing", () => {
    expect(findSubnetOverlaps([net("a", "not-a-cidr"), net("b", "10.0.0.0/24"), net("c", "10.0.0.0/33")])).toHaveLength(
      0,
    );
  });

  it("does not flag a network against its own second subnet", () => {
    expect(findSubnetOverlaps([net("a", "10.0.0.0/24", "10.0.0.0/16")])).toHaveLength(0);
  });

  it("reports each network pair once even with multiple overlapping subnets", () => {
    const overlaps = findSubnetOverlaps([
      net("a", "10.0.0.0/24", "10.1.0.0/24"),
      net("b", "10.0.0.0/24", "10.1.0.0/24"),
    ]);
    expect(overlaps).toHaveLength(1);
  });
});
