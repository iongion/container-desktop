import type { ProgramOutput } from "./host";

export enum PodStatusList {
  CREATED = "Created",
  ERROR = "Error",
  EXITED = "Exited",
  PAUSED = "Paused",
  RUNNING = "Running",
  DEGRADED = "Degraded",
  STOPPED = "Stopped",
  DEAD = "Dead",
}

export type PodContainer = any;

export interface PodProcessReport {
  Processes: string[];
  Titles: string[];
}

export interface Pod {
  Cgroup: string;
  Created: string;
  Id: string;
  InfraId: string;
  Labels: { [key: string]: string };
  Name: string;
  NameSpace: string;
  Networks: string[];
  Status: PodStatusList;
  Pid: string;
  NumContainers: number;
  Containers: PodContainer[];
  // computed
  Processes: PodProcessReport;
  Kube?: string;
  Logs?: ProgramOutput;
}
