export const loaders = ['fabric', 'forge', 'neoforge', 'quilt'] as const;
export type Loader = typeof loaders[number];
export const loaderNames: Record<Loader, string> = {
  fabric: 'Fabric', forge: 'Forge', neoforge: 'NeoForge', quilt: 'Quilt',
};
export type PanelConfig = {
  modsDirectory: string;
  minecraftVersion: string;
  loader: Loader;
  loaderVersion: string | null;
};
export type PublicConfig = Omit<PanelConfig, 'modsDirectory'>;
export type AuthStatus = { registered: boolean; authenticated: boolean; configured: boolean };
export type DirectoryListing = {
  path: string;
  entries: { name: string; type: 'file' | 'directory' | 'link' | 'other' }[];
};
export type VersionOption = { id: string; type?: string };
export type VersionList = { versions: VersionOption[]; stale?: boolean };
