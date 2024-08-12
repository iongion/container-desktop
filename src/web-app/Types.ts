// vendors
import React from "react";
// project
import { ApplicationDescriptor, Container, ContainerImage, Machine, Volume } from "./Types.container-app";

export enum Environments {
  DEVELOPMENT = "development",
  PRODUCTION = "production"
}

export interface Domain {
  containers: Container[];
  images: ContainerImage[];
  machines: Machine[];
  volumes: Volume[];
}

export enum Features {
  polling = "polling"
}
export interface Feature {
  enabled: boolean;
  opts?: any;
}

export type FeaturesMap = {
  [key in Features]?: Feature;
};

export interface EnvironmentSettings {
  api: {
    baseUrl: string;
  };
  poll: {
    rate: number;
  };
}

export interface Environment {
  name: Environments;
  features: FeaturesMap;
  settings: EnvironmentSettings;
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
  isAvailable?: (context: ApplicationDescriptor) => boolean;
};
