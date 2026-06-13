// adapters/images.ts — image REST operations over the active HostClient driver.
// Endpoints/params lifted byte-for-byte from the legacy API client (348-419). Images use the
// driver's default (per-connection) baseURL — no per-call libpod/docker override, matching the source.

import type { ContainerImage, ContainerImageHistory } from "@/env/Types";

import { ResourceAdapter } from "./shared";

export interface FetchImageOptions {
  Id: string;
  withHistory?: boolean;
  withKube?: boolean;
}

export interface PushImageOptions {
  destination?: string;
  tlsVerify?: boolean;
  registryAuth?: string;
}

export class ImagesAdapter extends ResourceAdapter {
  async history(id: string): Promise<ContainerImageHistory[]> {
    const driver = await this.driver();
    const result = await driver.get<ContainerImageHistory[]>(`/images/${id}/history`);
    if (this.isOk(result)) {
      return result.data;
    }
    return [];
  }

  async list(): Promise<ContainerImage[]> {
    const driver = await this.driver();
    const result = await driver.get<ContainerImage[]>("/images/json");
    return this.isOk(result) ? result.data.map((it) => this.normalizers.normalizeImage(it)) : [];
  }

  async get(id: string, opts?: FetchImageOptions): Promise<ContainerImage | undefined> {
    const driver = await this.driver();
    const params = new URLSearchParams();
    const result = await driver.get<ContainerImage>(`/images/${id}/json`, {
      params,
    });
    if (this.isOk(result)) {
      const image = this.normalizers.normalizeImage(result.data);
      if (opts?.withHistory) {
        try {
          image.History = await this.history(id);
        } catch (error: any) {
          console.error("Unable to fetch image history", error);
          image.History = [];
        }
      }
      return image;
    }
    return undefined;
  }

  async remove(id: string): Promise<boolean> {
    const driver = await this.driver();
    const result = await driver.delete<boolean>(`/images/${id}`);
    return this.isOk(result);
  }

  async pull(name: string): Promise<boolean> {
    const driver = await this.driver();
    const result = await driver.post<boolean>("/images/pull", undefined, {
      params: {
        reference: name,
      },
    });
    return this.isOk(result);
  }

  async push(id: string, opts?: PushImageOptions): Promise<boolean> {
    const driver = await this.driver();
    const params: { [key: string]: string } = {};
    if (opts) {
      if (opts.destination) {
        params.destination = opts.destination;
      }
      if (opts.tlsVerify === false) {
        // NOTE: "tslVerify" is a typo for "tlsVerify" in the source — preserved byte-for-byte; flagged for a deliberate fix.
        params.tslVerify = "false";
      }
    }
    const result = await driver.post<boolean>(`/images/${encodeURIComponent(id)}/push`, undefined, {
      params,
    });
    return this.isOk(result);
  }
}
