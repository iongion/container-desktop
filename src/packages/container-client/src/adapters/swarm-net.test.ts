import { describe, expect, it } from "vitest";

import { parseHostAddresses } from "./swarm-net";

describe("parseHostAddresses", () => {
  it("parses real `ip -o -4 addr show scope global` output (iface + IPv4)", () => {
    const output = [
      "3: enp4s0    inet 192.168.0.29/24 brd 192.168.0.255 scope global dynamic noprefixroute enp4s0\\       valid_lft 604799sec preferred_lft 604799sec",
      "5: wg0    inet 10.99.97.9/24 scope global wg0\\       valid_lft forever preferred_lft forever",
      "6: virbr0    inet 192.168.122.1/24 brd 192.168.122.255 scope global virbr0\\       valid_lft forever preferred_lft forever",
    ].join("\n");
    expect(parseHostAddresses(output)).toEqual([
      { iface: "enp4s0", address: "192.168.0.29" },
      { iface: "wg0", address: "10.99.97.9" },
      { iface: "virbr0", address: "192.168.122.1" },
    ]);
  });

  it("parses the mock two-NIC output", () => {
    const output =
      "2: eth0    inet 10.0.2.15/24 brd 10.0.2.255 scope global eth0\\       valid_lft forever preferred_lft forever\n" +
      "3: eth1    inet 192.168.64.1/24 brd 192.168.64.255 scope global eth1\\       valid_lft forever preferred_lft forever";
    expect(parseHostAddresses(output)).toEqual([
      { iface: "eth0", address: "10.0.2.15" },
      { iface: "eth1", address: "192.168.64.1" },
    ]);
  });

  it("drops loopback and de-dupes", () => {
    const output = [
      "1: lo    inet 127.0.0.1/8 scope host lo",
      "2: eth0    inet 10.0.0.5/24 scope global eth0",
      "2: eth0    inet 10.0.0.5/24 scope global eth0",
    ].join("\n");
    expect(parseHostAddresses(output)).toEqual([{ iface: "eth0", address: "10.0.0.5" }]);
  });

  it("returns [] for empty / non-matching input", () => {
    expect(parseHostAddresses("")).toEqual([]);
    expect(parseHostAddresses(undefined)).toEqual([]);
    expect(parseHostAddresses("Device not found\n")).toEqual([]);
  });
});
