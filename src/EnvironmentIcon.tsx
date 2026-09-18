import { useState } from 'react';
import type { Loader, PublicConfig } from '../shared/types';
import { Cube } from './Artwork';

const loaderIcons: Record<Loader, string> = {
  fabric: 'fabric.png', forge: 'forge.png', neoforge: 'neoforge.png', quilt: 'quilt.svg',
};

export function minecraftIconType(version: string, type?: PublicConfig['minecraftVersionType']) {
  if (type === 'release' || type === 'snapshot') return type;
  // Legacy weekly snapshots, calendar-version snapshots, pre-releases and release candidates.
  return /^(?:\d{2}w\d{2}[a-z](?:[\w.-]*)?|\d+(?:\.\d+)+(?:[- ](?:snapshot|pre(?:-?release)?|rc|release candidate))[- .]?\d+)$/i.test(version.trim())
    ? 'snapshot' : 'release';
}

type Props = { kind: 'minecraft'; version: string; versionType?: PublicConfig['minecraftVersionType'] }
  | { kind: 'loader'; loader: Loader; version: string | null };

function IconImage({ src }: { src: string }) {
  const [broken, setBroken] = useState(false);
  return broken ? <Cube /> : <img src={src} alt="" draggable={false} onError={() => setBroken(true)} />;
}

export default function EnvironmentIcon(props: Props) {
  const file = props.kind === 'minecraft'
    ? `minecraft-${minecraftIconType(props.version, props.versionType)}.png`
    : loaderIcons[props.loader];
  return <span className={`environment-icon environment-icon-${props.kind}`} aria-hidden="true">
    <IconImage key={`${file}:${props.version}`} src={`/icons/${file}`} />
  </span>;
}
