import React from 'react';
import { FaAws } from 'react-icons/fa';
import { LuContainer, LuBox, LuServer } from 'react-icons/lu';
import { SiKubernetes, SiGooglecloud } from 'react-icons/si';
import { VscAzure } from 'react-icons/vsc';

import { getProviderColor } from '../../utils/providers';
import eksLogo from '../../icons/providers/eks.svg?raw';
import kindLogo from '../../icons/providers/kind.svg?raw';
import minikubeLogo from '../../icons/providers/minikube.svg?raw';

type Props = {
  provider: string;
  size?: number;
};
// Plugin documents run at the host origin; inline assets avoid host-relative dev URLs.
const providerLogos: Record<string, string> = Object.fromEntries(
  Object.entries({ eks: eksLogo, kind: kindLogo, minikube: minikubeLogo })
    .map(([provider, svg]) => [provider, `data:image/svg+xml,${encodeURIComponent(svg)}`]),
);

const iconMap: Record<string, React.ComponentType<{ size?: number; color?: string }>> = {
  aws: FaAws,
  gcp: SiGooglecloud,
  azure: VscAzure,
  gke: SiGooglecloud,
  aks: VscAzure,
  'docker-desktop': LuContainer,
  k3d: LuBox,
  k3s: LuServer,
  rke2: LuServer,
  openshift: SiKubernetes,
  rancher: SiKubernetes,
  generic: SiKubernetes,
};

const ProviderIcon: React.FC<Props> = ({ provider, size = 18 }) => {
  const logo = providerLogos[provider];
  if (logo) return <img src={logo} width={size} height={size} alt="" aria-hidden="true" style={{ objectFit: 'contain', flexShrink: 0 }} />;
  const Icon = iconMap[provider] ?? SiKubernetes;
  const color = getProviderColor(provider);
  return <Icon size={size} color={color} />;
};

export default ProviderIcon;
