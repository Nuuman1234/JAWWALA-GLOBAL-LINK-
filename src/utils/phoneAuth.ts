import type { UserAccount } from '../types/fdmis';

export const PBKDF2_ALGORITHM_LABEL = 'PBKDF2-SHA256-100K' as const;
const PBKDF2_ITERATIONS = 100_000;
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export interface NormalizedPhoneResult {
  valid: boolean;
  e164: string;
  digits: string;
  phoneKey: string;
  syntheticEmail: string;
  maskedPhone: string;
  error?: string;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/[^0-9a-fA-F]/g, '');
  const len = Math.floor(clean.length / 2);
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function getSubtleCrypto(): SubtleCrypto {
  const cryptoObj = globalThis.crypto;
  if (!cryptoObj || !cryptoObj.subtle) {
    throw new Error('Secure Web Crypto API is unavailable in this runtime.');
  }
  return cryptoObj.subtle;
}

export function generateRandomSaltHex(byteLength = 16): string {
  const bytes = new Uint8Array(byteLength);
  globalThis.crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

export async function sha256Hex(input: string): Promise<string> {
  const subtle = getSubtleCrypto();
  const encoded = new TextEncoder().encode(input);
  const digest = await subtle.digest('SHA-256', encoded);
  return bytesToHex(new Uint8Array(digest));
}

export async function hashSecretPBKDF2(
  secret: string,
  providedSaltHex?: string
): Promise<{ hashHex: string; saltHex: string; algorithm: typeof PBKDF2_ALGORITHM_LABEL }> {
  const subtle = getSubtleCrypto();
  const saltHex = providedSaltHex || generateRandomSaltHex(16);
  const saltBytes = hexToBytes(saltHex);
  const secretBytes = new TextEncoder().encode(secret);

  const keyMaterial = await subtle.importKey(
    'raw',
    secretBytes,
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );

  const derivedBits = await subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBytes.buffer as ArrayBuffer,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  );

  return {
    hashHex: bytesToHex(new Uint8Array(derivedBits)),
    saltHex,
    algorithm: PBKDF2_ALGORITHM_LABEL,
  };
}

export async function verifySecretPBKDF2(
  secret: string,
  saltHex: string,
  expectedHashHex: string
): Promise<boolean> {
  if (!saltHex || !expectedHashHex) return false;
  const computed = await hashSecretPBKDF2(secret, saltHex);
  if (computed.hashHex.length !== expectedHashHex.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.hashHex.length; i += 1) {
    diff |= computed.hashHex.charCodeAt(i) ^ expectedHashHex.charCodeAt(i);
  }
  return diff === 0;
}

export function normalizePhoneNumber(rawInput: string): NormalizedPhoneResult {
  const trimmed = rawInput.trim();
  const invalidBase: NormalizedPhoneResult = {
    valid: false,
    e164: '',
    digits: '',
    phoneKey: '',
    syntheticEmail: '',
    maskedPhone: '',
  };

  if (!trimmed) {
    return { ...invalidBase, error: 'Phone number is required.' };
  }

  if (/[a-zA-Z]/.test(trimmed)) {
    return { ...invalidBase, error: 'Phone number must contain digits only (plus optional leading +).' };
  }

  const stripped = trimmed.replace(/[\s\-().]/g, '');
  if (!/^\+?\d+$/.test(stripped)) {
    return { ...invalidBase, error: 'Enter a valid phone number.' };
  }

  let digits = stripped.startsWith('+') ? stripped.slice(1) : stripped;

  // Normalize common Nigerian formats: 080..., 80..., 23480..., +23480...
  if (/^0[789][01]\d{8}$/.test(digits)) {
    digits = `234${digits.slice(1)}`;
  } else if (/^[789][01]\d{8}$/.test(digits)) {
    digits = `234${digits}`;
  } else if (/^2340[789][01]\d{8}$/.test(digits)) {
    digits = `234${digits.slice(4)}`;
  } else if (!stripped.startsWith('+') && digits.startsWith('0') && digits.length === 11) {
    digits = `234${digits.slice(1)}`;
  }

  if (digits.length < 10 || digits.length > 15) {
    return {
      ...invalidBase,
      error: 'Phone number must be 10 to 15 digits (e.g. 0803 123 4567 or +2348031234567).',
    };
  }

  const e164 = `+${digits}`;
  const maskedPhone = `${e164.slice(0, 4)}••••${e164.slice(-4)}`;

  return {
    valid: true,
    e164,
    digits,
    phoneKey: `ph_${digits}`,
    syntheticEmail: getSyntheticEmailForPhoneDigits(digits, 0),
    maskedPhone,
  };
}

export function getSyntheticEmailForPhoneDigits(digits: string, authSeq = 0): string {
  const safeDigits = digits.replace(/\D/g, '');
  if (authSeq > 0) {
    return `ph_${safeDigits}.r${Math.floor(authSeq)}@fdmis.local`;
  }
  return `ph_${safeDigits}@fdmis.local`;
}

export async function computePhoneBlindHash(digits: string): Promise<string> {
  const safeDigits = digits.replace(/\D/g, '');
  return sha256Hex(`fdmis:phone:v1:${safeDigits}`);
}

export async function computeUidBlindHash(uid: string): Promise<string> {
  return sha256Hex(`fdmis:uid:v1:${uid.trim()}`);
}

export function generateRecoveryKey(): string {
  const bytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(bytes);
  const chars = Array.from(bytes, (b) => RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length]);
  return `FDM-${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}-${chars.slice(8, 12).join('')}`;
}

export function normalizeRecoveryKey(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, '');
}

export function generateResetPin(): string {
  const bytes = new Uint8Array(6);
  globalThis.crypto.getRandomValues(bytes);
  const chars = Array.from(bytes, (b) => RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length]);
  return `RST-${chars.join('')}`;
}

export function validatePasswordStrength(password: string): string | null {
  if (!password) return 'Password is required.';
  if (password.length < 8) return 'Password must be at least 8 characters.';
  if (password.length > 128) return 'Password must not exceed 128 characters.';
  if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) {
    return 'Password must include at least one letter and one number.';
  }
  return null;
}

export function validateRegistrationInputs(input: {
  fullName: string;
  phone: string;
  password: string;
  confirmPassword: string;
  lgaId: string;
  wardId: string;
  pollingUnitId: string;
}): string | null {
  const cleanName = input.fullName.trim();
  if (cleanName.length < 2) {
    return 'Full Name must be at least 2 characters.';
  }
  if (cleanName.length > 110) {
    return 'Full Name must not exceed 110 characters.';
  }

  const normalizedPhone = normalizePhoneNumber(input.phone);
  if (!normalizedPhone.valid) {
    return normalizedPhone.error || 'Enter a valid phone number.';
  }

  const passwordIssue = validatePasswordStrength(input.password);
  if (passwordIssue) return passwordIssue;

  if (input.password !== input.confirmPassword) {
    return 'Password and Confirm Password do not match.';
  }

  if (!input.lgaId.trim()) {
    return 'Select a Local Government Area from the synchronized directory.';
  }
  if (!input.wardId.trim()) {
    return 'Select a Ward for the chosen LGA.';
  }
  if (!input.pollingUnitId.trim()) {
    return 'Select a Polling Unit for the chosen Ward.';
  }

  return null;
}

export function formatAccountIdentifier(
  account: Pick<UserAccount, 'email' | 'phone' | 'authMethod'> | null | undefined
): string {
  if (!account) return '';
  if (account.authMethod === 'PHONE_PASSWORD' || account.email.endsWith('@fdmis.local')) {
    return account.phone || account.email.replace('@fdmis.local', '');
  }
  return account.email || account.phone || '';
}
