import { IconName } from "@blueprintjs/icons";
import React from "react";

import { Connector, Container, ContainerImage, ContainerStateList, PodmanMachine, Volume } from "@/env/Types";

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
}
export interface AppScreenMetadata {
  ExcludeFromSidebar: boolean;
  WithoutSidebar: boolean;
  LeftIcon: any;
  RightIcon: any;
  RequiresProvisioning: boolean;
  RequiresConnection: boolean;
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
