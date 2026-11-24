import {
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  Clock,
  CloudOff,
  FileCheck2,
  FileEdit,
  Lock,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
  XCircle,
} from 'lucide-react';
import {
  ACCOUNT_STATUS_META,
  AccountStatus,
  INCIDENT_STATUS_META,
  INCIDENT_URGENCY_META,
  IncidentStatus,
  IncidentUrgency,
  PU_STATUS_META,
  PuOperationalStatus,
  TASK_PRIORITY_META,
  TASK_STATUS_META,
  TaskPriority,
  TaskStatus,
  USER_ROLE_META,
  UserRole,
  VERIFICATION_STATUS_META,
  VerificationStatus,
  type OfflineQueueStatus,
} from '../types/fdmis';

export function AccountStatusBadge({ status }: { status: AccountStatus }) {
  if (status === AccountStatus.ACTIVE) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800 whitespace-nowrap shrink-0">
        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700" aria-hidden="true" />
        <span>{ACCOUNT_STATUS_META[status].label}</span>
      </span>
    );
  }
  if (status === AccountStatus.SUSPENDED) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-800 whitespace-nowrap shrink-0">
        <XCircle className="h-3.5 w-3.5 text-red-700" aria-hidden="true" />
        <span>{ACCOUNT_STATUS_META[status].label}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 whitespace-nowrap shrink-0">
      <Clock className="h-3.5 w-3.5 text-amber-700" aria-hidden="true" />
      <span>{ACCOUNT_STATUS_META[status].label}</span>
    </span>
  );
}

export function RoleBadge({ role }: { role: UserRole }) {
  const meta = USER_ROLE_META[role] ?? USER_ROLE_META[UserRole.PENDING];

  if (role === UserRole.FULL_CONTROL_ADMIN) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-800/20 bg-[#06452F]/10 px-2 py-0.5 text-xs font-medium text-[#06452F] whitespace-nowrap shrink-0">
        <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
        <span>{meta.label}</span>
      </span>
    );
  }
  if (role === UserRole.FUNTUA_SUPER_ADMIN || role === UserRole.DANDUME_SUPER_ADMIN) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-800 whitespace-nowrap shrink-0">
        <ShieldAlert className="h-3.5 w-3.5 text-slate-700" aria-hidden="true" />
        <span>{meta.label}</span>
      </span>
    );
  }
  if (role === UserRole.VERIFICATION_OFFICER) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-900 whitespace-nowrap shrink-0">
        <FileCheck2 className="h-3.5 w-3.5 text-sky-700" aria-hidden="true" />
        <span>{meta.label}</span>
      </span>
    );
  }
  if (role === UserRole.OPERATIONS_OFFICER) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-900 whitespace-nowrap shrink-0">
        <ShieldCheck className="h-3.5 w-3.5 text-indigo-700" aria-hidden="true" />
        <span>{meta.label}</span>
      </span>
    );
  }
  if (role === UserRole.WARD_COORDINATOR || role === UserRole.POLLING_UNIT_AGENT) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-xs font-medium text-slate-700 whitespace-nowrap shrink-0">
        <UserCheck className="h-3.5 w-3.5 text-slate-600" aria-hidden="true" />
        <span>{meta.label}</span>
      </span>
    );
  }
  if (role === UserRole.ORDINARY_USER) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-700 whitespace-nowrap shrink-0">
        <UserCheck className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
        <span>{meta.label}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 whitespace-nowrap shrink-0">
      <Lock className="h-3.5 w-3.5 text-amber-700" aria-hidden="true" />
      <span>{meta.label}</span>
    </span>
  );
}

export function PuStatusBadge({ status }: { status: PuOperationalStatus }) {
  const meta = PU_STATUS_META[status] ?? PU_STATUS_META[PuOperationalStatus.NOT_STARTED];

  if (
    status === PuOperationalStatus.INCIDENT_REPORTED ||
    status === PuOperationalStatus.COMMUNICATION_LOST
  ) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-800 whitespace-nowrap shrink-0">
        <AlertTriangle className="h-3.5 w-3.5 text-red-700" aria-hidden="true" />
        <span>{meta.label}</span>
      </span>
    );
  }

  if (status === PuOperationalStatus.RESULT_VERIFIED) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800 whitespace-nowrap shrink-0">
        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700" aria-hidden="true" />
        <span>{meta.label}</span>
      </span>
    );
  }

  if (status === PuOperationalStatus.NOT_STARTED) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-600 whitespace-nowrap shrink-0">
        <Clock className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
        <span>{meta.label}</span>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-800/20 bg-emerald-50/60 px-2 py-0.5 text-xs font-medium text-[#06452F] whitespace-nowrap shrink-0">
      <CheckCircle2 className="h-3.5 w-3.5 text-[#06452F]" aria-hidden="true" />
      <span>{meta.label}</span>
    </span>
  );
}

export function IncidentUrgencyBadge({ urgency }: { urgency: IncidentUrgency }) {
  const label = INCIDENT_URGENCY_META[urgency]?.label || urgency;
  if (urgency === IncidentUrgency.CRITICAL) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-red-300 bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-900 whitespace-nowrap shrink-0">
        <AlertOctagon className="h-3.5 w-3.5 text-red-700" aria-hidden="true" />
        <span>{label}</span>
      </span>
    );
  }
  if (urgency === IncidentUrgency.HIGH) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900 whitespace-nowrap shrink-0">
        <AlertTriangle className="h-3.5 w-3.5 text-amber-700" aria-hidden="true" />
        <span>{label}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-700 whitespace-nowrap shrink-0">
      <Clock className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}

export function IncidentStatusBadge({ status }: { status: IncidentStatus }) {
  const label = INCIDENT_STATUS_META[status]?.label || status;
  if (status === IncidentStatus.ESCALATED || status === IncidentStatus.REJECTED) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-800 whitespace-nowrap shrink-0">
        <AlertTriangle className="h-3.5 w-3.5 text-red-700" aria-hidden="true" />
        <span>{label}</span>
      </span>
    );
  }
  if (
    status === IncidentStatus.VERIFIED ||
    status === IncidentStatus.RESOLVED ||
    status === IncidentStatus.CLOSED
  ) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800 whitespace-nowrap shrink-0">
        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700" aria-hidden="true" />
        <span>{label}</span>
      </span>
    );
  }
  if (status === IncidentStatus.UNDER_INVESTIGATION) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-900 whitespace-nowrap shrink-0">
        <ShieldAlert className="h-3.5 w-3.5 text-indigo-700" aria-hidden="true" />
        <span>{label}</span>
      </span>
    );
  }
  if (status === IncidentStatus.DRAFT || status === IncidentStatus.UNVERIFIED) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-700 whitespace-nowrap shrink-0">
        <Clock className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
        <span>{label}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 whitespace-nowrap shrink-0">
      <Clock className="h-3.5 w-3.5 text-amber-700" aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}

export function VerificationStatusBadge({ status }: { status: VerificationStatus }) {
  const label = VERIFICATION_STATUS_META[status]?.label || status;
  if (status === VerificationStatus.VERIFIED || status === VerificationStatus.CORRECTED) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800 whitespace-nowrap shrink-0">
        <FileCheck2 className="h-3.5 w-3.5 text-emerald-700" aria-hidden="true" />
        <span>{label}</span>
      </span>
    );
  }
  if (status === VerificationStatus.REJECTED || status === VerificationStatus.DISCREPANCY_DETECTED) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-800 whitespace-nowrap shrink-0">
        {status === VerificationStatus.DISCREPANCY_DETECTED ? (
          <AlertTriangle className="h-3.5 w-3.5 text-red-700" aria-hidden="true" />
        ) : (
          <XCircle className="h-3.5 w-3.5 text-red-700" aria-hidden="true" />
        )}
        <span>{label}</span>
      </span>
    );
  }
  if (status === VerificationStatus.REQUIRES_CORRECTION) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900 whitespace-nowrap shrink-0">
        <FileEdit className="h-3.5 w-3.5 text-amber-700" aria-hidden="true" />
        <span>{label}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-700 whitespace-nowrap shrink-0">
      <Clock className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}

export function OfflineSyncBadge({ status }: { status: OfflineQueueStatus }) {
  if (status === 'SYNCED') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-800 whitespace-nowrap shrink-0">
        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700" aria-hidden="true" />
        <span>SYNCHRONIZED</span>
      </span>
    );
  }
  if (status === 'SYNCING') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-sky-900 whitespace-nowrap shrink-0">
        <RefreshCw className="h-3.5 w-3.5 animate-spin text-sky-700" aria-hidden="true" />
        <span>SYNCHRONIZING</span>
      </span>
    );
  }
  if (status === 'SYNC_FAILED') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-red-800 whitespace-nowrap shrink-0">
        <AlertTriangle className="h-3.5 w-3.5 text-red-700" aria-hidden="true" />
        <span>SYNC FAILED</span>
      </span>
    );
  }
  if (status === 'PENDING_SYNC') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-900 whitespace-nowrap shrink-0">
        <Clock className="h-3.5 w-3.5 text-amber-700" aria-hidden="true" />
        <span>PENDING SYNCHRONIZATION</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-700 whitespace-nowrap shrink-0">
      <CloudOff className="h-3.5 w-3.5 text-slate-600" aria-hidden="true" />
      <span>OFFLINE (SAVED LOCALLY)</span>
    </span>
  );
}

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const label = TASK_STATUS_META[status]?.label || status;
  if (status === TaskStatus.APPROVED_COMPLETED) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800 whitespace-nowrap shrink-0">
        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700" aria-hidden="true" />
        <span>{label}</span>
      </span>
    );
  }
  if (status === TaskStatus.OVERDUE) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-red-300 bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-900 whitespace-nowrap shrink-0">
        <AlertOctagon className="h-3.5 w-3.5 text-red-700" aria-hidden="true" />
        <span>{label}</span>
      </span>
    );
  }
  if (status === TaskStatus.REVISION_REQUIRED) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900 whitespace-nowrap shrink-0">
        <FileEdit className="h-3.5 w-3.5 text-amber-700" aria-hidden="true" />
        <span>{label}</span>
      </span>
    );
  }
  if (status === TaskStatus.AWAITING_REVIEW) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-900 whitespace-nowrap shrink-0">
        <FileCheck2 className="h-3.5 w-3.5 text-indigo-700" aria-hidden="true" />
        <span>{label}</span>
      </span>
    );
  }
  if (status === TaskStatus.IN_PROGRESS) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-900 whitespace-nowrap shrink-0">
        <RefreshCw className="h-3.5 w-3.5 text-sky-700" aria-hidden="true" />
        <span>{label}</span>
      </span>
    );
  }
  if (status === TaskStatus.ACKNOWLEDGED) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-800/20 bg-emerald-50/60 px-2 py-0.5 text-xs font-medium text-[#06452F] whitespace-nowrap shrink-0">
        <UserCheck className="h-3.5 w-3.5 text-[#06452F]" aria-hidden="true" />
        <span>{label}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-700 whitespace-nowrap shrink-0">
      <Clock className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}

export function TaskPriorityBadge({ priority }: { priority: TaskPriority }) {
  const label = TASK_PRIORITY_META[priority]?.label || priority;
  if (priority === TaskPriority.CRITICAL) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-red-300 bg-red-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-red-900 whitespace-nowrap shrink-0">
        <AlertOctagon className="h-3 w-3 text-red-700" aria-hidden="true" />
        <span>{label}</span>
      </span>
    );
  }
  if (priority === TaskPriority.HIGH) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-900 whitespace-nowrap shrink-0">
        <AlertTriangle className="h-3 w-3 text-amber-700" aria-hidden="true" />
        <span>{label}</span>
      </span>
    );
  }
  if (priority === TaskPriority.MEDIUM) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-sky-900 whitespace-nowrap shrink-0">
        <span>{label}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-700 whitespace-nowrap shrink-0">
      <span>{label}</span>
    </span>
  );
}
