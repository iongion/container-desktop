import type { IconName } from "@blueprintjs/icons";
import type React from "react";

import type { Connector } from "@/container-client/types/connection";
import type { Container, ContainerStateList } from "@/container-client/types/container";
import type { ContainerImage } from "@/container-client/types/image";
import type { PodmanMachine } from "@/container-client/types/machine";
import type { Volume } from "@/container-client/types/volume";

export interface Domain {
  containers: Container[];
  images: ContainerImage[];
  machines: PodmanMachine[];
  volumes: Volume[];
}

// Domain

// Application types

export interface AppScreenProps {
  navigator: Navigator;
  footer?: React.ReactNode;
}
export interface AppScreenMetadata {
  ExcludeFromSidebar: boolean;
  WithoutSidebar: boolean;
  LeftIcon: any;
  RightIcon: any;
  // Sidebar hover tooltip (defaults to the Title when absent).
  Tooltip: string;
  RequiresProvisioning: boolean;
  RequiresConnection: boolean;
  // AI screens opt in with this flag. They are hidden from the sidebar and surfaced in
  // the header's AI menu instead (see screenVisibility.ts). AI is always on — this is not an access gate.
  RequiresAI: boolean;
}
export type AppScreen<AppScreenProps> = React.FunctionComponent<AppScreenProps> & {
  ID: string;
  Title: string;
  Route: {
    Path: string;
  };
  Metadata?: Partial<AppScreenMetadata>;
  isAvailable?: (currentConnector?: Connector) => boolean;
};

export interface ContainerGroup {
  Id: string; // uuid v4
  Name?: string;
  Items: Container[];
  Report: { [key in ContainerStateList]: number };
  Weight: number;
  Icon?: IconName;
}
