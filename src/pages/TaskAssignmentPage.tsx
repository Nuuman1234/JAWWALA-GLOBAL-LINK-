import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  AlertTriangle,
  BellRing,
  Calendar,
  CheckCircle2,
  ClipboardList,
  Clock,
  Download,
  FileText,
  Filter,
  Paperclip,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldAlert,
  Trash2,
  Upload,
  UserCheck,
  WifiOff,
  X,
  XCircle,
} from 'lucide-react';
import {
  AccountStatus,
  LGA_DEFINITIONS,
  MIN_OPERATIONS_OFFICERS_PER_WARD,
  TASK_PRIORITY_META,
  TASK_STATUS_META,
  TaskPriority,
  TaskStatus,
  UserRole,
  canManageTasks,
  formatFirestoreTime,
  getEffectiveTaskStatus,
  type LgaId,
  type OfflineQueuedItem,
  type OperationalTask,
  type TaskUpdateEntry,
  type UserAccount,
  type Ward,
} from '../types/fdmis';
import { computeWardOperationsCoverage } from '../services/directoryService';
import {
  createOperationalTask,
  deleteOperationalTask,
  enqueueOfficerTaskUpdateOffline,
  enqueueTaskCreateOffline,
  observeTaskUpdates,
  requestOfficerFieldUpdate,
  reviewTaskSubmission,
  submitOfficerTaskUpdate,
} from '../services/taskService';
import { processEvidenceFile, type CompressedEvidence } from '../utils/evidenceCompression';
import {
  OfflineSyncBadge,
  TaskPriorityBadge,
  TaskStatusBadge,
} from '../components/StatusBadge';
import type { NavSectionId } from '../components/AppShell';

interface TaskAssignmentPageProps {
  currentUser: UserAccount;
  users: UserAccount[];
  wards: Ward[];
  tasks: OperationalTask[];
  queuedItems: OfflineQueuedItem[];
  isOnline: boolean;
  syncingNow: boolean;
  onRetrySync: () => void;
  onNavigate?: (section: NavSectionId) => void;
}

function todayDateInput(): string {
  return new Date().toISOString().slice(0, 10);
}

function plusDaysDateInput(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function TaskAssignmentPage({
  currentUser,
  users,
  wards,
  tasks,
  queuedItems,
  isOnline,
  syncingNow,
  onRetrySync,
  onNavigate,
}: TaskAssignmentPageProps) {
  const isFullAdmin = canManageTasks(currentUser.role);
  const isOfficer = currentUser.role === UserRole.OPERATIONS_OFFICER;

  const [searchQuery, setSearchQuery] = useState('');
  const [lgaFilter, setLgaFilter] = useState<'all' | LgaId>(
    currentUser.role === UserRole.FUNTUA_SUPER_ADMIN
      ? 'funtua'
      : currentUser.role === UserRole.DANDUME_SUPER_ADMIN
        ? 'dandume'
        : 'all'
  );
  const [wardFilter, setWardFilter] = useState<'all' | string>('all');
  const [officerFilter, setOfficerFilter] = useState<'all' | string>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | TaskStatus>('all');
  const [priorityFilter, setPriorityFilter] = useState<'all' | TaskPriority>('all');

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [taskUpdates, setTaskUpdates] = useState<TaskUpdateEntry[]>([]);
  const [loadingUpdates, setLoadingUpdates] = useState(false);

  // Create Task Modal form state
  const [formLga, setFormLga] = useState<LgaId>('funtua');
  const [formWardId, setFormWardId] = useState('');
  const [formOfficerUid, setFormOfficerUid] = useState('');
  const [formTitle, setFormTitle] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formPriority, setFormPriority] = useState<TaskPriority>(TaskPriority.MEDIUM);
  const [formStartDate, setFormStartDate] = useState(todayDateInput());
  const [formDueDate, setFormDueDate] = useState(plusDaysDateInput(2));
  const [creatingTask, setCreatingTask] = useState(false);

  // Officer update form state
  const [officerProgress, setOfficerProgress] = useState(0);
  const [officerReport, setOfficerReport] = useState('');
  const [officerDelayReason, setOfficerDelayReason] = useState('');
  const [officerEvidence, setOfficerEvidence] = useState<CompressedEvidence | null>(null);
  const [compressingEvidence, setCompressingEvidence] = useState(false);
  const [submittingOfficerUpdate, setSubmittingOfficerUpdate] = useState(false);

  // Admin review / request update state
  const [updateRequestText, setUpdateRequestText] = useState('');
  const [adminReviewFeedback, setAdminReviewFeedback] = useState('');
  const [adminActionBusy, setAdminActionBusy] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const [banner, setBanner] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const selectedTask = useMemo(
    () => tasks.find((t) => t.id === selectedTaskId) || null,
    [tasks, selectedTaskId]
  );

  // Sync officer update defaults when selecting a task
  useEffect(() => {
    if (!selectedTask) {
      setTaskUpdates([]);
      return;
    }
    setOfficerProgress(selectedTask.progressPercent ?? 0);
    setOfficerReport('');
    setOfficerDelayReason(selectedTask.delayReason || '');
    setOfficerEvidence(null);
    setAdminReviewFeedback(selectedTask.adminFeedback || '');
    setUpdateRequestText('');
    setConfirmDeleteId(null);

    setLoadingUpdates(true);
    const unsub = observeTaskUpdates(
      selectedTask.id,
      (entries) => {
        setTaskUpdates(entries);
        setLoadingUpdates(false);
      },
      () => {
        setLoadingUpdates(false);
      }
    );
    return () => unsub();
  }, [selectedTask?.id]);

  // Operations Officers list
  const allOfficers = useMemo(
    () =>
      users
        .filter((u) => u.role === UserRole.OPERATIONS_OFFICER)
        .sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [users]
  );

  const activeOfficers = useMemo(
    () => allOfficers.filter((u) => u.status === AccountStatus.ACTIVE && !u.sessionRevoked),
    [allOfficers]
  );

  // Understaffed wards (< 5 active Operations Officers)
  const wardCoverage = useMemo(
    () => computeWardOperationsCoverage(wards, users, MIN_OPERATIONS_OFFICERS_PER_WARD),
    [wards, users]
  );

  const understaffedWards = useMemo(
    () =>
      wardCoverage.filter(
        (w) => !w.isCompliant && (lgaFilter === 'all' || w.lgaId === lgaFilter)
      ),
    [wardCoverage, lgaFilter]
  );

  // Cascading wards & officers for Create Task Modal
  const modalWards = useMemo(
    () => wards.filter((w) => w.lgaId === formLga).sort((a, b) => a.name.localeCompare(b.name)),
    [wards, formLga]
  );

  const modalWardOfficers = useMemo(() => {
    if (!formWardId) return [];
    return activeOfficers.filter((o) => o.assignedWardId === formWardId);
  }, [activeOfficers, formWardId]);

  const modalSelectedWardCoverage = useMemo(
    () => wardCoverage.find((c) => c.wardId === formWardId) || null,
    [wardCoverage, formWardId]
  );

  // Cascading wards for filter bar
  const filterWards = useMemo(
    () =>
      wards
        .filter((w) => lgaFilter === 'all' || w.lgaId === lgaFilter)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [wards, lgaFilter]
  );

  // Relevant offline queue items for tasks
  const taskQueueItems = useMemo(
    () =>
      queuedItems.filter(
        (q) => q.reportType === 'TASK_CREATE' || q.reportType === 'TASK_OFFICER_UPDATE'
      ),
    [queuedItems]
  );

  const pendingTaskQueueCount = useMemo(
    () => taskQueueItems.filter((q) => q.status !== 'SYNCED').length,
    [taskQueueItems]
  );

  // KPI metrics computed from live/cached tasks
  const nowMs = Date.now();
  const kpis = useMemo(() => {
    let assigned = 0;
    let inProgress = 0;
    let awaitingReview = 0;
    let revisionRequired = 0;
    let completed = 0;
    let overdue = 0;

    tasks.forEach((t) => {
      const eff = getEffectiveTaskStatus(t, nowMs);
      if (eff === TaskStatus.ASSIGNED || eff === TaskStatus.ACKNOWLEDGED) assigned += 1;
      else if (eff === TaskStatus.IN_PROGRESS) inProgress += 1;
      else if (eff === TaskStatus.AWAITING_REVIEW) awaitingReview += 1;
      else if (eff === TaskStatus.REVISION_REQUIRED) revisionRequired += 1;
      else if (eff === TaskStatus.APPROVED_COMPLETED) completed += 1;
      else if (eff === TaskStatus.OVERDUE) overdue += 1;
    });

    return {
      total: tasks.length,
      assigned,
      inProgress,
      awaitingReview,
      revisionRequired,
      completed,
      overdue,
    };
  }, [tasks, nowMs]);

  const filteredTasks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return tasks.filter((t) => {
      const eff = getEffectiveTaskStatus(t, nowMs);
      if (lgaFilter !== 'all' && t.lgaId !== lgaFilter) return false;
      if (wardFilter !== 'all' && t.wardId !== wardFilter) return false;
      if (officerFilter !== 'all' && t.assignedOfficerUid !== officerFilter) return false;
      if (statusFilter !== 'all' && eff !== statusFilter) return false;
      if (priorityFilter !== 'all' && t.priority !== priorityFilter) return false;
      if (q) {
        const hay = `${t.title} ${t.description} ${t.wardName} ${t.assignedOfficerName}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [tasks, lgaFilter, wardFilter, officerFilter, statusFilter, priorityFilter, searchQuery, nowMs]);

  const openCreateModal = () => {
    setBanner(null);
    const initialLga: LgaId = lgaFilter === 'all' ? 'funtua' : lgaFilter;
    setFormLga(initialLga);
    const firstWard = wards
      .filter((w) => w.lgaId === initialLga)
      .sort((a, b) => a.name.localeCompare(b.name))[0];
    setFormWardId(firstWard?.id || '');
    const firstOfficer = firstWard
      ? activeOfficers.find((o) => o.assignedWardId === firstWard.id)
      : undefined;
    setFormOfficerUid(firstOfficer?.uid || '');
    setFormTitle('');
    setFormDescription('');
    setFormPriority(TaskPriority.MEDIUM);
    setFormStartDate(todayDateInput());
    setFormDueDate(plusDaysDateInput(2));
    setCreateModalOpen(true);
  };

  const handleCreateTaskSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBanner(null);
    const ward = wards.find((w) => w.id === formWardId);
    const officer = activeOfficers.find((o) => o.uid === formOfficerUid);
    if (!ward) {
      setBanner({ type: 'error', text: 'Select a target ward before assigning a task.' });
      return;
    }
    if (!officer) {
      setBanner({
        type: 'error',
        text: 'Select an active Operations Officer assigned to this ward.',
      });
      return;
    }
    if (formTitle.trim().length < 3 || formDescription.trim().length < 5) {
      setBanner({
        type: 'error',
        text: 'Enter a clear task title (min 3 characters) and description (min 5 characters).',
      });
      return;
    }
    if (Date.parse(formDueDate) < Date.parse(formStartDate)) {
      setBanner({
        type: 'error',
        text: 'Completion deadline must be on or after the task start date.',
      });
      return;
    }

    setCreatingTask(true);
    try {
      if (!isOnline) {
        await enqueueTaskCreateOffline(currentUser, {
          title: formTitle.trim(),
          description: formDescription.trim(),
          priority: formPriority,
          lgaId: formLga,
          wardId: ward.id,
          wardName: ward.name,
          assignedOfficerUid: officer.uid,
          assignedOfficerName: officer.displayName,
          startDateIso: formStartDate,
          dueDateIso: formDueDate,
        });
        setCreateModalOpen(false);
        setBanner({
          type: 'success',
          text: `Task "${formTitle.trim()}" saved offline and queued for automatic synchronization when internet returns.`,
        });
      } else {
        await createOperationalTask(currentUser, {
          title: formTitle.trim(),
          description: formDescription.trim(),
          priority: formPriority,
          lgaId: formLga,
          ward,
          officer,
          startDateIso: formStartDate,
          dueDateIso: formDueDate,
        });
        setCreateModalOpen(false);
        setBanner({
          type: 'success',
          text: `Task "${formTitle.trim()}" assigned to ${officer.displayName} (${ward.name} Ward).`,
        });
      }
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Unable to assign operational task.',
      });
    } finally {
      setCreatingTask(false);
    }
  };

  const handleEvidenceSelect = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCompressingEvidence(true);
    setBanner(null);
    try {
      const processed = await processEvidenceFile(file);
      setOfficerEvidence(processed);
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to process supporting file.',
      });
    } finally {
      setCompressingEvidence(false);
      e.target.value = '';
    }
  };

  const handleOfficerSubmit = async (
    nextStatus: TaskStatus.ACKNOWLEDGED | TaskStatus.IN_PROGRESS | TaskStatus.AWAITING_REVIEW
  ) => {
    if (!selectedTask) return;
    setBanner(null);

    if (nextStatus === TaskStatus.AWAITING_REVIEW && officerReport.trim().length < 5) {
      setBanner({
        type: 'error',
        text: 'Enter a field report (at least 5 characters) before submitting for administrative review.',
      });
      return;
    }

    const effectiveProgress =
      nextStatus === TaskStatus.AWAITING_REVIEW
        ? Math.max(officerProgress, 100)
        : nextStatus === TaskStatus.ACKNOWLEDGED
          ? Math.max(officerProgress, 10)
          : officerProgress;

    const updatePayload = {
      nextStatus,
      progressPercent: effectiveProgress,
      fieldReport:
        officerReport.trim() ||
        (nextStatus === TaskStatus.ACKNOWLEDGED
          ? `Assignment acknowledged by ${currentUser.displayName}.`
          : `Field progress updated to ${effectiveProgress}%.`),
      delayReason: officerDelayReason.trim(),
      evidenceBase64: officerEvidence?.base64Data || null,
      evidenceFileName: officerEvidence?.fileName || null,
    };

    setSubmittingOfficerUpdate(true);
    try {
      if (!isOnline) {
        await enqueueOfficerTaskUpdateOffline(currentUser, selectedTask, updatePayload);
        setOfficerReport('');
        setOfficerEvidence(null);
        setBanner({
          type: 'success',
          text: 'Task update saved offline. It will synchronize automatically when connectivity returns without duplicates.',
        });
      } else {
        await submitOfficerTaskUpdate(currentUser, selectedTask, updatePayload);
        setOfficerReport('');
        setOfficerEvidence(null);
        setBanner({
          type: 'success',
          text:
            nextStatus === TaskStatus.AWAITING_REVIEW
              ? 'Field report submitted for Full Admin review.'
              : nextStatus === TaskStatus.ACKNOWLEDGED
                ? 'Task assignment acknowledged.'
                : `Task progress updated to ${effectiveProgress}%.`,
        });
      }
    } catch (err) {
      if (!navigator.onLine) {
        await enqueueOfficerTaskUpdateOffline(currentUser, selectedTask, updatePayload);
        setBanner({
          type: 'success',
          text: 'Connection lost during submission — update was safely queued offline.',
        });
      } else {
        setBanner({
          type: 'error',
          text: err instanceof Error ? err.message : 'Unable to submit task update.',
        });
      }
    } finally {
      setSubmittingOfficerUpdate(false);
    }
  };

  const handleAdminRequestUpdate = async () => {
    if (!selectedTask) return;
    if (!isOnline) {
      setBanner({
        type: 'error',
        text: 'Internet connection is required to dispatch a live field update request.',
      });
      return;
    }
    setAdminActionBusy(true);
    setBanner(null);
    try {
      await requestOfficerFieldUpdate(currentUser, selectedTask, updateRequestText);
      setUpdateRequestText('');
      setBanner({
        type: 'success',
        text: `Field update requested from ${selectedTask.assignedOfficerName}.`,
      });
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Unable to request field update.',
      });
    } finally {
      setAdminActionBusy(false);
    }
  };

  const handleAdminReview = async (decision: 'APPROVE' | 'REJECT_REVISION' | 'MARK_OVERDUE') => {
    if (!selectedTask) return;
    if (!isOnline) {
      setBanner({
        type: 'error',
        text: 'Internet connection is required to record an administrative review decision.',
      });
      return;
    }
    setAdminActionBusy(true);
    setBanner(null);
    try {
      await reviewTaskSubmission(currentUser, selectedTask, decision, adminReviewFeedback);
      setBanner({
        type: 'success',
        text:
          decision === 'APPROVE'
            ? `Task "${selectedTask.title}" approved and marked completed.`
            : decision === 'MARK_OVERDUE'
              ? `Task "${selectedTask.title}" marked Overdue.`
              : `Correction request sent to ${selectedTask.assignedOfficerName}.`,
      });
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Unable to complete review decision.',
      });
    } finally {
      setAdminActionBusy(false);
    }
  };

  const handleDeleteTask = async (task: OperationalTask) => {
    if (!isOnline) {
      setBanner({ type: 'error', text: 'Connect to the internet to permanently delete a task.' });
      return;
    }
    setAdminActionBusy(true);
    setBanner(null);
    try {
      await deleteOperationalTask(currentUser, task);
      setSelectedTaskId(null);
      setConfirmDeleteId(null);
      setBanner({
        type: 'success',
        text: `Task "${task.title}" and its update history were permanently deleted.`,
      });
    } catch (err) {
      setBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Unable to delete operational task.',
      });
    } finally {
      setAdminActionBusy(false);
    }
  };

  return (
    <div className="space-y-3.5 sm:space-y-4">
      {/* Header Bar */}
      <section className="flex flex-col gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
            Field Operations Command · {isFullAdmin ? 'Full Control Admin' : isOfficer ? 'Operations Officer' : 'LGA Oversight'}
          </p>
          <h2 className="mt-1 font-display text-2xl font-bold tracking-tight text-slate-900">
            Task Assignment & Field Operations
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            {isFullAdmin
              ? 'Assign ward-level operational directives to Operations Officers, monitor deadlines, review field evidence, and track ward staffing readiness.'
              : isOfficer
                ? 'View assignments dispatched to you, acknowledge receipt, submit progress reports with evidence offline or online, and respond to Full Admin review feedback.'
                : 'Monitor field task execution and officer accountability within your assigned LGA.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 no-print">
          {pendingTaskQueueCount > 0 ? (
            <button
              type="button"
              onClick={onRetrySync}
              disabled={!isOnline || syncingNow}
              className="inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-2 text-xs font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-60"
            >
              <RefreshCw className={`h-4 w-4 ${syncingNow ? 'animate-spin' : ''}`} />
              <span>Sync {pendingTaskQueueCount} Queued</span>
            </button>
          ) : null}
          {isFullAdmin ? (
            <button
              type="button"
              onClick={openCreateModal}
              className="inline-flex min-h-[42px] items-center gap-2 rounded-lg bg-[#06452F] px-4 py-2 text-sm font-semibold text-white hover:bg-[#082d1b]"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              <span>Assign New Task</span>
            </button>
          ) : null}
        </div>
      </section>

      {/* Offline Freshness Notice */}
      {!isOnline ? (
        <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-950">
          <WifiOff className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
          <div>
            <p className="font-semibold">Offline Mode — Viewing Downloaded Assignments</p>
            <p className="mt-0.5 text-amber-900/90">
              Task updates, progress reports, and attached evidence submitted offline are saved locally and synchronize automatically when internet connectivity returns without creating duplicates.
            </p>
          </div>
        </div>
      ) : null}

      {/* Feedback Banner */}
      {banner ? (
        <div
          className={`flex items-start justify-between gap-3 rounded-lg border px-4 py-3 text-xs ${
            banner.type === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : 'border-red-200 bg-red-50 text-red-900'
          }`}
        >
          <span>{banner.text}</span>
          <button
            type="button"
            onClick={() => setBanner(null)}
            aria-label="Dismiss message"
            className="text-current opacity-70 hover:opacity-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}

      {/* KPI Strip */}
      <section className="grid grid-cols-3 gap-2 sm:gap-2.5 lg:grid-cols-6 print-grid-4">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium text-slate-500">Total Tasks</p>
          <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-slate-900">
            {kpis.total}
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium text-slate-500">Assigned / Ack.</p>
          <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-slate-800">
            {kpis.assigned}
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium text-slate-500">In Progress</p>
          <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-sky-800">
            {kpis.inProgress}
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium text-slate-500">Awaiting Review</p>
          <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-indigo-800">
            {kpis.awaitingReview}
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium text-slate-500">Approved / Done</p>
          <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-emerald-700">
            {kpis.completed}
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs font-medium text-slate-500">Overdue / Rev.</p>
          <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-red-700">
            {kpis.overdue}
            {kpis.revisionRequired > 0 ? (
              <span className="ml-1.5 text-sm font-semibold text-amber-700">
                (+{kpis.revisionRequired} rev)
              </span>
            ) : null}
          </p>
        </div>
      </section>

      {/* Understaffed Wards Alert Strip (Full Admin & Super Admin) */}
      {!isOfficer && understaffedWards.length > 0 ? (
        <section className="rounded-lg border border-amber-200 bg-amber-50/70 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-2.5">
              <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" aria-hidden="true" />
              <div>
                <h3 className="text-sm font-semibold text-amber-950">
                  Wards with Insufficient Operations Officers ({understaffedWards.length})
                </h3>
                <p className="mt-0.5 text-xs text-amber-900/90">
                  Minimum operational requirement is {MIN_OPERATIONS_OFFICERS_PER_WARD} active Operations Officers per ward.
                </p>
              </div>
            </div>
            {isFullAdmin && onNavigate ? (
              <button
                type="button"
                onClick={() => onNavigate('operations_officers')}
                className="inline-flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-950 hover:bg-amber-100"
              >
                <UserCheck className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Manage Ward Officers</span>
              </button>
            ) : null}
          </div>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {understaffedWards.slice(0, 8).map((w) => (
              <div
                key={w.wardId}
                className="flex items-center justify-between rounded-md border border-amber-200 bg-white px-3 py-2 text-xs"
              >
                <div className="min-w-0">
                  <p className="truncate font-semibold text-slate-900">{w.wardName}</p>
                  <p className="text-[11px] text-slate-500">
                    {LGA_DEFINITIONS[w.lgaId]?.shortName} LGA
                  </p>
                </div>
                <span className="ml-2 shrink-0 font-mono font-semibold tabular-nums text-amber-800">
                  {w.activeCount}/{w.minimumRequired}
                </span>
              </div>
            ))}
          </div>
          {understaffedWards.length > 8 ? (
            <p className="mt-2 text-xs text-amber-900">
              +{understaffedWards.length - 8} additional understaffed ward(s) require officer deployment.
            </p>
          ) : null}
        </section>
      ) : null}

      {/* Pending Offline Queue for Tasks */}
      {taskQueueItems.length > 0 ? (
        <section className="rounded-lg border border-slate-200 bg-white p-4 no-print">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-900">
              Offline Task Synchronization Queue ({taskQueueItems.length})
            </h3>
            <button
              type="button"
              onClick={onRetrySync}
              disabled={!isOnline || syncingNow}
              className="inline-flex min-h-[34px] items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${syncingNow ? 'animate-spin' : ''}`} />
              <span>Synchronize Now</span>
            </button>
          </div>
          <div className="mt-3 divide-y divide-slate-100">
            {taskQueueItems.slice(0, 6).map((q) => (
              <div
                key={q.clientSubmissionId}
                className="flex flex-col gap-1.5 py-2.5 text-xs sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-slate-900">{q.summary}</p>
                  <p className="text-[11px] text-slate-500">
                    Captured: {new Date(q.createdAtIso).toLocaleString()}
                    {q.syncedAtIso ? ` · Server synced: ${new Date(q.syncedAtIso).toLocaleString()}` : ''}
                    {q.errorMessage ? ` · Error: ${q.errorMessage}` : ''}
                  </p>
                </div>
                <OfflineSyncBadge status={q.status} />
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* Filters Bar */}
      <section className="rounded-lg border border-slate-200 bg-white p-4 no-print">
        <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
          <Filter className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Filter Assignments</span>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <div className="relative lg:col-span-2">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search task title, ward, or officer..."
              className="min-h-[40px] w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-900 focus:border-[#06452F] focus:outline-none"
            />
          </div>

          {!isOfficer ? (
            <>
              <select
                value={lgaFilter}
                disabled={
                  currentUser.role === UserRole.FUNTUA_SUPER_ADMIN ||
                  currentUser.role === UserRole.DANDUME_SUPER_ADMIN
                }
                onChange={(e) => {
                  setLgaFilter(e.target.value as 'all' | LgaId);
                  setWardFilter('all');
                }}
                aria-label="Filter by LGA"
                className="min-h-[40px] rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-[#06452F] focus:outline-none disabled:bg-slate-50"
              >
                <option value="all">All LGAs</option>
                <option value="funtua">Funtua LGA</option>
                <option value="dandume">Dandume LGA</option>
              </select>

              <select
                value={wardFilter}
                onChange={(e) => setWardFilter(e.target.value)}
                aria-label="Filter by Ward"
                className="min-h-[40px] rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-[#06452F] focus:outline-none"
              >
                <option value="all">All Wards</option>
                {filterWards.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} ({LGA_DEFINITIONS[w.lgaId]?.shortName})
                  </option>
                ))}
              </select>
            </>
          ) : null}

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'all' | TaskStatus)}
            aria-label="Filter by Status"
            className="min-h-[40px] rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-[#06452F] focus:outline-none"
          >
            <option value="all">All Statuses</option>
            {Object.values(TaskStatus).map((st) => (
              <option key={st} value={st}>
                {TASK_STATUS_META[st].label}
              </option>
            ))}
          </select>

          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value as 'all' | TaskPriority)}
            aria-label="Filter by Priority"
            className="min-h-[40px] rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-[#06452F] focus:outline-none"
          >
            <option value="all">All Priorities</option>
            {Object.values(TaskPriority).map((pr) => (
              <option key={pr} value={pr}>
                {TASK_PRIORITY_META[pr].label}
              </option>
            ))}
          </select>

          {!isOfficer && allOfficers.length > 0 ? (
            <select
              value={officerFilter}
              onChange={(e) => setOfficerFilter(e.target.value)}
              aria-label="Filter by Operations Officer"
              className="min-h-[40px] rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-[#06452F] focus:outline-none sm:col-span-2 lg:col-span-2"
            >
              <option value="all">All Operations Officers</option>
              {allOfficers.map((o) => (
                <option key={o.uid} value={o.uid}>
                  {o.displayName}
                </option>
              ))}
            </select>
          ) : null}
        </div>
      </section>

      {/* Task List */}
      <section className="space-y-3">
        {filteredTasks.length === 0 ? (
          <div className="rounded-lg border border-slate-200 bg-white px-6 py-12 text-center">
            <ClipboardList className="mx-auto h-9 w-9 text-slate-400" aria-hidden="true" />
            <h3 className="mt-3 text-sm font-semibold text-slate-900">
              No Operational Tasks Match Your Filter
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              {isFullAdmin
                ? 'Click "Assign New Task" to dispatch a field operation to an Operations Officer.'
                : 'Tasks assigned to you by Full Admin will appear here and remain viewable offline.'}
            </p>
          </div>
        ) : (
          filteredTasks.map((task) => {
            const effStatus = getEffectiveTaskStatus(task, nowMs);
            const hasPendingQueue = taskQueueItems.some(
              (q) => q.payload.taskId === task.id && q.status !== 'SYNCED'
            );
            return (
              <article
                key={task.id}
                onClick={() => setSelectedTaskId(task.id)}
                className="cursor-pointer rounded-lg border border-slate-200 bg-white p-4 transition-colors hover:border-[#06452F]/50"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-semibold text-slate-900">{task.title}</h3>
                      <TaskStatusBadge status={effStatus} />
                      <TaskPriorityBadge priority={task.priority} />
                      {hasPendingQueue ? <OfflineSyncBadge status="PENDING_SYNC" /> : null}
                    </div>
                    <p className="mt-1.5 line-clamp-2 text-sm text-slate-600">{task.description}</p>
                    <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                      <span className="font-medium text-slate-700">
                        {LGA_DEFINITIONS[task.lgaId]?.shortName} · {task.wardName} Ward
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>Officer: {task.assignedOfficerName}</span>
                      <span aria-hidden="true">·</span>
                      <span className="inline-flex items-center gap-1 font-mono tabular-nums">
                        <Calendar className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                        {task.startDateIso} → {task.dueDateIso}
                      </span>
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
                    <div className="w-full sm:w-36">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-500">Progress</span>
                        <span className="font-mono font-semibold tabular-nums text-slate-900">
                          {task.progressPercent}%
                        </span>
                      </div>
                      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                        <div
                          className={`h-full transition-all ${
                            effStatus === TaskStatus.APPROVED_COMPLETED
                              ? 'bg-emerald-600'
                              : effStatus === TaskStatus.OVERDUE
                                ? 'bg-red-600'
                                : 'bg-[#06452F]'
                          }`}
                          style={{ width: `${Math.min(100, Math.max(0, task.progressPercent))}%` }}
                        />
                      </div>
                    </div>
                    <span className="text-xs font-medium text-[#06452F]">
                      Open Details & Actions →
                    </span>
                  </div>
                </div>

                {/* Inline callouts for admin update requests or revision feedback */}
                {task.updateRequestNote && effStatus !== TaskStatus.APPROVED_COMPLETED ? (
                  <div className="mt-3 flex items-center gap-2 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-950">
                    <BellRing className="h-3.5 w-3.5 shrink-0 text-sky-700" aria-hidden="true" />
                    <span className="truncate">
                      <strong>Update Requested:</strong> {task.updateRequestNote}
                    </span>
                  </div>
                ) : null}

                {effStatus === TaskStatus.REVISION_REQUIRED && task.adminFeedback ? (
                  <div className="mt-2 flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-700" aria-hidden="true" />
                    <span className="truncate">
                      <strong>Correction Needed:</strong> {task.adminFeedback}
                    </span>
                  </div>
                ) : null}
              </article>
            );
          })
        )}
      </section>

      {/* CREATE TASK MODAL (Full Control Admin Only) */}
      {createModalOpen && isFullAdmin ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto fdmis-surface shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <h3 className="font-display text-lg font-bold text-slate-900">
                  Assign Operational Task
                </h3>
                <p className="text-xs text-slate-500">
                  Select target LGA, Ward, and an active Operations Officer.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCreateModalOpen(false)}
                aria-label="Close modal"
                className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCreateTaskSubmit} className="space-y-4 p-5">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    Target LGA *
                  </label>
                  <select
                    value={formLga}
                    onChange={(e) => {
                      const nextLga = e.target.value as LgaId;
                      setFormLga(nextLga);
                      const firstWard = wards
                        .filter((w) => w.lgaId === nextLga)
                        .sort((a, b) => a.name.localeCompare(b.name))[0];
                      setFormWardId(firstWard?.id || '');
                      const firstOff = firstWard
                        ? activeOfficers.find((o) => o.assignedWardId === firstWard.id)
                        : undefined;
                      setFormOfficerUid(firstOff?.uid || '');
                    }}
                    className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-[#06452F] focus:outline-none"
                  >
                    <option value="funtua">Funtua LGA</option>
                    <option value="dandume">Dandume LGA</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    Target Ward *
                  </label>
                  <select
                    value={formWardId}
                    onChange={(e) => {
                      const nextWardId = e.target.value;
                      setFormWardId(nextWardId);
                      const firstOff = activeOfficers.find((o) => o.assignedWardId === nextWardId);
                      setFormOfficerUid(firstOff?.uid || '');
                    }}
                    required
                    className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-[#06452F] focus:outline-none"
                  >
                    <option value="">Select ward...</option>
                    {modalWards.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {modalSelectedWardCoverage && !modalSelectedWardCoverage.isCompliant ? (
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                  <span>
                    <strong>Staffing Alert:</strong> {modalSelectedWardCoverage.wardName} currently has{' '}
                    {modalSelectedWardCoverage.activeCount} of {modalSelectedWardCoverage.minimumRequired}{' '}
                    required active Operations Officers.
                  </span>
                </div>
              ) : null}

              <div>
                <label className="block text-xs font-semibold text-slate-700">
                  Assigned Operations Officer *
                </label>
                <select
                  value={formOfficerUid}
                  onChange={(e) => setFormOfficerUid(e.target.value)}
                  required
                  className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-[#06452F] focus:outline-none"
                >
                  <option value="">
                    {modalWardOfficers.length === 0
                      ? 'No active Operations Officers assigned to this ward'
                      : 'Select Operations Officer...'}
                  </option>
                  {modalWardOfficers.map((o) => (
                    <option key={o.uid} value={o.uid}>
                      {o.displayName} ({o.phone || o.email})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">
                  Task Title *
                </label>
                <input
                  type="text"
                  required
                  minLength={3}
                  maxLength={160}
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  placeholder="e.g., Verify PU Agent deployment and BVAS readiness across ward"
                  className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-200 px-3 text-sm text-slate-900 focus:border-[#06452F] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700">
                  Operational Instructions & Deliverables *
                </label>
                <textarea
                  required
                  minLength={5}
                  maxLength={2000}
                  rows={4}
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  placeholder="Provide clear instructions, expected field verification evidence, and escalation requirements..."
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-[#06452F] focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700">Priority *</label>
                  <select
                    value={formPriority}
                    onChange={(e) => setFormPriority(e.target.value as TaskPriority)}
                    className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-[#06452F] focus:outline-none"
                  >
                    {Object.values(TaskPriority).map((p) => (
                      <option key={p} value={p}>
                        {TASK_PRIORITY_META[p].label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    Start Date *
                  </label>
                  <input
                    type="date"
                    required
                    value={formStartDate}
                    onChange={(e) => setFormStartDate(e.target.value)}
                    className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-200 px-3 text-sm text-slate-900 focus:border-[#06452F] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    Completion Deadline *
                  </label>
                  <input
                    type="date"
                    required
                    value={formDueDate}
                    min={formStartDate}
                    onChange={(e) => setFormDueDate(e.target.value)}
                    className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-200 px-3 text-sm text-slate-900 focus:border-[#06452F] focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-slate-200 pt-4">
                <button
                  type="button"
                  onClick={() => setCreateModalOpen(false)}
                  className="min-h-[42px] rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creatingTask || !formOfficerUid}
                  className="inline-flex min-h-[42px] items-center gap-2 rounded-lg bg-[#06452F] px-4 py-2 text-sm font-semibold text-white hover:bg-[#082d1b] disabled:opacity-50"
                >
                  <Send className="h-4 w-4" aria-hidden="true" />
                  <span>{creatingTask ? 'Assigning...' : isOnline ? 'Assign Task' : 'Queue Task Offline'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* TASK DETAIL & WORKFLOW INSPECTOR MODAL */}
      {selectedTask ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto fdmis-surface shadow-xl">
            <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-5 py-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <TaskStatusBadge status={getEffectiveTaskStatus(selectedTask, nowMs)} />
                  <TaskPriorityBadge priority={selectedTask.priority} />
                </div>
                <h3 className="mt-2 font-display text-lg font-bold text-slate-900">
                  {selectedTask.title}
                </h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  {LGA_DEFINITIONS[selectedTask.lgaId]?.displayName} · {selectedTask.wardName} Ward · Assigned to{' '}
                  <strong className="text-slate-700">{selectedTask.assignedOfficerName}</strong>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedTaskId(null)}
                aria-label="Close task details"
                className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-3.5 sm:space-y-4 p-5">
              {/* Metadata & Description */}
              <div className="grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-slate-50/70 p-3.5 text-xs sm:grid-cols-4">
                <div>
                  <p className="text-slate-500">Start Date</p>
                  <p className="mt-0.5 font-mono font-semibold text-slate-900">
                    {selectedTask.startDateIso}
                  </p>
                </div>
                <div>
                  <p className="text-slate-500">Deadline</p>
                  <p className="mt-0.5 font-mono font-semibold text-slate-900">
                    {selectedTask.dueDateIso}
                  </p>
                </div>
                <div>
                  <p className="text-slate-500">Progress</p>
                  <p className="mt-0.5 font-mono font-semibold text-slate-900">
                    {selectedTask.progressPercent}%
                  </p>
                </div>
                <div>
                  <p className="text-slate-500">Assigned By</p>
                  <p className="mt-0.5 font-semibold text-slate-900">
                    {selectedTask.assignedByName}
                  </p>
                </div>
              </div>

              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Task Instructions
                </h4>
                <p className="mt-1.5 whitespace-pre-wrap text-sm text-slate-800">
                  {selectedTask.description}
                </p>
              </div>

              {/* Latest Field Report & Delay Explanation */}
              {selectedTask.latestFieldReport || selectedTask.delayReason || selectedTask.evidenceBase64 ? (
                <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Latest Field Report & Supporting Evidence
                  </h4>
                  {selectedTask.latestFieldReport ? (
                    <p className="whitespace-pre-wrap text-sm text-slate-800">
                      {selectedTask.latestFieldReport}
                    </p>
                  ) : null}
                  {selectedTask.delayReason ? (
                    <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950">
                      <p className="font-semibold">Reported Challenges / Delay Reason</p>
                      <p className="mt-1 whitespace-pre-wrap">{selectedTask.delayReason}</p>
                    </div>
                  ) : null}
                  {selectedTask.evidenceBase64 ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="inline-flex items-center gap-1.5 font-medium text-slate-700">
                          <Paperclip className="h-3.5 w-3.5" />
                          {selectedTask.evidenceFileName || 'Attached Evidence'}
                        </span>
                        <a
                          href={selectedTask.evidenceBase64}
                          download={selectedTask.evidenceFileName || 'task_evidence'}
                          className="inline-flex items-center gap-1 font-semibold text-[#06452F] hover:underline"
                        >
                          <Download className="h-3.5 w-3.5" />
                          Download
                        </a>
                      </div>
                      {selectedTask.evidenceBase64.startsWith('data:image/') ? (
                        <img
                          src={selectedTask.evidenceBase64}
                          alt="Field evidence attachment"
                          className="max-h-64 rounded-lg border border-slate-200 object-contain"
                        />
                      ) : (
                        <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                          <FileText className="h-4 w-4 text-slate-500" />
                          <span>Document attached ({selectedTask.evidenceFileName || 'PDF'})</span>
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {/* Admin Feedback / Update Request Alerts */}
              {selectedTask.adminFeedback ? (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-3.5 text-xs text-emerald-950">
                  <p className="font-semibold">
                    Full Admin Review Feedback ({selectedTask.reviewedByName || 'Full Admin'})
                  </p>
                  <p className="mt-1 whitespace-pre-wrap">{selectedTask.adminFeedback}</p>
                </div>
              ) : null}

              {selectedTask.updateRequestNote ? (
                <div className="rounded-lg border border-sky-200 bg-sky-50 p-3.5 text-xs text-sky-950">
                  <p className="font-semibold">
                    Field Update Request ({formatFirestoreTime(selectedTask.updateRequestedAtIso)})
                  </p>
                  <p className="mt-1 whitespace-pre-wrap">{selectedTask.updateRequestNote}</p>
                </div>
              ) : null}

              {/* OPERATIONS OFFICER WORKFLOW CONTROLS */}
              {selectedTask.assignedOfficerUid === currentUser.uid &&
              selectedTask.status !== TaskStatus.APPROVED_COMPLETED ? (
                <div className="space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="text-sm font-semibold text-slate-900">
                      Operations Officer Field Update
                    </h4>
                    {!isOnline ? <OfflineSyncBadge status="SAVED_LOCALLY" /> : null}
                  </div>

                  {selectedTask.status === TaskStatus.ASSIGNED ? (
                    <button
                      type="button"
                      disabled={submittingOfficerUpdate}
                      onClick={() => void handleOfficerSubmit(TaskStatus.ACKNOWLEDGED)}
                      className="inline-flex min-h-[42px] items-center gap-2 rounded-lg bg-[#06452F] px-4 py-2 text-sm font-semibold text-white hover:bg-[#082d1b] disabled:opacity-50"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      <span>Acknowledge Assignment</span>
                    </button>
                  ) : null}

                  <div>
                    <div className="flex items-center justify-between text-xs">
                      <label className="font-semibold text-slate-700">Task Progress (%)</label>
                      <span className="font-mono font-bold text-slate-900">{officerProgress}%</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={5}
                      value={officerProgress}
                      onChange={(e) => setOfficerProgress(Number(e.target.value))}
                      className="mt-1.5 w-full accent-[#06452F]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700">
                      Field Report / Action Summary
                    </label>
                    <textarea
                      rows={3}
                      maxLength={2000}
                      value={officerReport}
                      onChange={(e) => setOfficerReport(e.target.value)}
                      placeholder="Describe actions completed in the ward, verified polling unit conditions, or findings..."
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-[#06452F] focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700">
                      Challenges / Reasons for Delay (Optional)
                    </label>
                    <textarea
                      rows={2}
                      maxLength={1000}
                      value={officerDelayReason}
                      onChange={(e) => setOfficerDelayReason(e.target.value)}
                      placeholder="Document logistics, security, weather, or communication challenges affecting timelines..."
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-[#06452F] focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700">
                      Attach Photograph or Supporting Document (Auto-Compressed)
                    </label>
                    <div className="mt-1.5 flex flex-wrap items-center gap-3">
                      <label className="inline-flex min-h-[40px] cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                        <Upload className="h-4 w-4 text-[#06452F]" />
                        <span>{compressingEvidence ? 'Compressing...' : 'Choose Photo / PDF'}</span>
                        <input
                          type="file"
                          accept="image/*,application/pdf"
                          onChange={handleEvidenceSelect}
                          className="hidden"
                        />
                      </label>
                      {officerEvidence ? (
                        <span className="inline-flex items-center gap-2 text-xs text-emerald-800">
                          <Paperclip className="h-3.5 w-3.5" />
                          <span>
                            {officerEvidence.fileName} ({Math.round(officerEvidence.sizeBytes / 1024)} KB)
                          </span>
                          <button
                            type="button"
                            onClick={() => setOfficerEvidence(null)}
                            className="text-red-700 hover:underline"
                          >
                            Remove
                          </button>
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                      type="button"
                      disabled={submittingOfficerUpdate || compressingEvidence}
                      onClick={() => void handleOfficerSubmit(TaskStatus.IN_PROGRESS)}
                      className="inline-flex min-h-[42px] items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-100 disabled:opacity-50"
                    >
                      <Clock className="h-4 w-4 text-sky-700" />
                      <span>Save Progress Update</span>
                    </button>
                    <button
                      type="button"
                      disabled={submittingOfficerUpdate || compressingEvidence}
                      onClick={() => void handleOfficerSubmit(TaskStatus.AWAITING_REVIEW)}
                      className="inline-flex min-h-[42px] items-center gap-2 rounded-lg bg-[#06452F] px-4 py-2 text-xs font-semibold text-white hover:bg-[#082d1b] disabled:opacity-50"
                    >
                      <Send className="h-4 w-4" />
                      <span>Mark Completed for Admin Review</span>
                    </button>
                  </div>
                </div>
              ) : null}

              {/* FULL ADMIN REVIEW & MONITORING CONTROLS */}
              {isFullAdmin ? (
                <div className="space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <h4 className="text-sm font-semibold text-slate-900">
                    Full Admin Review & Field Directives
                  </h4>

                  {/* Request Field Update */}
                  {selectedTask.status !== TaskStatus.APPROVED_COMPLETED ? (
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <input
                        type="text"
                        value={updateRequestText}
                        onChange={(e) => setUpdateRequestText(e.target.value)}
                        placeholder="Request immediate field update from assigned officer..."
                        className="min-h-[40px] flex-1 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-900 focus:border-[#06452F] focus:outline-none"
                      />
                      <button
                        type="button"
                        disabled={adminActionBusy || !isOnline}
                        onClick={() => void handleAdminRequestUpdate()}
                        className="inline-flex min-h-[40px] shrink-0 items-center justify-center gap-1.5 rounded-lg border border-sky-300 bg-sky-50 px-3.5 py-2 text-xs font-semibold text-sky-900 hover:bg-sky-100 disabled:opacity-50"
                      >
                        <BellRing className="h-3.5 w-3.5" />
                        <span>Request Update</span>
                      </button>
                    </div>
                  ) : null}

                  {/* Review Feedback + Approve / Revision / Overdue */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700">
                      Administrative Review Feedback / Correction Instructions
                    </label>
                    <textarea
                      rows={2}
                      maxLength={1500}
                      value={adminReviewFeedback}
                      onChange={(e) => setAdminReviewFeedback(e.target.value)}
                      placeholder="Enter approval remarks or mandatory correction instructions for the officer..."
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-[#06452F] focus:outline-none"
                    />
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={adminActionBusy || !isOnline}
                        onClick={() => void handleAdminReview('APPROVE')}
                        className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-[#06452F] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#082d1b] disabled:opacity-50"
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        <span>Approve & Complete</span>
                      </button>
                      <button
                        type="button"
                        disabled={adminActionBusy || !isOnline}
                        onClick={() => void handleAdminReview('REJECT_REVISION')}
                        className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-2 text-xs font-semibold text-amber-950 hover:bg-amber-100 disabled:opacity-50"
                      >
                        <XCircle className="h-4 w-4" />
                        <span>Request Revision</span>
                      </button>
                      <button
                        type="button"
                        disabled={adminActionBusy || !isOnline}
                        onClick={() => void handleAdminReview('MARK_OVERDUE')}
                        className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2 text-xs font-semibold text-red-900 hover:bg-red-100 disabled:opacity-50"
                      >
                        <AlertTriangle className="h-4 w-4" />
                        <span>Mark Overdue</span>
                      </button>
                    </div>

                    {confirmDeleteId === selectedTask.id ? (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={adminActionBusy}
                          onClick={() => void handleDeleteTask(selectedTask)}
                          className="min-h-[38px] rounded-lg bg-red-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-800"
                        >
                          Confirm Permanent Delete
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          className="min-h-[38px] rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-600"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(selectedTask.id)}
                        className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        <span>Delete Task</span>
                      </button>
                    )}
                  </div>
                </div>
              ) : null}

              {/* Chronological Task Update History */}
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Chronological Field & Review History
                </h4>
                {loadingUpdates ? (
                  <p className="mt-2 text-xs text-slate-500">Loading update history...</p>
                ) : taskUpdates.length === 0 ? (
                  <p className="mt-2 text-xs text-slate-500">
                    No field reports or review entries logged yet.
                  </p>
                ) : (
                  <div className="mt-2.5 space-y-2.5">
                    {taskUpdates.map((upd) => (
                      <div
                        key={upd.id}
                        className="rounded-lg border border-slate-200 bg-white p-3 text-xs"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-slate-900">{upd.actorName}</span>
                            <TaskStatusBadge status={upd.statusSnapshot} />
                            <span className="font-mono text-slate-600">{upd.progressPercent}%</span>
                          </div>
                          <span className="text-[11px] text-slate-500">
                            {formatFirestoreTime(upd.clientCreatedAtIso || upd.createdAt)}
                          </span>
                        </div>
                        <p className="mt-1.5 whitespace-pre-wrap text-slate-700">{upd.summary}</p>
                        {upd.delayReason ? (
                          <p className="mt-1 text-amber-800">
                            <strong>Delay / Challenge:</strong> {upd.delayReason}
                          </p>
                        ) : null}
                        {upd.evidenceBase64 ? (
                          <div className="mt-2">
                            <a
                              href={upd.evidenceBase64}
                              download={upd.evidenceFileName || 'update_evidence'}
                              className="inline-flex items-center gap-1 font-medium text-[#06452F] hover:underline"
                            >
                              <Paperclip className="h-3 w-3" />
                              <span>{upd.evidenceFileName || 'Attached Evidence'}</span>
                            </a>
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
