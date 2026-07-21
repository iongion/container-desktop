import type { ContainerInspect } from "./container";
import { Registry } from "./registry";

export interface ContainerImageHistory {
  id: string;
  created: string;
  Created: string;
  CreatedBy: string;
  Size: number;
  Comment: string;
}

export interface ContainerImage {
  Containers: number;
  Created: number;
  CreatedAt: string;
  Digest: string;
  History: ContainerImageHistory[]; // custom field
  Id: string;
  Labels: {
    maintainer: string;
  } | null;
  Names: string[];
  NamesHistory?: string[];
  ParentId: string;
  RepoTags?: string[];
  SharedSize: number;
  Size: number;
  VirtualSize: number;
  // computed
  Name: string;
  Tag: string;
  Registry: string;
  FullName: string;
  // from detail
  Config: ContainerInspect;
  // Docker specific
  RepoDigests?: string[];
}

export interface ContainerImagePortMapping {
  guid: string;
  container_port: number;
  host_ip: string;
  host_port: number;
  protocol: "tcp" | "udp" | "sdp";
}

export interface ContainerImageMount {
  driver: "local";
  device?: string;
  type: "bind" | "tmpfs" | "volume" | "image" | "devpts";
  source?: string;
  destination: string;
  access?: "rw" | "ro";
  size?: number;
}

export const MOUNT_TYPES = ["bind", "tmpfs", "volume", "image", "devpts"];
