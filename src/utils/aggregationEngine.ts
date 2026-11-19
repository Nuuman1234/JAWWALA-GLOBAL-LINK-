import {
  FIXED_PARTIES,
  LGA_DEFINITIONS,
  TOTAL_EXPECTED_POLLING_UNITS,
  VerificationStatus,
  type AggregatedResult,
  type ApprovedPuResult,
  type LgaId,
  type PartyCode,
  type PollingUnit,
  type ResultSubmission,
  type Ward,
} from '../types/fdmis';

export interface PartyStanding {
  code: PartyCode;
  name: string;
  barColor: string;
  badgeClass: string;
  votes: number;
  percentage: number;
  rank: number;
}

export interface VoteTotalsSummary {
  verifiedPuCount: number;
  expectedPuCount: number;
  pendingSubmissionCount: number;
  apcVotes: number;
  pdpVotes: number;
  adcVotes: number;
  othersVotes: number;
  registeredVoters: number;
  accreditedVoters: number;
  validVotes: number;
  rejectedVotes: number;
  totalVotesCast: number;
  standings: PartyStanding[];
}

export interface SubmissionValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  partySum: number;
  totalVotesCast: number;
}

export function validateResultFigures(input: {
  apcVotes: string | number;
  pdpVotes: string | number;
  adcVotes: string | number;
  othersVotes: string | number;
  registeredVoters: string | number;
  accreditedVoters: string | number;
  validVotes: string | number;
  rejectedVotes: string | number;
  totalVotesCast: string | number;
}): SubmissionValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const fields: Array<{ key: string; label: string; val: string | number }> = [
    { key: 'apc', label: 'APC votes', val: input.apcVotes },
    { key: 'pdp', label: 'PDP votes', val: input.pdpVotes },
    { key: 'adc', label: 'ADC votes', val: input.adcVotes },
    { key: 'others', label: 'OTHERS votes', val: input.othersVotes },
    { key: 'reg', label: 'Total registered voters', val: input.registeredVoters },
    { key: 'acc', label: 'Total accredited voters', val: input.accreditedVoters },
    { key: 'valid', label: 'Total valid votes', val: input.validVotes },
    { key: 'rej', label: 'Rejected votes', val: input.rejectedVotes },
    { key: 'cast', label: 'Total votes cast', val: input.totalVotesCast },
  ];

  const nums: Record<string, number> = {};
  for (const f of fields) {
    const raw = typeof f.val === 'string' ? f.val.trim() : String(f.val);
    if (raw === '') {
      errors.push(`${f.label} is required (enter 0 if none).`);
      nums[f.key] = 0;
      continue;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
      errors.push(`${f.label} must be a whole integer.`);
      nums[f.key] = 0;
      continue;
    }
    if (parsed < 0) {
      errors.push(`${f.label} cannot be negative.`);
    }
    if (parsed > 50000) {
      errors.push(`${f.label} exceeds polling unit upper limit (50,000).`);
    }
    nums[f.key] = parsed;
  }

  const partySum = nums.apc + nums.pdp + nums.adc + nums.others;
  const expectedTotalCast = nums.valid + nums.rej;

  if (nums.valid !== partySum) {
    errors.push(
      `Total valid votes (${nums.valid.toLocaleString()}) must equal APC + PDP + ADC + OTHERS (${partySum.toLocaleString()}).`
    );
  }

  if (nums.cast !== expectedTotalCast) {
    errors.push(
      `Total votes cast (${nums.cast.toLocaleString()}) must equal valid votes + rejected votes (${expectedTotalCast.toLocaleString()}).`
    );
  }

  // Consistency checks / warnings (never silently alter figures!)
  if (nums.reg > 0 && nums.acc > nums.reg) {
    warnings.push(
      `Accredited voters (${nums.acc.toLocaleString()}) exceed registered voters (${nums.reg.toLocaleString()}).`
    );
  }
  if (nums.acc > 0 && nums.cast > nums.acc) {
    warnings.push(
      `Total votes cast (${nums.cast.toLocaleString()}) exceed accredited voters (${nums.acc.toLocaleString()}) — potential over-voting.`
    );
  }
  if (nums.reg > 0 && nums.cast > nums.reg) {
    warnings.push(
      `Total votes cast (${nums.cast.toLocaleString()}) exceed registered voters (${nums.reg.toLocaleString()}).`
    );
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    partySum,
    totalVotesCast: nums.cast,
  };
}

export function buildPartyStandings(counts: {
  apcVotes: number;
  pdpVotes: number;
  adcVotes: number;
  othersVotes: number;
  validVotes?: number;
}): PartyStanding[] {
  const partyVoteMap: Record<PartyCode, number> = {
    APC: Math.max(0, counts.apcVotes || 0),
    PDP: Math.max(0, counts.pdpVotes || 0),
    ADC: Math.max(0, counts.adcVotes || 0),
    OTHERS: Math.max(0, counts.othersVotes || 0),
  };

  const denominator =
    counts.validVotes && counts.validVotes > 0
      ? counts.validVotes
      : partyVoteMap.APC + partyVoteMap.PDP + partyVoteMap.ADC + partyVoteMap.OTHERS;

  const sorted = [...FIXED_PARTIES]
    .map((p) => {
      const votes = partyVoteMap[p.code];
      const percentage = denominator > 0 ? Number(((votes / denominator) * 100).toFixed(2)) : 0;
      return {
        code: p.code,
        name: p.name,
        barColor: p.barColor,
        badgeClass: p.badgeClass,
        votes,
        percentage,
        rank: 0,
      };
    })
    .sort((a, b) => b.votes - a.votes);

  let currentRank = 1;
  sorted.forEach((item, idx) => {
    if (idx > 0 && item.votes < sorted[idx - 1].votes) {
      currentRank = idx + 1;
    }
    item.rank = item.votes > 0 ? currentRank : 0;
  });

  // Restore deterministic tie display or rank order (highest votes first)
  return sorted;
}

export function getCanonicalApprovedPuResults(
  approvedPuResults: ApprovedPuResult[],
  submissions: ResultSubmission[]
): ApprovedPuResult[] {
  const byPu = new Map<string, ApprovedPuResult>();

  // First, seed from canonical approved_pu_results collection (authoritative, 1 per PU)
  for (const item of approvedPuResults) {
    byPu.set(item.puId, item);
  }

  // Fallback for any legacy VERIFIED result_submissions created prior to approved_pu_results backfill
  for (const sub of submissions) {
    if (sub.verificationStatus !== VerificationStatus.VERIFIED) continue;
    if (byPu.has(sub.puId)) continue;
    byPu.set(sub.puId, {
      id: sub.puId,
      puId: sub.puId,
      puCode: sub.puCode,
      puName: sub.puName,
      lgaId: sub.lgaId,
      wardId: sub.wardId,
      wardName: sub.wardName,
      sourceSubmissionId: sub.id,
      submittedByUid: sub.submittedByUid,
      submittedByName: sub.submittedByName,
      approvedByUid: sub.reviewedByUid,
      approvedByName: sub.reviewedByName,
      apcVotes: Number(sub.apcVotes || 0),
      pdpVotes: Number(sub.pdpVotes || 0),
      adcVotes: Number(sub.adcVotes || 0),
      othersVotes: Number(sub.othersVotes || 0),
      registeredVoters: sub.registeredVoters,
      accreditedVoters: sub.accreditedVoters,
      validVotes: sub.validVotes,
      rejectedVotes: sub.rejectedVotes,
      totalVotesCast: sub.totalVotesCast,
      approvedAt: sub.reviewedAt || sub.updatedAt,
      updatedAt: sub.updatedAt,
    });
  }

  return Array.from(byPu.values());
}

export function summarizeVoteTotals(
  records: ApprovedPuResult[],
  expectedPuCount: number,
  pendingSubmissionCount = 0
): VoteTotalsSummary {
  let apcVotes = 0;
  let pdpVotes = 0;
  let adcVotes = 0;
  let othersVotes = 0;
  let registeredVoters = 0;
  let accreditedVoters = 0;
  let validVotes = 0;
  let rejectedVotes = 0;
  let totalVotesCast = 0;

  for (const r of records) {
    apcVotes += Number(r.apcVotes || 0);
    pdpVotes += Number(r.pdpVotes || 0);
    adcVotes += Number(r.adcVotes || 0);
    othersVotes += Number(r.othersVotes || 0);
    registeredVoters += Number(r.registeredVoters || 0);
    accreditedVoters += Number(r.accreditedVoters || 0);
    validVotes += Number(r.validVotes || 0);
    rejectedVotes += Number(r.rejectedVotes || 0);
    totalVotesCast += Number(r.totalVotesCast || 0);
  }

  return {
    verifiedPuCount: records.length,
    expectedPuCount,
    pendingSubmissionCount,
    apcVotes,
    pdpVotes,
    adcVotes,
    othersVotes,
    registeredVoters,
    accreditedVoters,
    validVotes,
    rejectedVotes,
    totalVotesCast,
    standings: buildPartyStandings({
      apcVotes,
      pdpVotes,
      adcVotes,
      othersVotes,
      validVotes,
    }),
  };
}

export interface AggregationDelta {
  puCountDelta: number;
  apcVotesDelta: number;
  pdpVotesDelta: number;
  adcVotesDelta: number;
  othersVotesDelta: number;
  registeredVotersDelta: number;
  accreditedVotersDelta: number;
  validVotesDelta: number;
  rejectedVotesDelta: number;
  totalVotesCastDelta: number;
}

export function computeAggregationDelta(
  prev: Pick<
    ApprovedPuResult,
    | 'apcVotes'
    | 'pdpVotes'
    | 'adcVotes'
    | 'othersVotes'
    | 'registeredVoters'
    | 'accreditedVoters'
    | 'validVotes'
    | 'rejectedVotes'
    | 'totalVotesCast'
  > | null,
  next: Pick<
    ApprovedPuResult,
    | 'apcVotes'
    | 'pdpVotes'
    | 'adcVotes'
    | 'othersVotes'
    | 'registeredVoters'
    | 'accreditedVoters'
    | 'validVotes'
    | 'rejectedVotes'
    | 'totalVotesCast'
  > | null
): AggregationDelta {
  return {
    puCountDelta: (next ? 1 : 0) - (prev ? 1 : 0),
    apcVotesDelta: (next?.apcVotes ?? 0) - (prev?.apcVotes ?? 0),
    pdpVotesDelta: (next?.pdpVotes ?? 0) - (prev?.pdpVotes ?? 0),
    adcVotesDelta: (next?.adcVotes ?? 0) - (prev?.adcVotes ?? 0),
    othersVotesDelta: (next?.othersVotes ?? 0) - (prev?.othersVotes ?? 0),
    registeredVotersDelta: (next?.registeredVoters ?? 0) - (prev?.registeredVoters ?? 0),
    accreditedVotersDelta: (next?.accreditedVoters ?? 0) - (prev?.accreditedVoters ?? 0),
    validVotesDelta: (next?.validVotes ?? 0) - (prev?.validVotes ?? 0),
    rejectedVotesDelta: (next?.rejectedVotes ?? 0) - (prev?.rejectedVotes ?? 0),
    totalVotesCastDelta: (next?.totalVotesCast ?? 0) - (prev?.totalVotesCast ?? 0),
  };
}

export function applyAggregationDelta(
  existing: AggregatedResult | null,
  meta: {
    id: string;
    scopeType: 'WARD' | 'LGA' | 'CONSTITUENCY';
    scopeId: string;
    lgaId: string;
    wardId: string;
    label: string;
    actorUid: string;
  },
  delta: AggregationDelta
): Omit<AggregatedResult, 'id' | 'updatedAt'> {
  return {
    scopeType: meta.scopeType,
    scopeId: meta.scopeId,
    lgaId: meta.lgaId,
    wardId: meta.wardId,
    label: meta.label,
    verifiedPuCount: Math.max(0, (existing?.verifiedPuCount ?? 0) + delta.puCountDelta),
    apcVotes: Math.max(0, (existing?.apcVotes ?? 0) + delta.apcVotesDelta),
    pdpVotes: Math.max(0, (existing?.pdpVotes ?? 0) + delta.pdpVotesDelta),
    adcVotes: Math.max(0, (existing?.adcVotes ?? 0) + delta.adcVotesDelta),
    othersVotes: Math.max(0, (existing?.othersVotes ?? 0) + delta.othersVotesDelta),
    registeredVoters: Math.max(0, (existing?.registeredVoters ?? 0) + delta.registeredVotersDelta),
    accreditedVoters: Math.max(0, (existing?.accreditedVoters ?? 0) + delta.accreditedVotersDelta),
    validVotes: Math.max(0, (existing?.validVotes ?? 0) + delta.validVotesDelta),
    rejectedVotes: Math.max(0, (existing?.rejectedVotes ?? 0) + delta.rejectedVotesDelta),
    totalVotesCast: Math.max(0, (existing?.totalVotesCast ?? 0) + delta.totalVotesCastDelta),
    updatedByUid: meta.actorUid,
  };
}

export function buildWardSummary(
  ward: Ward,
  approved: ApprovedPuResult[],
  pollingUnits: PollingUnit[],
  submissions: ResultSubmission[]
): VoteTotalsSummary {
  const wardApproved = approved.filter((a) => a.wardId === ward.id);
  const wardPus = pollingUnits.filter((p) => p.wardId === ward.id);
  const expected = wardPus.length > 0 ? wardPus.length : ward.expectedPollingUnits;
  const pendingCount = submissions.filter(
    (s) =>
      s.wardId === ward.id &&
      (s.verificationStatus === VerificationStatus.SUBMITTED ||
        s.verificationStatus === VerificationStatus.UNDER_REVIEW)
  ).length;

  return summarizeVoteTotals(wardApproved, expected, pendingCount);
}

export function buildLgaSummary(
  lgaId: LgaId,
  approved: ApprovedPuResult[],
  pollingUnits: PollingUnit[],
  submissions: ResultSubmission[]
): VoteTotalsSummary {
  const lgaApproved = approved.filter((a) => a.lgaId === lgaId);
  const lgaPus = pollingUnits.filter((p) => p.lgaId === lgaId);
  const expected = lgaPus.length > 0 ? lgaPus.length : LGA_DEFINITIONS[lgaId].expectedPollingUnits;
  const pendingCount = submissions.filter(
    (s) =>
      s.lgaId === lgaId &&
      (s.verificationStatus === VerificationStatus.SUBMITTED ||
        s.verificationStatus === VerificationStatus.UNDER_REVIEW)
  ).length;

  return summarizeVoteTotals(lgaApproved, expected, pendingCount);
}

export function buildConstituencySummary(
  approved: ApprovedPuResult[],
  pollingUnits: PollingUnit[],
  submissions: ResultSubmission[]
): VoteTotalsSummary {
  const expected =
    pollingUnits.length > 0 ? pollingUnits.length : TOTAL_EXPECTED_POLLING_UNITS;
  const pendingCount = submissions.filter(
    (s) =>
      s.verificationStatus === VerificationStatus.SUBMITTED ||
      s.verificationStatus === VerificationStatus.PENDING_VERIFICATION ||
      s.verificationStatus === VerificationStatus.UNDER_REVIEW ||
      s.verificationStatus === VerificationStatus.DISCREPANCY_DETECTED
  ).length;

  return summarizeVoteTotals(approved, expected, pendingCount);
}

/**
 * Computes exact surface distance in meters between two WGS84 coordinates (Haversine formula).
 */
export function computeHaversineDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

export interface ResultDiscrepancyReport {
  hasDiscrepancy: boolean;
  severity: 'NONE' | 'WARNING' | 'CRITICAL';
  flags: string[];
  summary: string;
  duplicateSubmissionIds: string[];
  duplicateOfSubmissionId: string;
}

export interface DiscrepancyCandidateInput {
  id?: string;
  puId: string;
  puCode?: string;
  apcVotes?: number;
  pdpVotes?: number;
  adcVotes?: number;
  othersVotes?: number;
  registeredVoters: number;
  accreditedVoters: number;
  validVotes: number;
  rejectedVotes: number;
  totalVotesCast: number;
  ec8aImageBase64?: string | null;
  electionCategory?: string;
}

/**
 * Evaluates a polling unit result submission for mathematical anomalies, over-voting,
 * missing Form EC8A evidence, and duplicate submissions for the same Polling Unit.
 * Never alters figures silently; flags issues strictly for human verifier review.
 */
export function analyzeResultDiscrepancies(
  sub: DiscrepancyCandidateInput,
  allSubmissions: ResultSubmission[]
): ResultDiscrepancyReport {
  const flags: string[] = [];
  let severity: 'NONE' | 'WARNING' | 'CRITICAL' = 'NONE';

  const apc = Number(sub.apcVotes ?? 0);
  const pdp = Number(sub.pdpVotes ?? 0);
  const adc = Number(sub.adcVotes ?? 0);
  const others = Number(sub.othersVotes ?? 0);
  const partySum = apc + pdp + adc + others;

  if (partySum !== sub.validVotes) {
    flags.push(
      `Party vote sum (${partySum.toLocaleString()}) does not match recorded valid votes (${sub.validVotes.toLocaleString()}).`
    );
    severity = 'CRITICAL';
  }
  if (sub.validVotes + sub.rejectedVotes !== sub.totalVotesCast) {
    flags.push(
      `Valid (${sub.validVotes.toLocaleString()}) + Rejected (${sub.rejectedVotes.toLocaleString()}) does not equal total votes cast (${sub.totalVotesCast.toLocaleString()}).`
    );
    severity = 'CRITICAL';
  }
  if (sub.accreditedVoters > 0 && sub.totalVotesCast > sub.accreditedVoters) {
    flags.push(
      `Over-voting flag: total votes cast (${sub.totalVotesCast.toLocaleString()}) exceed accredited voters (${sub.accreditedVoters.toLocaleString()}).`
    );
    severity = 'CRITICAL';
  }
  if (sub.registeredVoters > 0 && sub.accreditedVoters > sub.registeredVoters) {
    flags.push(
      `Accredited voters (${sub.accreditedVoters.toLocaleString()}) exceed registered voters (${sub.registeredVoters.toLocaleString()}).`
    );
    severity = 'CRITICAL';
  }
  if (sub.registeredVoters > 0 && sub.totalVotesCast > sub.registeredVoters) {
    flags.push(
      `Total votes cast (${sub.totalVotesCast.toLocaleString()}) exceed registered voters (${sub.registeredVoters.toLocaleString()}).`
    );
    severity = 'CRITICAL';
  }
  if (!sub.ec8aImageBase64) {
    flags.push('Form EC8A photographic evidence is not attached.');
    if (severity === 'NONE') severity = 'WARNING';
  }

  const candidateCategory = sub.electionCategory || 'House of Representatives (Funtua/Dandume)';
  const duplicates = allSubmissions.filter(
    (other) =>
      other.id !== sub.id &&
      other.puId === sub.puId &&
      other.verificationStatus !== VerificationStatus.REJECTED &&
      (other.electionCategory || 'House of Representatives (Funtua/Dandume)') === candidateCategory
  );
  if (duplicates.length > 0) {
    flags.push(
      `Duplicate submission alert: ${duplicates.length} other active submission(s) exist for PU ${sub.puCode || sub.puId}.`
    );
    severity = 'CRITICAL';
  }

  return {
    hasDiscrepancy: flags.length > 0,
    severity,
    flags,
    summary: flags.join(' '),
    duplicateSubmissionIds: duplicates.map((d) => d.id),
    duplicateOfSubmissionId: duplicates[0]?.id || '',
  };
}

