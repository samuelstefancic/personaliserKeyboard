import {
  isVIADefinitionV2,
  isVIADefinitionV3,
  type DefinitionVersion,
  type DefinitionVersionMap,
  type KeyboardDictionary,
  type VIADefinitionV3,
} from '@the-via/reader';
import evo75DefinitionJson from '../definitions/v3/917516574.json';
import type {VendorProductIdMap} from '../types/types';

export const EVO75_VENDOR_ID = 0x36b0;
export const EVO75_PRODUCT_ID = 0x311e;
export const EVO75_VENDOR_PRODUCT_ID =
  EVO75_VENDOR_ID * 0x10000 + EVO75_PRODUCT_ID;

const untrustedEvo75Definition: unknown = evo75DefinitionJson;

if (!isVIADefinitionV3(untrustedEvo75Definition)) {
  throw new Error(
    'The bundled EVO75 definition is not a valid VIA V3 definition',
  );
}

if (untrustedEvo75Definition.vendorProductId !== EVO75_VENDOR_PRODUCT_ID) {
  throw new Error('The bundled EVO75 definition does not match 0x36B0:0x311E');
}

export const EVO75_DEFINITION: VIADefinitionV3 = untrustedEvo75Definition;

type BundledDefinitionDictionary = Readonly<
  Record<number, Partial<DefinitionVersionMap>>
>;

const BUNDLED_DEFINITIONS: BundledDefinitionDictionary = {
  [EVO75_VENDOR_PRODUCT_ID]: {v3: EVO75_DEFINITION},
};

const DEFINITION_VERSIONS = ['v2', 'v3'] as const;

const isOfficiallySupported = (
  officialIds: VendorProductIdMap,
  vendorProductId: number,
  version: DefinitionVersion,
) => Boolean(officialIds[vendorProductId]?.[version]);

export const getBundledFallbackDefinition = <Version extends DefinitionVersion>(
  vendorProductId: number,
  version: Version,
): DefinitionVersionMap[Version] | undefined =>
  BUNDLED_DEFINITIONS[vendorProductId]?.[version] as
    | DefinitionVersionMap[Version]
    | undefined;

/**
 * Adds local fallback IDs without changing the index returned by VIA.
 */
export const mergeBundledSupportedIds = (
  officialIds: VendorProductIdMap,
): VendorProductIdMap => {
  const merged = Object.fromEntries(
    Object.entries(officialIds).map(([id, versions]) => [id, {...versions}]),
  ) as VendorProductIdMap;

  for (const [id, definitionMap] of Object.entries(BUNDLED_DEFINITIONS)) {
    const vendorProductId = Number(id);
    const current = merged[vendorProductId] ?? {v2: false, v3: false};
    merged[vendorProductId] = {
      v2: Boolean(current.v2 || definitionMap.v2),
      v3: Boolean(current.v3 || definitionMap.v3),
    };
  }

  return merged;
};

/**
 * Returns a bundled definition only while the official index lacks that exact
 * version. This lets a future VIA definition supersede the local fallback.
 */
export const getBundledDefinition = <Version extends DefinitionVersion>(
  vendorProductId: number,
  version: Version,
  officialIds: VendorProductIdMap,
): DefinitionVersionMap[Version] | undefined => {
  if (isOfficiallySupported(officialIds, vendorProductId, version)) {
    return undefined;
  }

  return getBundledFallbackDefinition(vendorProductId, version);
};

type DefinitionResolution<Version extends DefinitionVersion> = Readonly<{
  definition: DefinitionVersionMap[Version];
  source: 'bundled' | 'remote' | 'bundled-after-remote-failure';
}>;

const isMatchingDefinition = <Version extends DefinitionVersion>(
  definition: unknown,
  vendorProductId: number,
  version: Version,
): definition is DefinitionVersionMap[Version] => {
  if (version === 'v3') {
    return (
      isVIADefinitionV3(definition) &&
      definition.vendorProductId === vendorProductId
    );
  }
  return (
    isVIADefinitionV2(definition) &&
    definition.vendorProductId === vendorProductId
  );
};

/**
 * Resolves a definition without trusting an index entry more than the actual
 * asset. The local fallback is used immediately while the official index lacks
 * the version, or after an advertised remote asset fails validation/loading.
 */
export const resolveDefinitionWithBundledFallback = async <
  Version extends DefinitionVersion,
>(
  vendorProductId: number,
  version: Version,
  officialIds: VendorProductIdMap,
  loadRemote: () => Promise<unknown>,
): Promise<DefinitionResolution<Version>> => {
  const fallback = getBundledFallbackDefinition(vendorProductId, version);
  if (
    fallback &&
    !isOfficiallySupported(officialIds, vendorProductId, version)
  ) {
    return {definition: fallback, source: 'bundled'};
  }

  try {
    const remote = await loadRemote();
    if (fallback && !isMatchingDefinition(remote, vendorProductId, version)) {
      throw new Error('The advertised definition is invalid or mismatched');
    }
    return {
      definition: remote as DefinitionVersionMap[Version],
      source: 'remote',
    };
  } catch (error) {
    if (fallback) {
      return {
        definition: fallback,
        source: 'bundled-after-remote-failure',
      };
    }
    throw error;
  }
};

/**
 * Overlays missing local definitions onto the browser cache without mutating
 * it. Definitions advertised by VIA always retain priority.
 */
export const mergeBundledDefinitions = (
  definitions: KeyboardDictionary,
  officialIds: VendorProductIdMap,
): KeyboardDictionary => {
  const merged = {...definitions};

  for (const id of Object.keys(BUNDLED_DEFINITIONS)) {
    const vendorProductId = Number(id);
    for (const version of DEFINITION_VERSIONS) {
      const existingDefinition = merged[vendorProductId]?.[version];
      if (
        existingDefinition &&
        !isMatchingDefinition(existingDefinition, vendorProductId, version)
      ) {
        const validVersions: Partial<DefinitionVersionMap> = {
          ...merged[vendorProductId],
        };
        delete validVersions[version];
        if (Object.keys(validVersions).length) {
          merged[vendorProductId] = validVersions as DefinitionVersionMap;
        } else {
          delete merged[vendorProductId];
        }
      }

      const definition = getBundledDefinition(
        vendorProductId,
        version,
        officialIds,
      );
      if (definition && !merged[vendorProductId]?.[version]) {
        merged[vendorProductId] = {
          ...merged[vendorProductId],
          [version]: definition,
        } as DefinitionVersionMap;
      }
    }
  }

  return merged;
};
