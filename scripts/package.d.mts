export interface PackagedExtension {
  path: string;
  digest: string;
  addonId: string;
  version: string;
  files: string[];
}

export function packageExtension(source?: string, output?: string): Promise<PackagedExtension>;
