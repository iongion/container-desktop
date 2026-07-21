export interface SecurityVulnerability {
  Severity: string;
  Published: string;
  Description: string;
  VulnerabilityID: string;
  PrimaryURL: string;
  PkgName?: string;
  InstalledVersion?: string;
  // injected
  guid: string;
}

export interface SecurityReportResultGroup {
  Class: string;
  Target: string;
  Type: string;
  Vulnerabilities: SecurityVulnerability[];
  // injected
  guid: string;
}

export interface SecurityReportResult {
  Results: SecurityReportResultGroup[];
}

export interface SecurityReport {
  provider: string;
  status: "success" | "failure";
  fault?: {
    details: string;
    error: string;
  };
  result?: SecurityReportResult;
  scanner: {
    database: {
      Version: string;
      VulnerabilityDB: {
        DownloadedAt: string;
        NextUpdate: string;
        UpdatedAt: string;
        Version: any;
      };
    };
    name: string;
    path: string;
    version: string;
  };
  counts: {
    CRITICAL: number;
    HIGH: number;
    MEDIUM: number;
    LOW: number;
  };
}

///
