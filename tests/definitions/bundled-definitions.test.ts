import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {describe, expect, test} from 'bun:test';
import {
  isVIADefinitionV3,
  type KeyboardDictionary,
  type VIADefinitionV3,
} from '@the-via/reader';
import {
  EVO75_DEFINITION,
  EVO75_PRODUCT_ID,
  EVO75_VENDOR_ID,
  EVO75_VENDOR_PRODUCT_ID,
  getBundledDefinition,
  mergeBundledDefinitions,
  mergeBundledSupportedIds,
  resolveDefinitionWithBundledFallback,
} from '../../src/utils/bundled-definitions';
import type {VendorProductIdMap} from '../../src/types/types';

const SOURCE_SHA256 =
  'b829521d2d91e0dcd85cad2cd2f6504faf2c4d9402140e4e6ec521b4cd0cbd83';

describe('bundled EVO75 definition', () => {
  test('matches the verified vendor identity and source bytes', () => {
    const source = readFileSync(
      new URL('../../src/definitions/v3/917516574.json', import.meta.url),
      'utf8',
    ).replace(/\r?\n$/, '');

    expect(EVO75_VENDOR_PRODUCT_ID).toBe(
      EVO75_VENDOR_ID * 0x10000 + EVO75_PRODUCT_ID,
    );
    expect(EVO75_VENDOR_PRODUCT_ID).toBe(917516574);
    expect(createHash('sha256').update(source).digest('hex')).toBe(
      SOURCE_SHA256,
    );
  });

  test('is a valid V3 definition with the verified EVO75 geometry', () => {
    expect(isVIADefinitionV3(EVO75_DEFINITION)).toBe(true);
    expect(EVO75_DEFINITION).toMatchObject({
      name: 'EVO75',
      vendorProductId: EVO75_VENDOR_PRODUCT_ID,
      firmwareVersion: 0,
      matrix: {rows: 6, cols: 16},
    });
    expect(EVO75_DEFINITION.layouts.keys).toHaveLength(82);
    expect(EVO75_DEFINITION.customKeycodes).toHaveLength(25);
    expect(
      EVO75_DEFINITION.layouts.keys.filter(({li}) => li !== undefined),
    ).toHaveLength(0);

    const coordinates = EVO75_DEFINITION.layouts.keys.map(
      ({row, col}) => `${row},${col}`,
    );
    expect(new Set(coordinates).size).toBe(coordinates.length);
    expect(
      EVO75_DEFINITION.layouts.keys.every(
        ({row, col}) =>
          row >= 0 &&
          row < EVO75_DEFINITION.matrix.rows &&
          col >= 0 &&
          col < EVO75_DEFINITION.matrix.cols,
      ),
    ).toBe(true);
  });

  test('adds V3 support and resolves the definition when VIA lacks it', () => {
    const supported = mergeBundledSupportedIds({});
    const definitions = mergeBundledDefinitions({}, {});

    expect(supported[EVO75_VENDOR_PRODUCT_ID]).toEqual({
      v2: false,
      v3: true,
    });
    expect(definitions[EVO75_VENDOR_PRODUCT_ID].v3).toBe(EVO75_DEFINITION);
    expect(getBundledDefinition(EVO75_VENDOR_PRODUCT_ID, 'v3', {})).toBe(
      EVO75_DEFINITION,
    );
  });

  test('resolves locally without calling the remote loader', async () => {
    let remoteCalled = false;
    const resolution = await resolveDefinitionWithBundledFallback(
      EVO75_VENDOR_PRODUCT_ID,
      'v3',
      {},
      async () => {
        remoteCalled = true;
        throw new Error('must not be called');
      },
    );

    expect(remoteCalled).toBe(false);
    expect(resolution).toEqual({
      definition: EVO75_DEFINITION,
      source: 'bundled',
    });
  });

  test('does not mutate unrelated maps', () => {
    const unrelatedId = 123;
    const supported = {
      [unrelatedId]: {v2: true, v3: true},
    } satisfies VendorProductIdMap;
    const unrelatedDefinition = {
      ...EVO75_DEFINITION,
      name: 'Unrelated keyboard',
      vendorProductId: unrelatedId,
    } as VIADefinitionV3;
    const definitions = {
      [unrelatedId]: {v3: unrelatedDefinition},
    } as unknown as KeyboardDictionary;

    const mergedSupported = mergeBundledSupportedIds(supported);
    const mergedDefinitions = mergeBundledDefinitions(definitions, supported);

    expect(supported).toEqual({[unrelatedId]: {v2: true, v3: true}});
    expect(definitions[unrelatedId].v3).toBe(unrelatedDefinition);
    expect(mergedSupported[unrelatedId]).toEqual({v2: true, v3: true});
    expect(mergedDefinitions[unrelatedId].v3).toBe(unrelatedDefinition);
  });

  test('lets a future official V3 definition take priority', () => {
    const officialDefinition = {
      ...EVO75_DEFINITION,
      name: 'Official EVO75',
    } as VIADefinitionV3;
    const officialIds = {
      [EVO75_VENDOR_PRODUCT_ID]: {v2: false, v3: true},
    } satisfies VendorProductIdMap;
    const cachedDefinitions = {
      [EVO75_VENDOR_PRODUCT_ID]: {v3: officialDefinition},
    } as unknown as KeyboardDictionary;

    expect(
      getBundledDefinition(EVO75_VENDOR_PRODUCT_ID, 'v3', officialIds),
    ).toBeUndefined();
    expect(
      mergeBundledDefinitions(cachedDefinitions, officialIds)[
        EVO75_VENDOR_PRODUCT_ID
      ].v3,
    ).toBe(officialDefinition);
  });

  test('keeps an existing sideloaded definition ahead of the fallback', () => {
    const sideloadedDefinition = {
      ...EVO75_DEFINITION,
      name: 'Sideloaded EVO75',
    } as VIADefinitionV3;
    const definitions = {
      [EVO75_VENDOR_PRODUCT_ID]: {v3: sideloadedDefinition},
    } as unknown as KeyboardDictionary;

    expect(
      mergeBundledDefinitions(definitions, {})[EVO75_VENDOR_PRODUCT_ID].v3,
    ).toBe(sideloadedDefinition);
  });

  test('uses the fallback when an advertised definition cannot be loaded', async () => {
    const officialIds = {
      [EVO75_VENDOR_PRODUCT_ID]: {v2: false, v3: true},
    } satisfies VendorProductIdMap;
    const resolution = await resolveDefinitionWithBundledFallback(
      EVO75_VENDOR_PRODUCT_ID,
      'v3',
      officialIds,
      async () => {
        throw new Error('HTTP 404');
      },
    );

    expect(resolution).toEqual({
      definition: EVO75_DEFINITION,
      source: 'bundled-after-remote-failure',
    });
  });

  test('uses the fallback when an advertised definition is invalid', async () => {
    const officialIds = {
      [EVO75_VENDOR_PRODUCT_ID]: {v2: false, v3: true},
    } satisfies VendorProductIdMap;
    const resolution = await resolveDefinitionWithBundledFallback(
      EVO75_VENDOR_PRODUCT_ID,
      'v3',
      officialIds,
      async () => ({vendorProductId: EVO75_VENDOR_PRODUCT_ID}),
    );

    expect(resolution.source).toBe('bundled-after-remote-failure');
    expect(resolution.definition).toBe(EVO75_DEFINITION);
  });

  test('prefers a valid advertised definition over the fallback', async () => {
    const officialIds = {
      [EVO75_VENDOR_PRODUCT_ID]: {v2: false, v3: true},
    } satisfies VendorProductIdMap;
    const officialDefinition = {
      ...EVO75_DEFINITION,
      name: 'Official EVO75',
    } as VIADefinitionV3;
    const resolution = await resolveDefinitionWithBundledFallback(
      EVO75_VENDOR_PRODUCT_ID,
      'v3',
      officialIds,
      async () => officialDefinition,
    );

    expect(resolution).toEqual({
      definition: officialDefinition,
      source: 'remote',
    });
  });

  test('drops an invalid cached official definition so it can be reloaded', () => {
    const officialIds = {
      [EVO75_VENDOR_PRODUCT_ID]: {v2: false, v3: true},
    } satisfies VendorProductIdMap;
    const invalidCache = {
      [EVO75_VENDOR_PRODUCT_ID]: {
        v3: {vendorProductId: EVO75_VENDOR_PRODUCT_ID},
      },
    } as unknown as KeyboardDictionary;

    expect(
      mergeBundledDefinitions(invalidCache, officialIds)[
        EVO75_VENDOR_PRODUCT_ID
      ],
    ).toBeUndefined();
  });
});
