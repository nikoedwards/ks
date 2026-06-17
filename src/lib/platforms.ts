export const PLATFORM_IDS = [
  'kickstarter',
  'indiegogo',
  'makuake',
  'gamefound',
  'campfire',
  'zeczec',
  'wadiz',
] as const;

export type PlatformId = typeof PLATFORM_IDS[number];
export type PlatformViewId = 'global' | PlatformId;
export type PlatformStatus = 'legacy_active' | 'source_active' | 'planned';
export type PlatformRegion = 'global' | 'us' | 'jp' | 'tw' | 'kr' | 'eu';

export interface PlatformCapabilities {
  isolatedDb: boolean;
  globalAggregation: boolean;
  manualInit: boolean;
  crawlerImplemented: boolean;
  importImplemented: boolean;
  exportImplemented: boolean;
  liveTracking: boolean;
}

export interface PlatformDefinition {
  id: PlatformId;
  label: string;
  shortLabel: string;
  region: PlatformRegion;
  status: PlatformStatus;
  priority: number;
  samplePlatform: boolean;
  capabilities: PlatformCapabilities;
}

const plannedCapabilities: PlatformCapabilities = {
  isolatedDb: true,
  globalAggregation: true,
  manualInit: true,
  crawlerImplemented: false,
  importImplemented: false,
  exportImplemented: false,
  liveTracking: false,
};

const indiegogoCapabilities: PlatformCapabilities = {
  isolatedDb: true,
  globalAggregation: false,
  manualInit: true,
  crawlerImplemented: true,
  importImplemented: true,
  exportImplemented: false,
  liveTracking: true,
};

export const PLATFORMS: readonly PlatformDefinition[] = [
  {
    id: 'kickstarter',
    label: 'Kickstarter',
    shortLabel: 'KS',
    region: 'global',
    status: 'legacy_active',
    priority: 0,
    samplePlatform: false,
    capabilities: {
      isolatedDb: false,
      globalAggregation: true,
      manualInit: false,
      crawlerImplemented: true,
      importImplemented: true,
      exportImplemented: true,
      liveTracking: true,
    },
  },
  { id: 'indiegogo', label: 'Indiegogo', shortLabel: 'IGG', region: 'global', status: 'source_active', priority: 1, samplePlatform: false, capabilities: indiegogoCapabilities },
  { id: 'makuake', label: 'Makuake', shortLabel: 'MK', region: 'jp', status: 'planned', priority: 2, samplePlatform: false, capabilities: plannedCapabilities },
  { id: 'gamefound', label: 'Gamefound', shortLabel: 'GF', region: 'eu', status: 'planned', priority: 3, samplePlatform: false, capabilities: plannedCapabilities },
  { id: 'campfire', label: 'CAMPFIRE', shortLabel: 'CF', region: 'jp', status: 'planned', priority: 4, samplePlatform: false, capabilities: plannedCapabilities },
  { id: 'zeczec', label: 'zeczec 嘖嘖', shortLabel: 'ZZ', region: 'tw', status: 'planned', priority: 5, samplePlatform: false, capabilities: plannedCapabilities },
  { id: 'wadiz', label: 'Wadiz', shortLabel: 'WZ', region: 'kr', status: 'planned', priority: 6, samplePlatform: false, capabilities: plannedCapabilities },
] as const;

export const PLATFORM_VIEWS: readonly { id: PlatformViewId; label: string; shortLabel: string; status: 'aggregate' | PlatformStatus; region: PlatformRegion }[] = [
  { id: 'global', label: 'Global', shortLabel: 'ALL', status: 'aggregate', region: 'global' },
  ...PLATFORMS.map(platform => ({
    id: platform.id,
    label: platform.label,
    shortLabel: platform.shortLabel,
    status: platform.status,
    region: platform.region,
  })),
] as const;

export function isPlatformId(value: string): value is PlatformId {
  return (PLATFORM_IDS as readonly string[]).includes(value);
}

export function isPlatformViewId(value: string): value is PlatformViewId {
  return value === 'global' || isPlatformId(value);
}

export function getPlatformDefinition(id: PlatformId): PlatformDefinition {
  const platform = PLATFORMS.find(item => item.id === id);
  if (!platform) throw new Error(`Unknown platform: ${id}`);
  return platform;
}
