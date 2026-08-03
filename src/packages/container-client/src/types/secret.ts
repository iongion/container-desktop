export interface SecretSpecDriverOptionsMap {
  [key: string]: string;
}

export interface SecretSpecDriver {
  Name: string;
  Options: SecretSpecDriverOptionsMap;
}

export interface SecretSpec {
  Driver: SecretSpecDriver;
  Name: string;
}

export interface Secret {
  ID: string;
  Spec: SecretSpec;
  CreatedAt: string;
  UpdatedAt: string;
}
