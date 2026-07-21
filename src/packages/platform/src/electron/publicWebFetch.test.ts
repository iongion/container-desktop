import { describe, expect, it } from "vitest";

import { createPinnedLookup } from "./publicWebFetch";

function lookup(addresses: string[], family: number, all = false): Promise<unknown> {
  return new Promise((resolve, reject) => {
    createPinnedLookup(addresses)("ignored.example", { family, all }, (error, address, selectedFamily) => {
      if (error) reject(error);
      else resolve(all ? address : { address, family: selectedFamily });
    });
  });
}

describe("createPinnedLookup", () => {
  it("returns only addresses from the validated set and respects the requested family", async () => {
    const addresses = ["93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946"];

    await expect(lookup(addresses, 4)).resolves.toEqual({ address: "93.184.216.34", family: 4 });
    await expect(lookup(addresses, 6)).resolves.toEqual({
      address: "2606:2800:220:1:248:1893:25c8:1946",
      family: 6,
    });
    await expect(lookup(addresses, 0, true)).resolves.toEqual([
      { address: "93.184.216.34", family: 4 },
      { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
    ]);
  });
});
