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

export const modSides = ['both', 'server', 'client'] as const;
export type ModSide = typeof modSides[number];
export const modSideNames: Record<ModSide, string> = { both: '双端', server: '服务端', client: '客户端' };
// Where an automatic category came from; `manual` marks an administrator override.
export type ModCategorySource = 'manual' | 'version-environment' | 'project-environment' | 'legacy-fields' | 'location' | 'default';
export type ModBinding = 'bound' | 'unbound';
export type PublicMod = {
  id: string;
  name: string;
  description: string;
  version: string;
  iconUrl: string | null;
  projectUrl: string | null;
  side: ModSide;
};
export type AdminMod = PublicMod & {
  fileName: string;
  enabled: boolean;
  side: ModSide;
  categorySource: ModCategorySource;
  manualSide: ModSide | null;
  binding: ModBinding;
  projectId: string | null;
  downloadUrl: string | null;
  resolving: boolean;
  error: string | null;
};
export type PublicModList = { revision: number; mods: PublicMod[] };
export type AdminModList = { revision: number; mods: AdminMod[]; scanning: boolean; configured: boolean };
export type ModUpdate = { enabled?: boolean; side?: ModSide | null; projectId?: string | null; downloadUrl?: string | null };
