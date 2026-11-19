import type { Timestamp } from 'firebase/firestore';

export type LgaId = 'funtua' | 'dandume';

export interface LgaDefinition {
  id: LgaId;
  displayName: string;
  shortName: string;
  lgaCode: string;
  expectedWards: number;
  expectedPollingUnits: number;
}

export const LGA_DEFINITIONS: Record<LgaId, LgaDefinition> = {
  funtua: {
    id: 'funtua',
    displayName: 'Funtua LGA',
    shortName: 'Funtua',
    lgaCode: '20-14',
    expectedWards: 11,
    expectedPollingUnits: 298,
  },
  dandume: {
    id: 'dandume',
    displayName: 'Dandume LGA',
    shortName: 'Dandume',
    lgaCode: '20/07',
    expectedWards: 11,
    expectedPollingUnits: 177,
  },
};

export const TOTAL_EXPECTED_WARDS = 22;
export const TOTAL_EXPECTED_POLLING_UNITS = 475;

// --- OFFICIAL WHATSAPP SITUATION ROOM GROUP ---
export const DEFAULT_WHATSAPP_GROUP_NAME = 'Situation Room 2027';
export const DEFAULT_WHATSAPP_GROUP_URL =
  'https://chat.whatsapp.com/D8G1GP8EFP22FrdEtFG0mb?s=cl&p=a&iam=2';

// --- FIXED POLITICAL PARTIES (STRICTLY 4 PARTIES — IMMUTABLE) ---
export type PartyCode = 'APC' | 'PDP' | 'ADC' | 'OTHERS';

export interface FixedPartyDefinition {
  code: PartyCode;
  name: string;
  barColor: string;
  badgeClass: string;
}

export const FIXED_PARTIES: readonly FixedPartyDefinition[] = [
  {
    code: 'APC',
    name: 'All Progressives Congress',
    barColor: '#0b3b24',
    badgeClass: 'border-emerald-800/30 bg-emerald-50 text-[#0b3b24]',
  },
  {
    code: 'PDP',
    name: 'Peoples Democratic Party',
    barColor: '#b91c1c',
    badgeClass: 'border-red-200 bg-red-50 text-red-800',
  },
  {
    code: 'ADC',
    name: 'African Democratic Congress',
    barColor: '#1d4ed8',
    badgeClass: 'border-blue-200 bg-blue-50 text-blue-800',
  },
  {
    code: 'OTHERS',
    name: 'Other Political Parties',
    barColor: '#475569',
    badgeClass: 'border-slate-300 bg-slate-100 text-slate-700',
  },
] as const;

export const FIXED_PARTY_MAP: Record<PartyCode, FixedPartyDefinition> = {
  APC: FIXED_PARTIES[0],
  PDP: FIXED_PARTIES[1],
  ADC: FIXED_PARTIES[2],
  OTHERS: FIXED_PARTIES[3],
};

export const MIN_OPERATIONS_OFFICERS_PER_WARD = 5;

export enum UserRole {
  FULL_CONTROL_ADMIN = 'FULL_CONTROL_ADMIN',
  FUNTUA_SUPER_ADMIN = 'FUNTUA_SUPER_ADMIN',
  DANDUME_SUPER_ADMIN = 'DANDUME_SUPER_ADMIN',
  VERIFICATION_OFFICER = 'VERIFICATION_OFFICER',
  OPERATIONS_OFFICER = 'OPERATIONS_OFFICER',
  WARD_COORDINATOR = 'WARD_COORDINATOR',
  POLLING_UNIT_AGENT = 'POLLING_UNIT_AGENT',
  ORDINARY_USER = 'ORDINARY_USER',
  PENDING = 'PENDING',
}

export const USER_ROLE_META: Record<
  UserRole,
  { label: string; shortLabel: string; description: string }
> = {
  [UserRole.FULL_CONTROL_ADMIN]: {
    label: 'Full Control Admin',
    shortLabel: 'Full Admin',
    description:
      'Complete constituency authority across Funtua & Dandume LGAs, party logos, users, operations officers, verifications, public approvals, settings, and audit logs.',
  },
  [UserRole.FUNTUA_SUPER_ADMIN]: {
    label: 'Funtua Super Admin',
    shortLabel: 'Funtua Admin',
    description:
      'Restricted to Funtua LGA (20-14): 11 wards, 298 polling units, incident review, result review, and Funtua personnel.',
  },
  [UserRole.DANDUME_SUPER_ADMIN]: {
    label: 'Dandume Super Admin',
    shortLabel: 'Dandume Admin',
    description:
      'Restricted to Dandume LGA (20/07): 11 wards, 177 polling units, incident review, result review, and Dandume personnel.',
  },
  [UserRole.VERIFICATION_OFFICER]: {
    label: 'Verification Officer',
    shortLabel: 'Verifier',
    description:
      'Dedicated result verification authority scoped to assigned LGA, Ward, or Constituency: reviews Form EC8A sheets, approves, rejects, or requests corrections.',
  },
  [UserRole.OPERATIONS_OFFICER]: {
    label: 'Operations Officer',
    shortLabel: 'Ops Officer',
    description:
      'Ward-scoped field operations officer (minimum 5 per ward): monitors assigned ward polling units, check-ins, incident escalations, notes, and schedules.',
  },
  [UserRole.WARD_COORDINATOR]: {
    label: 'Ward Coordinator',
    shortLabel: 'Ward Coord',
    description:
      'Restricted to assigned electoral ward: polling units, field agents, check-ins, incident escalation, and verified ward totals.',
  },
  [UserRole.POLLING_UNIT_AGENT]: {
    label: 'Polling Unit Agent',
    shortLabel: 'PU Agent',
    description:
      'Restricted to assigned polling unit: check-ins, status updates, incident reporting, and Form EC8A result submissions.',
  },
  [UserRole.ORDINARY_USER]: {
    label: 'Ordinary User',
    shortLabel: 'Standard User',
    description:
      'Automatically approved standard operator scoped to registered Polling Unit: field check-ins, incident reports, operational notes, emergency contacts, and public results.',
  },
  [UserRole.PENDING]: {
    label: 'Pending Assignment',
    shortLabel: 'Pending',
    description: 'Awaiting administrator approval and geographic assignment.',
  },
};

export enum AccountStatus {
  ACTIVE = 'ACTIVE',
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  SUSPENDED = 'SUSPENDED',
}

export const ACCOUNT_STATUS_META: Record<AccountStatus, { label: string }> = {
  [AccountStatus.ACTIVE]: { label: 'Active' },
  [AccountStatus.PENDING_APPROVAL]: { label: 'Unverified / Pending Admin Approval' },
  [AccountStatus.SUSPENDED]: { label: 'Suspended / Revoked' },
};

export enum PuOperationalStatus {
  NOT_STARTED = 'NOT_STARTED',
  AGENT_ASSIGNED = 'AGENT_ASSIGNED',
  AGENT_CHECKED_IN = 'AGENT_CHECKED_IN',
  MATERIALS_ARRIVED = 'MATERIALS_ARRIVED',
  VOTING_STARTED = 'VOTING_STARTED',
  VOTING_IN_PROGRESS = 'VOTING_IN_PROGRESS',
  VOTING_COMPLETED = 'VOTING_COMPLETED',
  COUNTING_STARTED = 'COUNTING_STARTED',
  RESULT_SUBMITTED = 'RESULT_SUBMITTED',
  RESULT_UNDER_REVIEW = 'RESULT_UNDER_REVIEW',
  RESULT_VERIFIED = 'RESULT_VERIFIED',
  INCIDENT_REPORTED = 'INCIDENT_REPORTED',
  COMMUNICATION_LOST = 'COMMUNICATION_LOST',
}

export const PU_STATUS_META: Record<
  PuOperationalStatus,
  { label: string; stepOrder: number }
> = {
  [PuOperationalStatus.NOT_STARTED]: { label: 'Not Started', stepOrder: 0 },
  [PuOperationalStatus.AGENT_ASSIGNED]: { label: 'Agent Assigned', stepOrder: 1 },
  [PuOperationalStatus.AGENT_CHECKED_IN]: { label: 'Agent Checked In', stepOrder: 2 },
  [PuOperationalStatus.MATERIALS_ARRIVED]: { label: 'Election Materials Arrived', stepOrder: 3 },
  [PuOperationalStatus.VOTING_STARTED]: { label: 'Voting Started', stepOrder: 4 },
  [PuOperationalStatus.VOTING_IN_PROGRESS]: { label: 'Voting In Progress', stepOrder: 5 },
  [PuOperationalStatus.VOTING_COMPLETED]: { label: 'Voting Completed', stepOrder: 6 },
  [PuOperationalStatus.COUNTING_STARTED]: { label: 'Result Counting Started', stepOrder: 7 },
  [PuOperationalStatus.RESULT_SUBMITTED]: { label: 'Result Submitted', stepOrder: 8 },
  [PuOperationalStatus.RESULT_UNDER_REVIEW]: { label: 'Result Under Review', stepOrder: 9 },
  [PuOperationalStatus.RESULT_VERIFIED]: { label: 'Result Verified', stepOrder: 10 },
  [PuOperationalStatus.INCIDENT_REPORTED]: { label: 'Incident Reported', stepOrder: 11 },
  [PuOperationalStatus.COMMUNICATION_LOST]: { label: 'Communication Lost', stepOrder: 12 },
};

export function isPuReporting(status: PuOperationalStatus): boolean {
  return (
    status !== PuOperationalStatus.NOT_STARTED &&
    status !== PuOperationalStatus.AGENT_ASSIGNED &&
    status !== PuOperationalStatus.COMMUNICATION_LOST
  );
}

export const INCIDENT_CATEGORIES = [
  'Late arrival of election materials',
  'Missing election materials',
  'Security concern',
  'Violence or threat',
  'Electoral malpractice allegation',
  'BVAS malfunction or technical problem',
  'Absence or extreme lateness of election officials',
  'Agent access problem',
  'Voter-related issue',
  'Result-related issue',
  'Communication problem',
  'Other',
] as const;

export type IncidentCategory = (typeof INCIDENT_CATEGORIES)[number];

export enum IncidentUrgency {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

export const INCIDENT_URGENCY_META: Record<IncidentUrgency, { label: string }> = {
  [IncidentUrgency.LOW]: { label: 'Low' },
  [IncidentUrgency.MEDIUM]: { label: 'Medium' },
  [IncidentUrgency.HIGH]: { label: 'High' },
  [IncidentUrgency.CRITICAL]: { label: 'Critical' },
};

export enum IncidentStatus {
  DRAFT = 'DRAFT',
  NEW = 'NEW',
  SUBMITTED = 'SUBMITTED',
  PENDING_REVIEW = 'PENDING_REVIEW',
  UNDER_REVIEW = 'UNDER_REVIEW',
  UNDER_INVESTIGATION = 'UNDER_INVESTIGATION',
  VERIFIED = 'VERIFIED',
  UNVERIFIED = 'UNVERIFIED',
  REJECTED = 'REJECTED',
  ESCALATED = 'ESCALATED',
  RESOLVED = 'RESOLVED',
  CLOSED = 'CLOSED',
}

export const INCIDENT_STATUS_META: Record<IncidentStatus, { label: string }> = {
  [IncidentStatus.DRAFT]: { label: 'Draft' },
  [IncidentStatus.NEW]: { label: 'New / Submitted' },
  [IncidentStatus.SUBMITTED]: { label: 'Submitted' },
  [IncidentStatus.PENDING_REVIEW]: { label: 'Pending Review' },
  [IncidentStatus.UNDER_REVIEW]: { label: 'Under Review' },
  [IncidentStatus.UNDER_INVESTIGATION]: { label: 'Under Investigation' },
  [IncidentStatus.VERIFIED]: { label: 'Verified' },
  [IncidentStatus.UNVERIFIED]: { label: 'Unverified' },
  [IncidentStatus.REJECTED]: { label: 'Rejected' },
  [IncidentStatus.ESCALATED]: { label: 'Escalated' },
  [IncidentStatus.RESOLVED]: { label: 'Resolved' },
  [IncidentStatus.CLOSED]: { label: 'Closed' },
};

export function isIncidentActive(status: IncidentStatus): boolean {
  return (
    status !== IncidentStatus.RESOLVED &&
    status !== IncidentStatus.CLOSED &&
    status !== IncidentStatus.REJECTED
  );
}

export enum VerificationStatus {
  DRAFT = 'DRAFT',
  SUBMITTED = 'SUBMITTED',
  PENDING_VERIFICATION = 'PENDING_VERIFICATION',
  UNDER_REVIEW = 'UNDER_REVIEW',
  DISCREPANCY_DETECTED = 'DISCREPANCY_DETECTED',
  VERIFIED = 'VERIFIED',
  CORRECTED = 'CORRECTED',
  REJECTED = 'REJECTED',
  REQUIRES_CORRECTION = 'REQUIRES_CORRECTION',
}

export const VERIFICATION_STATUS_META: Record<VerificationStatus, { label: string }> = {
  [VerificationStatus.DRAFT]: { label: 'Draft' },
  [VerificationStatus.SUBMITTED]: { label: 'Submitted' },
  [VerificationStatus.PENDING_VERIFICATION]: { label: 'Pending Verification' },
  [VerificationStatus.UNDER_REVIEW]: { label: 'Under Review' },
  [VerificationStatus.DISCREPANCY_DETECTED]: { label: 'Discrepancy Detected' },
  [VerificationStatus.VERIFIED]: { label: 'FDMIS Verified' },
  [VerificationStatus.CORRECTED]: { label: 'Corrected' },
  [VerificationStatus.REJECTED]: { label: 'Rejected' },
  [VerificationStatus.REQUIRES_CORRECTION]: { label: 'Correction Requested' },
};

export const ELECTION_CATEGORY_OPTIONS = [
  'House of Representatives (Funtua/Dandume)',
  'Presidential',
  'Senatorial (Katsina South)',
  'Governorship',
  'State House of Assembly',
] as const;

export type ElectionCategory = (typeof ELECTION_CATEGORY_OPTIONS)[number];

export const BVAS_STATUS_OPTIONS = [
  'Functional',
  'Minor Delay / Slow Sync',
  'Malfunctioning',
  'Replaced',
  'Not Deployed',
] as const;

export type OfflineQueueStatus =
  | 'SAVED_LOCALLY'
  | 'PENDING_SYNC'
  | 'SYNCING'
  | 'SYNC_FAILED'
  | 'SYNCED';
export type OfflineReportType =
  | 'CHECK_IN'
  | 'STATUS_UPDATE'
  | 'INCIDENT_REPORT'
  | 'RESULT_SUBMISSION'
  | 'NOTE_UPSERT'
  | 'NOTE_DELETE'
  | 'NOTIFICATION_BROADCAST'
  | 'TASK_CREATE'
  | 'TASK_OFFICER_UPDATE'
  | 'REPORT_ARCHIVE'
  | 'EMERGENCY_REPORT';

export interface OfflinePruneReport {
  prunedQueueItems: number;
  resetStuckSyncingItems: number;
  prunedDrafts: number;
  prunedNotes: number;
  prunedSnapshots: number;
  prunedSnapshotEntries: number;
  prunedTombstones: number;
  prunedPendingRegistrations: number;
  ranAtIso: string;
}

export interface PendingOfflineRegistration {
  id: string;
  email?: string;
  phoneE164: string;
  phoneDigits: string;
  phoneHash: string;
  displayName: string;
  passwordSalt: string;
  passwordHash: string;
  requestedLgaId: LgaId;
  requestedLgaName: string;
  requestedWardId: string;
  requestedWardName: string;
  requestedPollingUnitId: string;
  requestedPollingUnitCode: string;
  requestedPollingUnitName: string;
  recoveryKeySalt: string;
  recoveryKeyHash: string;
  wrappedPasswordCipher?: string;
  wrappedPasswordIv?: string;
  status: 'QUEUED_OFFLINE' | 'SYNC_FAILED' | 'SYNCED';
  errorMessage?: string;
  createdAtIso: string;
  updatedAtIso: string;
  serverSyncedAtIso?: string;
}

export type OperationalNoteCategory =
  | 'GENERAL'
  | 'FIELD_UPDATE'
  | 'LOGISTICS'
  | 'HANDOVER'
  | 'URGENT';

export interface OperationalNote {
  id: string;
  clientNoteId: string;
  title: string;
  content: string;
  category: OperationalNoteCategory;
  lgaId: 'all' | LgaId;
  wardId: string;
  puId: string;
  puCode: string;
  puName: string;
  authorUid: string;
  authorName: string;
  isPinned: boolean;
  isTestData: boolean;
  revision: number;
  clientCreatedAtIso?: string;
  serverSyncedAt?: FirestoreTime;
  createdAt?: FirestoreTime;
  updatedAt?: FirestoreTime;
  syncState?: OfflineQueueStatus;
  syncError?: string;
}

export type FirestoreTime =
  | Timestamp
  | Date
  | string
  | { seconds: number; nanoseconds?: number }
  | null
  | undefined;

export interface BootstrapLock {
  initializedByUid: string;
  initializedByEmail: string;
  cycleYear: number;
  constituencyName: string;
  createdAt?: FirestoreTime;
}

export const DEFAULT_OFFLINE_SESSION_MAX_DAYS = 14;

export type SessionVerificationMode = 'online_verified' | 'offline_trusted' | 'revalidating';

export interface GlobalSettings {
  inactivityTimeoutMinutes: number;
  offlineSessionMaxDays?: number;
  mfaPrepared: boolean;
  publicSummaryEnabled: boolean;
  smsFallbackConfigured: boolean;
  whatsappConfigured: boolean;
  emailConfigured: boolean;
  whatsappGroupName?: string;
  whatsappGroupUrl?: string;
  whatsappGroupEnabled?: boolean;
  updatedByUid: string;
  updatedAt?: FirestoreTime;
}

export interface UserPreferences {
  uid: string;
  criticalAlertsEnabled: boolean;
  resultUpdatesEnabled: boolean;
  incidentDigestEnabled: boolean;
  soundAlertsEnabled: boolean;
  updatedAt?: FirestoreTime;
}

export type PartyLogoStorageMode =
  | 'firebase_storage'
  | 'firestore_asset_store'
  | 'firestore_cloud'
  | 'none';

export interface PartyConfig {
  partyCode: PartyCode;
  partyName: string;
  logoUrl: string;
  storageMode: PartyLogoStorageMode;
  storagePath?: string | null;
  logoAssetId?: string | null;
  fileName?: string | null;
  contentType?: string | null;
  fileSizeBytes?: number | null;
  sha256Hash?: string | null;
  updatedByUid: string;
  updatedByName: string;
  updatedAt?: FirestoreTime;
}

export interface UserAccount {
  uid: string;
  email: string;
  displayName: string;
  phone?: string | null;
  authMethod?: 'GOOGLE' | 'PHONE_PASSWORD' | 'EMAIL_PASSWORD';
  role: UserRole;
  status: AccountStatus;
  assignedLgaId: string;
  assignedWardId: string;
  assignedPollingUnitId: string;
  requestedLgaId?: string | null;
  requestedWardId?: string | null;
  requestedWardName?: string | null;
  requestedPollingUnitId?: string | null;
  requestedPollingUnitCode?: string | null;
  requestedPollingUnitName?: string | null;
  sessionRevoked: boolean;
  revokedReason?: string | null;
  batteryLevel?: number | null;
  batteryCharging?: boolean | null;
  batteryUpdatedAt?: FirestoreTime;
  lastPasswordChangedAt?: FirestoreTime;
  lastLoginAt?: FirestoreTime;
  createdAt?: FirestoreTime;
  updatedAt?: FirestoreTime;
}

export interface LocationCatalogWardItem {
  id: string;
  wardCode: string;
  name: string;
}

export interface LocationCatalogPuItem {
  id: string;
  wardId: string;
  wardName: string;
  puCode: string;
  name: string;
}

export interface LocationCatalogLga {
  lgaId: LgaId;
  lgaName: string;
  lgaCode: string;
  wards: LocationCatalogWardItem[];
  pollingUnits: LocationCatalogPuItem[];
  wardCount: number;
  puCount: number;
  updatedByUid: string;
  updatedAt?: FirestoreTime;
}

export interface PasswordResetRequest {
  id: string;
  phoneHash: string;
  maskedPhone: string;
  applicantName: string;
  lgaId: string;
  wardName: string;
  puCode: string;
  recoveryKeyMatched: boolean;
  status: 'PENDING' | 'APPROVED' | 'COMPLETED' | 'REJECTED';
  reviewerNote: string;
  reviewedByUid: string;
  createdAt?: FirestoreTime;
  updatedAt?: FirestoreTime;
}

export interface Ward {
  id: string;
  lgaId: LgaId;
  wardCode: string;
  name: string;
  coordinatorUid: string;
  coordinatorName: string;
  expectedPollingUnits: number;
  isTestData: boolean;
  createdByUid: string;
  createdAt?: FirestoreTime;
  updatedAt?: FirestoreTime;
}

export interface PollingUnit {
  id: string;
  lgaId: LgaId;
  wardId: string;
  wardName: string;
  puCode: string;
  name: string;
  locationDescription: string;
  latitude?: number | null;
  longitude?: number | null;
  coordinatesVerified: boolean;
  assignedAgentUid: string;
  assignedAgentName: string;
  operationalStatus: PuOperationalStatus;
  registeredVoters: number;
  puStatusLabel?: string;
  isMasterRecord?: boolean;
  isTestData: boolean;
  createdByUid: string;
  createdAt?: FirestoreTime;
  updatedAt?: FirestoreTime;
}

export interface PuAssignment {
  puId: string;
  puCode: string;
  lgaId: LgaId;
  wardId: string;
  agentUid: string;
  agentName: string;
  assignedByUid: string;
  createdAt?: FirestoreTime;
  updatedAt?: FirestoreTime;
}

export interface DirectoryBackup {
  id: string;
  entityType: string;
  targetDocId: string;
  lgaId: LgaId;
  puCode: string;
  previousName: string;
  previousLocationDescription: string;
  previousRegisteredVoters: number;
  previousCoordinatesVerified: boolean;
  previousLatitude?: number | null;
  previousLongitude?: number | null;
  correctionReason: string;
  backedUpByUid: string;
  backedUpByEmail: string;
  createdAt?: FirestoreTime;
}

export interface AgentCheckIn {
  id: string;
  puId: string;
  puCode: string;
  puName: string;
  lgaId: LgaId;
  wardId: string;
  agentUid: string;
  agentName: string;
  arrivalTimeText: string;
  comments: string;
  batteryPercent: number;
  networkStatus: string;
  latitude?: number | null;
  longitude?: number | null;
  gpsAccuracyMeters?: number | null;
  deviceId?: string | null;
  fieldStatus?: string | null;
  photoBase64?: string | null;
  photoFileName?: string | null;
  locationExceptionFlag?: boolean;
  locationExceptionDistanceMeters?: number | null;
  exceptionReviewStatus?:
    | 'NONE'
    | 'PENDING_REVIEW'
    | 'EXPLAINED'
    | 'CONFIRMED_EXCEPTION'
    | 'CLEARED'
    | 'FOLLOW_UP_REQUESTED';
  exceptionReviewNote?: string | null;
  exceptionReviewedByUid?: string | null;
  clientSubmissionId: string;
  clientCreatedAtIso?: string;
  serverSyncedAt?: FirestoreTime;
  isTestData: boolean;
  createdAt?: FirestoreTime;
}

export interface IncidentReport {
  id: string;
  title: string;
  category: string;
  description: string;
  urgency: IncidentUrgency;
  status: IncidentStatus;
  lgaId: LgaId;
  wardId: string;
  puId: string;
  puCode: string;
  puName: string;
  reporterUid: string;
  reporterName: string;
  latitude?: number | null;
  longitude?: number | null;
  gpsAccuracyMeters?: number | null;
  evidenceBase64?: string | null;
  evidenceFileName?: string | null;
  evidenceSha256?: string | null;
  witnessInfo?: string | null;
  protectReporterIdentity?: boolean;
  requestedInfoNote?: string | null;
  internalNotes: string;
  escalatedTo: string;
  reviewedByUid: string;
  clientSubmissionId: string;
  clientCreatedAtIso?: string;
  serverSyncedAt?: FirestoreTime;
  isTestData: boolean;
  createdAt?: FirestoreTime;
  updatedAt?: FirestoreTime;
}

export interface IncidentHistoryEntry {
  id: string;
  incidentId: string;
  action: string;
  previousStatus: string;
  newStatus: string;
  urgency: IncidentUrgency;
  note: string;
  escalatedTo: string;
  actorUid: string;
  actorName: string;
  actorRole: string;
  createdAt?: FirestoreTime;
}

export interface ResultSubmission {
  id: string;
  puId: string;
  puCode: string;
  puName: string;
  lgaId: LgaId;
  wardId: string;
  wardName: string;
  submittedByUid: string;
  submittedByName: string;
  electionCategory?: string;
  apcVotes?: number;
  pdpVotes?: number;
  adcVotes?: number;
  othersVotes?: number;
  registeredVoters: number;
  accreditedVoters: number;
  validVotes: number;
  rejectedVotes: number;
  totalVotesCast: number;
  bvasStatus: string;
  bvasNotes: string;
  submissionNotes: string;
  ec8aImageBase64?: string | null;
  ec8aFileName?: string | null;
  discrepancyFlag?: boolean;
  discrepancySummary?: string | null;
  duplicateOfSubmissionId?: string | null;
  ocrAssistedReviewNote?: string | null;
  verificationStatus: VerificationStatus;
  publiclyApproved: boolean;
  reviewNote: string;
  reviewedByUid: string;
  reviewedByName: string;
  reviewedAt?: FirestoreTime;
  version: number;
  clientSubmissionId: string;
  clientCreatedAtIso?: string;
  serverSyncedAt?: FirestoreTime;
  isTestData: boolean;
  createdAt?: FirestoreTime;
  updatedAt?: FirestoreTime;
}

export interface ResultHistoryEntry {
  id: string;
  action: string;
  previousStatus: string;
  newStatus: string;
  note: string;
  actorUid: string;
  actorName: string;
  apcVotes?: number;
  pdpVotes?: number;
  adcVotes?: number;
  othersVotes?: number;
  registeredVoters: number;
  accreditedVoters: number;
  validVotes: number;
  rejectedVotes: number;
  totalVotesCast: number;
  createdAt?: FirestoreTime;
}

export interface ApprovedPuResult {
  id: string;
  puId: string;
  puCode: string;
  puName: string;
  lgaId: LgaId;
  wardId: string;
  wardName: string;
  sourceSubmissionId: string;
  submittedByUid: string;
  submittedByName: string;
  approvedByUid: string;
  approvedByName: string;
  apcVotes: number;
  pdpVotes: number;
  adcVotes: number;
  othersVotes: number;
  registeredVoters: number;
  accreditedVoters: number;
  validVotes: number;
  rejectedVotes: number;
  totalVotesCast: number;
  approvedAt?: FirestoreTime;
  updatedAt?: FirestoreTime;
}

export interface AggregatedResult {
  id: string;
  scopeType: 'WARD' | 'LGA' | 'CONSTITUENCY';
  scopeId: string;
  lgaId: string;
  wardId: string;
  label: string;
  verifiedPuCount: number;
  apcVotes: number;
  pdpVotes: number;
  adcVotes: number;
  othersVotes: number;
  registeredVoters: number;
  accreditedVoters: number;
  validVotes: number;
  rejectedVotes: number;
  totalVotesCast: number;
  updatedByUid: string;
  updatedAt?: FirestoreTime;
}

export interface PublicVerifiedResult {
  id: string;
  puCode: string;
  puName: string;
  wardName: string;
  lgaId: LgaId;
  apcVotes?: number;
  pdpVotes?: number;
  adcVotes?: number;
  othersVotes?: number;
  registeredVoters: number;
  accreditedVoters: number;
  validVotes: number;
  rejectedVotes: number;
  totalVotesCast: number;
  approvedByUid: string;
  verifiedAt?: FirestoreTime;
}

export interface TimelineEvent {
  id: string;
  eventType: string;
  title: string;
  description: string;
  lgaId: string;
  wardId: string;
  puId: string;
  puCode: string;
  actorUid: string;
  actorName: string;
  isTestData: boolean;
  createdAt?: FirestoreTime;
}

export interface NotificationItem {
  id: string;
  title: string;
  body: string;
  type: string;
  targetLgaId: string;
  targetWardId: string;
  isCritical: boolean;
  isTestData?: boolean;
  createdByUid: string;
  createdAt?: FirestoreTime;
}

export interface ReportAttachment {
  id: string;
  attachmentId: string;
  reportId: string;
  reportType: OfflineReportType;
  ownerUid: string;
  lgaId: LgaId;
  wardId: string;
  puId: string;
  fileName: string;
  sha256Hash: string;
  sizeBytes: number;
  base64Data: string;
  createdAt?: FirestoreTime;
}

export interface EmergencyContact {
  id: string;
  name: string;
  roleLabel: string;
  phoneNumber: string;
  scopeLgaId: 'all' | LgaId;
  isPriority: boolean;
  notes: string;
  createdByUid: string;
  updatedByUid: string;
  createdAt?: FirestoreTime;
  updatedAt?: FirestoreTime;
}

export enum TaskPriority {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

export const TASK_PRIORITY_META: Record<TaskPriority, { label: string }> = {
  [TaskPriority.LOW]: { label: 'Low' },
  [TaskPriority.MEDIUM]: { label: 'Medium' },
  [TaskPriority.HIGH]: { label: 'High' },
  [TaskPriority.CRITICAL]: { label: 'Critical' },
};

export enum TaskStatus {
  ASSIGNED = 'ASSIGNED',
  ACKNOWLEDGED = 'ACKNOWLEDGED',
  IN_PROGRESS = 'IN_PROGRESS',
  AWAITING_REVIEW = 'AWAITING_REVIEW',
  REVISION_REQUIRED = 'REVISION_REQUIRED',
  APPROVED_COMPLETED = 'APPROVED_COMPLETED',
  OVERDUE = 'OVERDUE',
}

export const TASK_STATUS_META: Record<TaskStatus, { label: string }> = {
  [TaskStatus.ASSIGNED]: { label: 'Assigned' },
  [TaskStatus.ACKNOWLEDGED]: { label: 'Acknowledged' },
  [TaskStatus.IN_PROGRESS]: { label: 'In Progress' },
  [TaskStatus.AWAITING_REVIEW]: { label: 'Awaiting Review' },
  [TaskStatus.REVISION_REQUIRED]: { label: 'Revision Required' },
  [TaskStatus.APPROVED_COMPLETED]: { label: 'Approved / Completed' },
  [TaskStatus.OVERDUE]: { label: 'Overdue' },
};

export type TaskUpdateEntryType =
  | 'OFFICER_PROGRESS'
  | 'FIELD_REPORT'
  | 'UPDATE_REQUEST'
  | 'ADMIN_REVIEW'
  | 'STATUS_CHANGE';

export interface OperationalTask {
  id: string;
  title: string;
  description: string;
  priority: TaskPriority;
  status: TaskStatus;
  lgaId: LgaId;
  wardId: string;
  wardName: string;
  assignedOfficerUid: string;
  assignedOfficerName: string;
  assignedByUid: string;
  assignedByName: string;
  startDateIso: string;
  dueDateIso: string;
  progressPercent: number;
  acknowledgedAtIso: string;
  submittedForReviewAtIso: string;
  completedAtIso: string;
  latestFieldReport: string;
  delayReason: string;
  evidenceBase64?: string | null;
  evidenceFileName?: string | null;
  adminFeedback: string;
  updateRequestedAtIso: string;
  updateRequestNote: string;
  reviewedByUid: string;
  reviewedByName: string;
  clientSubmissionId: string;
  clientCreatedAtIso?: string;
  serverSyncedAt?: FirestoreTime;
  isTestData: boolean;
  createdAt?: FirestoreTime;
  updatedAt?: FirestoreTime;
}

export interface TaskUpdateEntry {
  id: string;
  taskId: string;
  entryType: TaskUpdateEntryType;
  statusSnapshot: TaskStatus;
  progressPercent: number;
  summary: string;
  delayReason: string;
  evidenceBase64?: string | null;
  evidenceFileName?: string | null;
  actorUid: string;
  actorName: string;
  actorRole: string;
  clientSubmissionId: string;
  clientCreatedAtIso?: string;
  serverSyncedAt?: FirestoreTime;
  createdAt?: FirestoreTime;
}

export type AutomaticReportCategory =
  | 'DAILY_SITUATION'
  | 'LGA_SUMMARY'
  | 'WARD_PERFORMANCE'
  | 'PU_COVERAGE'
  | 'AGENT_ACTIVITY'
  | 'OFFICER_PERFORMANCE'
  | 'ELECTION_INCIDENT'
  | 'TASK_COMPLETION'
  | 'FIELD_CHECKIN'
  | 'RESULTS_SUBMISSION_STATUS'
  | 'DATA_SYNCHRONIZATION'
  | 'OUTSTANDING_ACTIONS';

export const AUTOMATIC_REPORT_LABELS: Record<AutomaticReportCategory, string> = {
  DAILY_SITUATION: 'Daily Situation Report',
  LGA_SUMMARY: 'LGA Performance Report',
  WARD_PERFORMANCE: 'Ward Performance Report',
  PU_COVERAGE: 'Polling Unit Coverage Report',
  AGENT_ACTIVITY: 'Field Officer & Agent Activity Report',
  OFFICER_PERFORMANCE: 'Operations Officer Performance Report',
  ELECTION_INCIDENT: 'Incident Report',
  TASK_COMPLETION: 'Task Completion Report',
  FIELD_CHECKIN: 'Field Check-In Report',
  RESULTS_SUBMISSION_STATUS: 'Results Submission Status Report',
  DATA_SYNCHRONIZATION: 'Data Synchronization Report',
  OUTSTANDING_ACTIONS: 'Outstanding Actions Report',
};

export interface GeneratedReportRecord {
  id: string;
  reportCategory: AutomaticReportCategory;
  reportTitle: string;
  reportingPeriodStartIso: string;
  reportingPeriodEndIso: string;
  lgaId: 'all' | LgaId;
  wardId: string;
  puId: string;
  officerUid: string;
  scopeLabel: string;
  generatedByUid: string;
  generatedByName: string;
  generationMode: 'AUTOMATIC_DAILY' | 'ON_DEMAND';
  dataStatus: string;
  dataCompletenessNotice: string;
  rowCount: number;
  headers: string[];
  summaryMetrics: Record<string, number | string>;
  clientSubmissionId: string;
  clientCreatedAtIso?: string;
  serverSyncedAt?: FirestoreTime;
  createdAt?: FirestoreTime;
}

export interface AuditLog {
  id: string;
  actorUid: string;
  actorName: string;
  actorEmail: string;
  actorRole: string;
  action: string;
  affectedEntity: string;
  affectedId: string;
  details: string;
  createdAt?: FirestoreTime;
}

export interface DeletionTombstone {
  id: string;
  recordId: string;
  collectionName: string;
  deletedByUid: string;
  deletedByEmail: string;
  reason: string;
  deletedAtIso: string;
  createdAt?: FirestoreTime;
}

export interface SystemBackupRecord {
  id: string;
  backupType: 'SCHEDULED_AUTO' | 'MANUAL_ADMIN' | 'PRE_RESTORATION';
  label: string;
  encryptionAlgorithm: 'AES-GCM-256';
  sha256Checksum: string;
  sizeBytes: number;
  recordCounts: Record<string, number>;
  status: 'COMPLETED' | 'VERIFIED' | 'FAILED';
  errorMessage?: string;
  createdByUid: string;
  createdByName: string;
  createdAtIso: string;
  createdAt?: FirestoreTime;
}

export interface EscalationRule {
  id: string;
  ruleName: string;
  triggerType:
    | 'MISSING_CHECKIN'
    | 'CRITICAL_INCIDENT'
    | 'OVERDUE_TASK'
    | 'RESULT_DISCREPANCY'
    | 'SYNC_FAILURE'
    | 'LOW_WARD_COVERAGE'
    | 'EMERGENCY_ASSISTANCE';
  priority: IncidentUrgency;
  responsibleRole: UserRole;
  escalateAfterMinutes: number;
  recipientRole: UserRole;
  maxNotificationsPerHour: number;
  enabled: boolean;
  updatedByUid: string;
  updatedAt?: FirestoreTime;
}

export const EMERGENCY_CATEGORIES = [
  'Immediate Security Threat',
  'Medical Emergency',
  'Polling Material Obstruction',
  'Officer / Agent Safety',
  'Logistics / Evacuation Need',
  'Communication Blackout',
  'Other Urgent Assistance',
] as const;

export type EmergencyCategory = (typeof EMERGENCY_CATEGORIES)[number];

export type EmergencyReportStatus =
  | 'SUBMITTED'
  | 'ACKNOWLEDGED'
  | 'RESPONDER_ASSIGNED'
  | 'RESOLVED'
  | 'CLOSED';

export interface EmergencyReport {
  id: string;
  category: string;
  description: string;
  urgency: IncidentUrgency;
  status: EmergencyReportStatus;
  lgaId: LgaId | 'all';
  wardId: string;
  puId: string;
  puCode: string;
  puName: string;
  latitude?: number | null;
  longitude?: number | null;
  reporterUid: string;
  reporterName: string;
  reporterPhone: string;
  assignedResponderUid: string;
  assignedResponderName: string;
  resolutionNotes: string;
  clientSubmissionId: string;
  clientCreatedAtIso?: string;
  createdAt?: FirestoreTime;
  updatedAt?: FirestoreTime;
}

export interface OfflineQueuedItem {
  clientSubmissionId: string;
  ownerUid: string;
  reportType: OfflineReportType;
  puId: string;
  puCode: string;
  puName: string;
  lgaId: LgaId | 'all';
  wardId: string;
  summary: string;
  payload: Record<string, unknown>;
  status: OfflineQueueStatus;
  retryCount?: number;
  nextRetryAtIso?: string;
  conflictState?: 'NONE' | 'CONFLICT_DETECTED' | 'RESOLVED';
  conflictServerSummary?: string;
  errorMessage?: string;
  createdAtIso: string;
  updatedAtIso: string;
  syncedAtIso?: string;
}

export interface OfficialWardSeed {
  lgaId: LgaId;
  lgaCode: string;
  wardCode: string;
  name: string;
  expectedPollingUnits: number;
}

export interface OfficialPuSeed {
  lgaId: LgaId;
  wardCode: string;
  wardName: string;
  puCode: string;
  name: string;
  status: string;
}

export interface OfficialDirectoryDataset {
  datasetVersion: string;
  verificationAdvisories: string[];
  wards: OfficialWardSeed[];
  pollingUnits: OfficialPuSeed[];
}

export interface DirectoryImportSummary {
  datasetVersion: string;
  wardsImported: number;
  funtuaNewlyImported: number;
  dandumeNewlyImported: number;
  totalVerifiedInDatabase: number;
  funtuaVerifiedInDatabase: number;
  dandumeVerifiedInDatabase: number;
  countsVerified: boolean;
}

// --- RBAC PERMISSION HELPERS ---
export function isAuthorizedActive(user: UserAccount | null): boolean {
  if (!user) return false;
  return (
    user.status === AccountStatus.ACTIVE &&
    !user.sessionRevoked &&
    user.role !== UserRole.PENDING
  );
}

export function canManageUsers(role: UserRole): boolean {
  return (
    role === UserRole.FULL_CONTROL_ADMIN ||
    role === UserRole.FUNTUA_SUPER_ADMIN ||
    role === UserRole.DANDUME_SUPER_ADMIN
  );
}

export function canManageOperationsOfficers(role: UserRole): boolean {
  return (
    role === UserRole.FULL_CONTROL_ADMIN ||
    role === UserRole.FUNTUA_SUPER_ADMIN ||
    role === UserRole.DANDUME_SUPER_ADMIN
  );
}

export function canDeleteUsers(role: UserRole): boolean {
  return role === UserRole.FULL_CONTROL_ADMIN;
}

export function canManageParties(role: UserRole): boolean {
  return role === UserRole.FULL_CONTROL_ADMIN;
}

export function canManageAllLgas(role: UserRole): boolean {
  return role === UserRole.FULL_CONTROL_ADMIN;
}

export function canManageDirectory(role: UserRole): boolean {
  return (
    role === UserRole.FULL_CONTROL_ADMIN ||
    role === UserRole.FUNTUA_SUPER_ADMIN ||
    role === UserRole.DANDUME_SUPER_ADMIN
  );
}

export function canCorrectMasterDirectory(role: UserRole): boolean {
  return role === UserRole.FULL_CONTROL_ADMIN;
}

export function canAssignFieldUsers(role: UserRole): boolean {
  return (
    role === UserRole.FULL_CONTROL_ADMIN ||
    role === UserRole.FUNTUA_SUPER_ADMIN ||
    role === UserRole.DANDUME_SUPER_ADMIN ||
    role === UserRole.WARD_COORDINATOR
  );
}

export function canReviewIncidents(role: UserRole): boolean {
  return (
    role === UserRole.FULL_CONTROL_ADMIN ||
    role === UserRole.FUNTUA_SUPER_ADMIN ||
    role === UserRole.DANDUME_SUPER_ADMIN ||
    role === UserRole.OPERATIONS_OFFICER ||
    role === UserRole.WARD_COORDINATOR
  );
}

export function canVerifyResults(role: UserRole): boolean {
  return (
    role === UserRole.FULL_CONTROL_ADMIN ||
    role === UserRole.FUNTUA_SUPER_ADMIN ||
    role === UserRole.DANDUME_SUPER_ADMIN ||
    role === UserRole.VERIFICATION_OFFICER
  );
}

export function canApprovePublicResults(role: UserRole): boolean {
  return role === UserRole.FULL_CONTROL_ADMIN;
}

export function canViewAuditLogs(role: UserRole): boolean {
  return role === UserRole.FULL_CONTROL_ADMIN;
}

export function canManageSystemPolicies(role: UserRole): boolean {
  return role === UserRole.FULL_CONTROL_ADMIN;
}

export function canManageSettings(role: UserRole): boolean {
  return role === UserRole.FULL_CONTROL_ADMIN;
}

export function canManageEmergencyContacts(role: UserRole): boolean {
  return (
    role === UserRole.FULL_CONTROL_ADMIN ||
    role === UserRole.FUNTUA_SUPER_ADMIN ||
    role === UserRole.DANDUME_SUPER_ADMIN
  );
}

export function canManageTestData(role: UserRole): boolean {
  return role === UserRole.FULL_CONTROL_ADMIN;
}

export function canAccessSettings(role: UserRole): boolean {
  return role !== UserRole.PENDING;
}

export function canManageTasks(role: UserRole): boolean {
  return role === UserRole.FULL_CONTROL_ADMIN;
}

export function canViewTasksModule(role: UserRole): boolean {
  return (
    role === UserRole.FULL_CONTROL_ADMIN ||
    role === UserRole.FUNTUA_SUPER_ADMIN ||
    role === UserRole.DANDUME_SUPER_ADMIN ||
    role === UserRole.OPERATIONS_OFFICER
  );
}

export function canAccessAnalyticsReports(role: UserRole): boolean {
  return (
    role === UserRole.FULL_CONTROL_ADMIN ||
    role === UserRole.FUNTUA_SUPER_ADMIN ||
    role === UserRole.DANDUME_SUPER_ADMIN ||
    role === UserRole.VERIFICATION_OFFICER ||
    role === UserRole.OPERATIONS_OFFICER ||
    role === UserRole.WARD_COORDINATOR
  );
}

export function getEffectiveTaskStatus(task: OperationalTask, nowMs: number = Date.now()): TaskStatus {
  if (task.status === TaskStatus.APPROVED_COMPLETED) {
    return TaskStatus.APPROVED_COMPLETED;
  }
  const dueMs = Date.parse(task.dueDateIso);
  if (!Number.isNaN(dueMs) && dueMs < nowMs) {
    return TaskStatus.OVERDUE;
  }
  return task.status;
}

export function sanitizeTelHref(phone: string): string {
  const cleaned = phone.replace(/[^\d+]/g, '');
  return cleaned.startsWith('+') ? `+${cleaned.slice(1).replace(/\+/g, '')}` : cleaned.replace(/\+/g, '');
}

export function isValidWhatsAppInviteUrl(url: string): boolean {
  const trimmed = url.trim();
  return /^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9_?=&%+\-/]+$/.test(trimmed);
}

export function resolveWhatsAppGroupConfig(settings: GlobalSettings | null): {
  enabled: boolean;
  groupName: string;
  inviteUrl: string;
} {
  const enabled = settings?.whatsappGroupEnabled ?? true;
  const groupName = settings?.whatsappGroupName?.trim() || DEFAULT_WHATSAPP_GROUP_NAME;
  const rawUrl = settings?.whatsappGroupUrl?.trim();
  const inviteUrl =
    rawUrl === ''
      ? ''
      : rawUrl && isValidWhatsAppInviteUrl(rawUrl)
        ? rawUrl
        : DEFAULT_WHATSAPP_GROUP_URL;

  return {
    enabled: enabled && Boolean(inviteUrl),
    groupName,
    inviteUrl,
  };
}

export function getAuthorizedLgas(user: UserAccount): LgaId[] {
  if (user.role === UserRole.FULL_CONTROL_ADMIN) return ['funtua', 'dandume'];
  if (user.role === UserRole.VERIFICATION_OFFICER) {
    if (user.assignedLgaId === 'funtua') return ['funtua'];
    if (user.assignedLgaId === 'dandume') return ['dandume'];
    return ['funtua', 'dandume'];
  }
  if (user.role === UserRole.FUNTUA_SUPER_ADMIN) return ['funtua'];
  if (user.role === UserRole.DANDUME_SUPER_ADMIN) return ['dandume'];
  if (user.assignedLgaId === 'funtua' || user.assignedLgaId === 'dandume') {
    return [user.assignedLgaId];
  }
  return [];
}

export function formatFirestoreTime(ts: FirestoreTime): string {
  if (!ts) return 'Pending timestamp';
  let date: Date | null = null;
  if (ts instanceof Date) {
    date = ts;
  } else if (typeof ts === 'string') {
    const parsed = new Date(ts);
    if (!Number.isNaN(parsed.getTime())) date = parsed;
  } else if (typeof (ts as Timestamp).toDate === 'function') {
    date = (ts as Timestamp).toDate();
  } else if (typeof (ts as { seconds?: number }).seconds === 'number') {
    date = new Date((ts as { seconds: number }).seconds * 1000);
  }
  if (!date || Number.isNaN(date.getTime())) return 'Pending timestamp';
  return date.toLocaleString('en-NG', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
