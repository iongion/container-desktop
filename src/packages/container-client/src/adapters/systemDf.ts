// adapters/systemDf.ts — image disk usage over GET /system/df. Docker and libpod return different shapes
// (docker: LayersSize + Images[].Size/SharedSize/Containers; libpod: ImagesSize + Images[].UniqueSize/Containers);
// summarizeSystemDf normalizes both to the canonical SystemDf. "Reclaimable" = unique bytes of images that no
// container references. Pure summarizer → unit-tested against real captured shapes.

import type { SystemDf } from "@/container-client/types/system";
import { createLogger } from "@/logger";
import { ResourceAdapter } from "./shared";

const logger = createLogger("client.systemDf");

export function emptySystemDf(): SystemDf {
  return { imagesSize: 0, imagesReclaimable: 0, imagesCount: 0, reclaimableCount: 0 };
}

export function summarizeSystemDf(raw: any, isDocker: boolean): SystemDf {
  const images = Array.isArray(raw?.Images) ? raw.Images : [];
  let sumUnique = 0;
  let reclaimable = 0;
  let reclaimableCount = 0;
  for (const image of images) {
    const inUse = Number(image?.Containers ?? 0) > 0;
    const rawUnique = isDocker
      ? Number(image?.Size ?? 0) - Number(image?.SharedSize ?? 0)
      : Number(image?.UniqueSize ?? 0);
    const unique = Number.isFinite(rawUnique) ? Math.max(0, rawUnique) : 0;
    sumUnique += unique;
    if (!inUse) {
      reclaimable += unique;
      reclaimableCount += 1;
    }
  }
  const declared = Number(isDocker ? raw?.LayersSize : raw?.ImagesSize);
  const imagesSize = Number.isFinite(declared) && declared > 0 ? declared : sumUnique;
  return { imagesSize, imagesReclaimable: reclaimable, imagesCount: images.length, reclaimableCount };
}

export class SystemDfAdapter extends ResourceAdapter {
  async get(): Promise<SystemDf> {
    try {
      const driver = await this.driver();
      const result = await driver.get<any>("/system/df", { baseURL: this.baseURL });
      return summarizeSystemDf(result.data, this.usesDockerApi);
    } catch (error: any) {
      logger.error("Unable to fetch disk usage", error);
      return emptySystemDf();
    }
  }
}
