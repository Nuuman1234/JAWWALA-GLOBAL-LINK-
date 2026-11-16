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

export enum UserRole {
  FULL_CONTROL_ADMIN = 'FULL_CONTROL_ADMIN',
  FUNTUA_SUPER_ADMIN = 'FUNTUA_SUPER_ADMIN',
  DANDUME_SUPER_ADMIN = 'DANDUME_SUPER_ADMIN',
  VERIFICATION_OFFICER = 'VERIFICATION_OFFICER',
  WARD_COORDINATOR = 'WARD_COORDINATOR',
  POLLING_UNIT_AGENT = 'POLLING_UNIT_AGENT',
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
      'Complete constituency authority across Funtua & Dandume LGAs, party logos, users, verifications, public approvals, settings, and audit logs.',
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
  [AccountStatus.PENDING_APPROVAL]: { label: 'Pending Approval' },
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
  NEW = 'NEW',
  UNDER_REVIEW = 'UNDER_REVIEW',
  ESCALATED = 'ESCALATED',
  RESOLVED = 'RESOLVED',
  CLOSED = 'CLOSED',
}

export const INCIDENT_STATUS_META: Record<IncidentStatus, { label: string }> = {
  [IncidentStatus.NEW]: { label: 'New' },
  [IncidentStatus.UNDER_REVIEW]: { label: 'Under Review' },
  [IncidentStatus.ESCALATED]: { label: 'Escalated' },
  [IncidentStatus.RESOLVED]: { label: 'Resolved' },
  [IncidentStatus.CLOSED]: { label: 'Closed' },
};

export function isIncidentActive(status: IncidentStatus): boolean {
  return (
    status === IncidentStatus.NEW ||
    status === IncidentStatus.UNDER_REVIEW ||
    status === IncidentStatus.ESCALATED
  );
}

export enum VerificationStatus {
  DRAFT = 'DRAFT',
  SUBMITTED = 'SUBMITTED',
  UNDER_REVIEW = 'UNDER_REVIEW',
  VERIFIED = 'VERIFIED',
  REJECTED = 'REJECTED',
  REQUIRES_CORRECTION = 'REQUIRES_CORRECTION',
}

export const VERIFICATION_STATUS_META: Record<VerificationStatus, { label: string }> = {
  [VerificationStatus.DRAFT]: { label: 'Draft' },
  [VerificationStatus.SUBMITTED]: { label: 'Submitted' },
  [VerificationStatus.UNDER_REVIEW]: { label: 'Under Review' },
  [VerificationStatus.VERIFIED]: { label: 'FDMIS Verified' },
  [VerificationStatus.REJECTED]: { label: 'Rejected' },
  [VerificationStatus.REQUIRES_CORRECTION]: { label: 'Correction Requested' },
};

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
  | 'NOTE_DELETE';

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
  status: 'QUEUED_OFFLINE' | 'SYNC_FAILED' | 'SYNCED';
  errorMessage?: string;
  createdAtIso: string;
  updatedAtIso: string;
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

export interface GlobalSettings {
  inactivityTimeoutMinutes: number;
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

export interface PartyConfig {
  partyCode: PartyCode;
  partyName: string;
  logoUrl: string;
  storageMode: 'firebase_storage' | 'firestore_cloud' | 'none';
  fileName?: string | null;
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
  authMethod?: 'GOOGLE' | 'PHONE_PASSWORD';
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
  clientSubmissionId: string;
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
  evidenceBase64?: string | null;
  evidenceFileName?: string | null;
  internalNotes: string;
  escalatedTo: string;
  reviewedByUid: string;
  clientSubmissionId: string;
  isTestData: boolean;
  createdAt?: FirestoreTime;
  updatedAt?: FirestoreTime;
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
  verificationStatus: VerificationStatus;
  publiclyApproved: boolean;
  reviewNote: string;
  reviewedByUid: string;
  reviewedByName: string;
  reviewedAt?: FirestoreTime;
  version: number;
  clientSubmissionId: string;
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
  errorMessage?: string;
  createdAtIso: string;
  updatedAtIso: string;
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
    role !== UserRole.POLLING_UNIT_AGENT &&
    role !== UserRole.VERIFICATION_OFFICER &&
    role !== UserRole.PENDING
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
