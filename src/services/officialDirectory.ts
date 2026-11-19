import rawDirectory from '../data/official_pu_directory.json';
import {
  LGA_DEFINITIONS,
  type LgaId,
  type LocationCatalogLga,
  type LocationCatalogPuItem,
  type LocationCatalogWardItem,
  type OfficialDirectoryDataset,
  type OfficialPuSeed,
  type OfficialWardSeed,
} from '../types/fdmis';

const dataset = rawDirectory as OfficialDirectoryDataset;

export function toValidDocId(raw: string): string {
  return raw.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
}

export function getWardDocId(lgaId: string, wardCode: string): string {
  return toValidDocId(`${lgaId}_${wardCode}`);
}

export function getPuDocId(puCode: string): string {
  return toValidDocId(puCode);
}

export function getOfficialDirectoryDataset(): OfficialDirectoryDataset {
  return dataset;
}

export function sortLocationCatalog(items: LocationCatalogLga[]): LocationCatalogLga[] {
  const order: Record<string, number> = { funtua: 0, dandume: 1 };
  return [...items].sort((a, b) => (order[a.lgaId] ?? 9) - (order[b.lgaId] ?? 9));
}

let cachedBundledCatalog: LocationCatalogLga[] | null = null;

export function buildBundledLocationCatalog(): LocationCatalogLga[] {
  if (cachedBundledCatalog) return cachedBundledCatalog;

  const lgas: LgaId[] = ['funtua', 'dandume'];
  const built: LocationCatalogLga[] = lgas.map((lgaId) => {
    const lgaDef = LGA_DEFINITIONS[lgaId];
    const wards: LocationCatalogWardItem[] = dataset.wards
      .filter((w: OfficialWardSeed) => w.lgaId === lgaId)
      .map((w: OfficialWardSeed) => ({
        id: getWardDocId(w.lgaId, w.wardCode),
        wardCode: w.wardCode,
        name: w.name,
      }))
      .sort((a, b) => a.wardCode.localeCompare(b.wardCode) || a.name.localeCompare(b.name));

    const pollingUnits: LocationCatalogPuItem[] = dataset.pollingUnits
      .filter((p: OfficialPuSeed) => p.lgaId === lgaId)
      .map((p: OfficialPuSeed) => ({
        id: getPuDocId(p.puCode),
        wardId: getWardDocId(p.lgaId, p.wardCode),
        wardName: p.wardName,
        puCode: p.puCode,
        name: p.name,
      }))
      .sort(
        (a, b) =>
          a.wardName.localeCompare(b.wardName) ||
          a.puCode.localeCompare(b.puCode) ||
          a.name.localeCompare(b.name)
      );

    return {
      lgaId,
      lgaName: lgaDef.displayName,
      lgaCode: lgaDef.lgaCode,
      wards,
      pollingUnits,
      wardCount: wards.length,
      puCount: pollingUnits.length,
      updatedByUid: 'bundled_official_directory',
    };
  });

  cachedBundledCatalog = built;
  return built;
}

export function isLocationSelectionValidInCatalog(
  catalog: LocationCatalogLga[],
  selection: { lgaId: string; wardId: string; puId: string; puCode?: string }
): boolean {
  if (!selection.lgaId || !selection.wardId || !selection.puId) return false;
  const searchPool = catalog.length > 0 ? catalog : buildBundledLocationCatalog();
  const lga = searchPool.find((l) => l.lgaId === selection.lgaId);
  if (!lga) return false;

  const ward = lga.wards.find((w) => w.id === selection.wardId);
  if (!ward) return false;

  const pu = lga.pollingUnits.find(
    (p) => p.id === selection.puId && p.wardId === ward.id
  );
  if (!pu) return false;
  if (selection.puCode && pu.puCode !== selection.puCode) return false;

  return true;
}

export interface DirectoryValidationResult {
  isValid: boolean;
  wardCount: number;
  puCount: number;
  funtuaPuCount: number;
  dandumePuCount: number;
  errors: string[];
}

export function validateOfficialDirectory(
  data: OfficialDirectoryDataset = dataset
): DirectoryValidationResult {
  const errors: string[] = [];
  const wardKeys = new Set<string>();
  const puCodes = new Set<string>();

  for (const ward of data.wards) {
    const key = `${ward.lgaId}:${ward.wardCode}`;
    if (wardKeys.has(key)) {
      errors.push(`Duplicate ward code detected: ${key}`);
    }
    wardKeys.add(key);
  }

  for (const pu of data.pollingUnits) {
    if (puCodes.has(pu.puCode)) {
      errors.push(`Duplicate polling unit code detected: ${pu.puCode}`);
    }
    puCodes.add(pu.puCode);
  }

  const funtuaWards = data.wards.filter((w: OfficialWardSeed) => w.lgaId === 'funtua').length;
  const dandumeWards = data.wards.filter((w: OfficialWardSeed) => w.lgaId === 'dandume').length;
  const funtuaPus = data.pollingUnits.filter((p: OfficialPuSeed) => p.lgaId === 'funtua').length;
  const dandumePus = data.pollingUnits.filter((p: OfficialPuSeed) => p.lgaId === 'dandume').length;

  if (funtuaWards !== 11) errors.push(`Expected 11 Funtua wards, got ${funtuaWards}`);
  if (dandumeWards !== 11) errors.push(`Expected 11 Dandume wards, got ${dandumeWards}`);
  if (funtuaPus !== 298) errors.push(`Expected 298 Funtua polling units, got ${funtuaPus}`);
  if (dandumePus !== 177) errors.push(`Expected 177 Dandume polling units, got ${dandumePus}`);

  return {
    isValid: errors.length === 0,
    wardCount: data.wards.length,
    puCount: data.pollingUnits.length,
    funtuaPuCount: funtuaPus,
    dandumePuCount: dandumePus,
    errors,
  };
}
