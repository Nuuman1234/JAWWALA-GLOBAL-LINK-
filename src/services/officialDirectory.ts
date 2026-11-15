import rawDirectory from '../data/official_pu_directory.json';
import type { OfficialDirectoryDataset, OfficialPuSeed, OfficialWardSeed } from '../types/fdmis';

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
