import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  AlertOctagon,
  Bell,
  Check,
  CheckCheck,
  CheckCircle2,
  Lock,
  Mail,
  MessageSquare,
  Plus,
  RefreshCw,
  Send,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import { EmptyState } from '../components/EmptyState';
import { OfflineSyncBadge } from '../components/StatusBadge';
import { WhatsAppGroupCard } from '../components/WhatsAppGroupCard';
import {
  IncidentUrgency,
  LGA_DEFINITIONS,
  TaskStatus,
  USER_ROLE_META,
  UserRole,
  VerificationStatus,
  canReviewIncidents,
  formatFirestoreTime,
  getEffectiveTaskStatus,
  isIncidentActive,
  type EscalationRule,
  type GlobalSettings,
  type IncidentReport,
  type LgaId,
  type NotificationItem,
  type OfflineQueuedItem,
  type OperationalTask,
  type ResultSubmission,
  type UserAccount,
  type Ward,
} from '../types/fdmis';
import { enqueueOfflineSubmission } from '../services/offlineQueue';
import { sendSituationNotification } from '../services/operationsService';
import { deleteEscalationRule, saveEscalationRule } from '../services/emergencyService';

interface NotificationsPageProps {
  user: UserAccount;
  wards: Ward[];
  notifications: NotificationItem[];
  settings: GlobalSettings | null;
  incidents?: IncidentReport[];
  results?: ResultSubmission[];
  tasks?: OperationalTask[];
  escalationRules?: EscalationRule[];
  isOnline?: boolean;
  queuedItems?: OfflineQueuedItem[];
  onRetrySync?: () => void;
  syncingNow?: boolean;
}

const ESCALATION_TRIGGER_LABELS: Record<EscalationRule['triggerType'], string> = {
  MISSING_CHECKIN: 'Missing Field Check-In',
  CRITICAL_INCIDENT: 'Critical Incident Alert',
  OVERDUE_TASK: 'Overdue Operations Task',
  RESULT_DISCREPANCY: 'Result Discrepancy Flag',
  SYNC_FAILURE: 'Repeated Offline Sync Failure',
  LOW_WARD_COVERAGE: 'Low Ward Staffing / Coverage',
  EMERGENCY_ASSISTANCE: 'Emergency Assistance Request',
};

export function NotificationsPage({
  user,
  wards,
  notifications,
  settings,
  incidents = [],
  results = [],
  tasks = [],
  escalationRules = [],
  isOnline = true,
  queuedItems = [],
  onRetrySync,
  syncingNow = false,
}: NotificationsPageProps) {
  const canBroadcast = canReviewIncidents(user.role);
  const isFullAdmin = user.role === UserRole.FULL_CONTROL_ADMIN;
  const isWardScopedRole =
    user.role === UserRole.WARD_COORDINATOR || user.role === UserRole.OPERATIONS_OFFICER;

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [targetLgaId, setTargetLgaId] = useState<string>(
    isFullAdmin ? 'all' : user.assignedLgaId || 'all'
  );
  const [targetWardId, setTargetWardId] = useState<string>(
    isWardScopedRole ? user.assignedWardId : ''
  );
  const [isCritical, setIsCritical] = useState(false);
  const [isTestData, setIsTestData] = useState(false);
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'warn' | 'err'; text: string } | null>(
    null
  );

  // Per-user persisted read/unread tracking
  const readStorageKey = `fdmis_read_notifs_${user.uid}`;
  const [readIds, setReadIds] = useState<Set<string>>(() => {
    try {
      const raw = window.localStorage.getItem(readStorageKey);
      const parsed = raw ? (JSON.parse(raw) as unknown) : [];
      return new Set(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []);
    } catch {
      return new Set();
    }
  });
  const [notifFilter, setNotifFilter] = useState<'ALL' | 'UNREAD' | 'CRITICAL'>('ALL');

  useEffect(() => {
    try {
      window.localStorage.setItem(readStorageKey, JSON.stringify(Array.from(readIds).slice(-400)));
    } catch {
      // Ignore storage quota errors
    }
  }, [readIds, readStorageKey]);

  // Escalation Rules form state (Full Control Admin only)
  const [showRuleForm, setShowRuleForm] = useState(false);
  const [ruleName, setRuleName] = useState('');
  const [ruleTrigger, setRuleTrigger] = useState<EscalationRule['triggerType']>('CRITICAL_INCIDENT');
  const [rulePriority, setRulePriority] = useState<IncidentUrgency>(IncidentUrgency.CRITICAL);
  const [ruleResponsibleRole, setRuleResponsibleRole] = useState<UserRole>(UserRole.OPERATIONS_OFFICER);
  const [ruleRecipientRole, setRuleRecipientRole] = useState<UserRole>(UserRole.FULL_CONTROL_ADMIN);
  const [ruleEscalateMins, setRuleEscalateMins] = useState('30');
  const [ruleMaxPerHour, setRuleMaxPerHour] = useState('6');
  const [savingRule, setSavingRule] = useState(false);

  const wardsInTargetLga = useMemo(
    () => wards.filter((w) => targetLgaId === 'all' || w.lgaId === targetLgaId),
    [wards, targetLgaId]
  );

  // Deduplicated live Smart Operational Alerts summary (strictly from real records)
  const smartAlertCounts = useMemo(() => {
    const criticalActiveIncidents = incidents.filter(
      (i) => i.urgency === IncidentUrgency.CRITICAL && isIncidentActive(i.status)
    ).length;
    const resultDiscrepancies = results.filter(
      (r) =>
        r.verificationStatus === VerificationStatus.DISCREPANCY_DETECTED ||
        Boolean(r.discrepancyFlag)
    ).length;
    const overdueTasks = tasks.filter(
      (t) => getEffectiveTaskStatus(t) === TaskStatus.OVERDUE
    ).length;
    const failedQueue = queuedItems.filter(
      (q) => q.status === 'SYNC_FAILED' || q.conflictState === 'CONFLICT_DETECTED'
    ).length;
    return { criticalActiveIncidents, resultDiscrepancies, overdueTasks, failedQueue };
  }, [incidents, results, tasks, queuedItems]);

  const unreadCount = useMemo(
    () => notifications.filter((n) => !readIds.has(n.id)).length,
    [notifications, readIds]
  );

  const visibleNotifications = useMemo(() => {
    return notifications.filter((n) => {
      if (notifFilter === 'UNREAD') return !readIds.has(n.id);
      if (notifFilter === 'CRITICAL') return n.isCritical;
      return true;
    });
  }, [notifications, notifFilter, readIds]);

  const toggleReadState = (id: string) => {
    setReadIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const markAllRead = () => {
    setReadIds((prev) => {
      const next = new Set(prev);
      notifications.forEach((n) => next.add(n.id));
      return next;
    });
  };

  const handleSaveRule = async (e: FormEvent) => {
    e.preventDefault();
    if (!isFullAdmin || ruleName.trim().length < 3) return;
    setSavingRule(true);
    setFeedback(null);
    try {
      await saveEscalationRule(user, {
        ruleName: ruleName.trim(),
        triggerType: ruleTrigger,
        priority: rulePriority,
        responsibleRole: ruleResponsibleRole,
        recipientRole: ruleRecipientRole,
        escalateAfterMinutes: Math.max(5, Number(ruleEscalateMins) || 30),
        maxNotificationsPerHour: Math.max(1, Number(ruleMaxPerHour) || 6),
        enabled: true,
      });
      setRuleName('');
      setShowRuleForm(false);
      setFeedback({ type: 'ok', text: 'Escalation rule saved and activated.' });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to save escalation rule.',
      });
    } finally {
      setSavingRule(false);
    }
  };

  const handleToggleRuleEnabled = async (rule: EscalationRule) => {
    if (!isFullAdmin) return;
    try {
      await saveEscalationRule(
        user,
        {
          ruleName: rule.ruleName,
          triggerType: rule.triggerType,
          priority: rule.priority,
          responsibleRole: rule.responsibleRole,
          recipientRole: rule.recipientRole,
          escalateAfterMinutes: rule.escalateAfterMinutes,
          maxNotificationsPerHour: rule.maxNotificationsPerHour,
          enabled: !rule.enabled,
        },
        rule.id
      );
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to update escalation rule.',
      });
    }
  };

  const handleDeleteRule = async (ruleId: string) => {
    if (!isFullAdmin) return;
    try {
      await deleteEscalationRule(user, ruleId);
      setFeedback({ type: 'ok', text: 'Escalation rule removed.' });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to remove escalation rule.',
      });
    }
  };

  const queuedBroadcasts = useMemo(
    () =>
      queuedItems.filter(
        (item) => item.reportType === 'NOTIFICATION_BROADCAST' && item.status !== 'SYNCED'
      ),
    [queuedItems]
  );

  const handleBroadcast = async (e: FormEvent) => {
    e.preventDefault();
    if (title.trim().length < 3 || body.trim().length < 5) {
      setFeedback({ type: 'err', text: 'Title and message body are required.' });
      return;
    }
    setSending(true);
    setFeedback(null);

    const payload = {
      title: title.trim(),
      body: body.trim(),
      targetLgaId,
      targetWardId,
      isCritical,
      isTestData,
    };

    if (!isOnline) {
      await enqueueOfflineSubmission({
        ownerUid: user.uid,
        reportType: 'NOTIFICATION_BROADCAST',
        puId: '',
        puCode: '',
        puName: '',
        lgaId: (targetLgaId === 'funtua' || targetLgaId === 'dandume'
          ? targetLgaId
          : 'all') as LgaId | 'all',
        wardId: targetWardId,
        summary: `${isCritical ? '[CRITICAL] ' : ''}${payload.title}`,
        payload,
        status: 'PENDING_SYNC',
      });
      setTitle('');
      setBody('');
      setIsCritical(false);
      setIsTestData(false);
      setSending(false);
      setFeedback({
        type: 'warn',
        text: 'OFFLINE: Directive saved locally as PENDING SYNCHRONIZATION and will broadcast automatically when internet returns.',
      });
      return;
    }

    try {
      await sendSituationNotification(user, payload);
      setTitle('');
      setBody('');
      setIsCritical(false);
      setIsTestData(false);
      setFeedback({
        type: 'ok',
        text: 'In-app notification broadcast SYNCHRONIZED and delivered to scoped operators.',
      });
    } catch (err) {
      if (!navigator.onLine) {
        await enqueueOfflineSubmission({
          ownerUid: user.uid,
          reportType: 'NOTIFICATION_BROADCAST',
          puId: '',
          puCode: '',
          puName: '',
          lgaId: (targetLgaId === 'funtua' || targetLgaId === 'dandume'
            ? targetLgaId
            : 'all') as LgaId | 'all',
          wardId: targetWardId,
          summary: `${isCritical ? '[CRITICAL] ' : ''}${payload.title}`,
          payload,
          status: 'SYNC_FAILED',
        });
        setFeedback({
          type: 'warn',
          text: 'Connection lost while broadcasting. Directive saved offline for automatic synchronization.',
        });
      } else {
        setFeedback({
          type: 'err',
          text: err instanceof Error ? err.message : 'Unable to send notification.',
        });
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Free Core & External Communication Channel Status */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-emerald-950">In-App Notifications</span>
            <CheckCircle2 className="h-4 w-4 text-[#0b3b24]" aria-hidden="true" />
          </div>
          <p className="mt-1.5 text-sm font-semibold text-[#0b3b24]">Active · Free Core Channel</p>
          <p className="mt-0.5 text-[11px] text-emerald-900/80">
            Operates independently without external API keys.
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-600">SMS / USSD Fallback</span>
            <Lock className="h-4 w-4 text-slate-400" aria-hidden="true" />
          </div>
          <p className="mt-1.5 text-sm font-semibold text-slate-900">
            {settings?.smsFallbackConfigured ? 'Configured' : 'Not Configured'}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            {settings?.smsFallbackConfigured
              ? 'Server provider verified'
              : 'Disabled until real server credentials are configured'}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-600">WhatsApp Alert Gateway</span>
            <MessageSquare className="h-4 w-4 text-slate-400" aria-hidden="true" />
          </div>
          <p className="mt-1.5 text-sm font-semibold text-slate-900">
            {settings?.whatsappConfigured ? 'Configured' : 'Not Configured'}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            {settings?.whatsappConfigured
              ? 'Server gateway active'
              : 'Inactive · Use free Situation Room group link below'}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-600">Email Dispatch Gateway</span>
            <Mail className="h-4 w-4 text-slate-400" aria-hidden="true" />
          </div>
          <p className="mt-1.5 text-sm font-semibold text-slate-900">
            {settings?.emailConfigured ? 'Configured' : 'Not Configured'}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            {settings?.emailConfigured
              ? 'Server email relay active'
              : 'Inactive · Optional free-tier server relay supported'}
          </p>
        </div>
      </div>

      {/* Authenticated-Only WhatsApp Group Integration */}
      <WhatsAppGroupCard settings={settings} />

      {/* Broadcast Form */}
      {canBroadcast ? (
        <form
          onSubmit={handleBroadcast}
          className="rounded-xl border border-slate-200 bg-white p-5 space-y-4"
        >
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
            <Bell className="h-4 w-4 text-[#0b3b24]" aria-hidden="true" />
            <h2 className="font-display text-sm font-semibold text-slate-900">
              Broadcast Situation Room Directive
            </h2>
          </div>

          {feedback ? (
            <div
              className={`rounded-lg border px-4 py-3 text-sm ${
                feedback.type === 'ok'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                  : feedback.type === 'warn'
                    ? 'border-amber-200 bg-amber-50 text-amber-900'
                    : 'border-red-200 bg-red-50 text-red-900'
              }`}
            >
              {feedback.text}
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="notif-title" className="block text-xs font-medium text-slate-700">
                Headline
              </label>
              <input
                id="notif-title"
                type="text"
                required
                minLength={3}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Operational directive or alert..."
                className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-300 px-3 text-sm"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="notif-lga" className="block text-xs font-medium text-slate-700">
                  Target LGA
                </label>
                <select
                  id="notif-lga"
                  disabled={!isFullAdmin}
                  value={targetLgaId}
                  onChange={(e) => {
                    setTargetLgaId(e.target.value);
                    setTargetWardId('');
                  }}
                  className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-2.5 text-sm disabled:bg-slate-100"
                >
                  {isFullAdmin ? <option value="all">All Areas</option> : null}
                  <option value="funtua">Funtua</option>
                  <option value="dandume">Dandume</option>
                </select>
              </div>
              <div>
                <label htmlFor="notif-ward" className="block text-xs font-medium text-slate-700">
                  Target Ward
                </label>
                <select
                  id="notif-ward"
                  disabled={isWardScopedRole}
                  value={targetWardId}
                  onChange={(e) => setTargetWardId(e.target.value)}
                  className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-2.5 text-sm disabled:bg-slate-100"
                >
                  <option value="">All Wards in Scope</option>
                  {wardsInTargetLga.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="sm:col-span-2">
              <label htmlFor="notif-body" className="block text-xs font-medium text-slate-700">
                Message
              </label>
              <textarea
                id="notif-body"
                required
                minLength={5}
                rows={2}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Write concise guidance for field coordinators and agents..."
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-4">
              <label className="inline-flex items-center gap-2 text-xs font-medium text-red-900">
                <input
                  type="checkbox"
                  checked={isCritical}
                  onChange={(e) => setIsCritical(e.target.checked)}
                  className="h-4 w-4 accent-red-700"
                />
                <span>Mark as Critical Operational Alert</span>
              </label>

              {isFullAdmin ? (
                <label className="inline-flex items-center gap-2 text-xs font-medium text-amber-900">
                  <input
                    type="checkbox"
                    checked={isTestData}
                    onChange={(e) => setIsTestData(e.target.checked)}
                    className="h-4 w-4 accent-amber-700"
                  />
                  <span>Mark as Test Notification</span>
                </label>
              ) : null}
            </div>

            <button
              type="submit"
              disabled={sending}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-[#0b3b24] px-4 py-2 text-sm font-medium text-white hover:bg-[#115233] disabled:opacity-60"
            >
              <Send className="h-4 w-4" aria-hidden="true" />
              <span>
                {sending
                  ? 'Sending...'
                  : isOnline
                    ? 'Send Broadcast'
                    : 'Queue Broadcast Offline'}
              </span>
            </button>
          </div>
        </form>
      ) : null}

      {/* Pending Offline Broadcasts Queue */}
      {queuedBroadcasts.length > 0 ? (
        <section className="rounded-xl border border-amber-200 bg-amber-50/70 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-amber-950">
                Pending Offline Broadcasts ({queuedBroadcasts.length})
              </h3>
              <p className="text-xs text-amber-900">
                Saved safely on this device and queued for automatic delivery once connected.
              </p>
            </div>
            {onRetrySync ? (
              <button
                type="button"
                disabled={!isOnline || syncingNow}
                onClick={onRetrySync}
                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${syncingNow ? 'animate-spin' : ''}`}
                  aria-hidden="true"
                />
                <span>{syncingNow ? 'Syncing...' : 'Retry Sync'}</span>
              </button>
            ) : null}
          </div>
          <div className="divide-y divide-amber-200/70 rounded-lg border border-amber-200 bg-white">
            {queuedBroadcasts.map((item) => (
              <div
                key={item.clientSubmissionId}
                className="flex flex-col justify-between gap-2 p-3 sm:flex-row sm:items-center"
              >
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-slate-900">
                    {String(item.payload?.title || item.summary)}
                  </p>
                  <p className="text-[11px] text-slate-600 line-clamp-2">
                    {String(item.payload?.body || '')}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    Original Created: {formatFirestoreTime(item.createdAtIso)}
                    {item.syncedAtIso
                      ? ` · Server Synced: ${formatFirestoreTime(item.syncedAtIso)}`
                      : ''}
                  </p>
                  {item.errorMessage ? (
                    <p className="mt-0.5 text-[11px] text-red-700">{item.errorMessage}</p>
                  ) : null}
                </div>
                <OfflineSyncBadge status={item.status} />
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* Smart Operational Alerts Summary (Live Deduplicated Counters) */}
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-[#0b3b24]" aria-hidden="true" />
            <h2 className="font-display text-sm font-semibold text-slate-900">
              Smart Operational Alerts Summary
            </h2>
          </div>
          <span className="font-mono text-[11px] text-slate-500">
            Live database status · Zero simulated alerts
          </span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-[11px] font-medium text-slate-500">Critical Active Incidents</p>
            <p
              className={`mt-1 font-mono text-xl font-bold tabular-nums ${
                smartAlertCounts.criticalActiveIncidents > 0 ? 'text-red-700' : 'text-slate-900'
              }`}
            >
              {smartAlertCounts.criticalActiveIncidents}
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-[11px] font-medium text-slate-500">Result Discrepancies</p>
            <p
              className={`mt-1 font-mono text-xl font-bold tabular-nums ${
                smartAlertCounts.resultDiscrepancies > 0 ? 'text-amber-700' : 'text-slate-900'
              }`}
            >
              {smartAlertCounts.resultDiscrepancies}
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-[11px] font-medium text-slate-500">Overdue Ops Tasks</p>
            <p
              className={`mt-1 font-mono text-xl font-bold tabular-nums ${
                smartAlertCounts.overdueTasks > 0 ? 'text-amber-700' : 'text-slate-900'
              }`}
            >
              {smartAlertCounts.overdueTasks}
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-[11px] font-medium text-slate-500">Sync Failures / Conflicts</p>
            <p
              className={`mt-1 font-mono text-xl font-bold tabular-nums ${
                smartAlertCounts.failedQueue > 0 ? 'text-red-700' : 'text-slate-900'
              }`}
            >
              {smartAlertCounts.failedQueue}
            </p>
          </div>
        </div>
      </section>

      {/* Full Control Admin Escalation Rules Manager */}
      {isFullAdmin ? (
        <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
            <div>
              <h2 className="font-display text-sm font-semibold text-slate-900">
                Automated Alert Escalation Rules ({escalationRules.length})
              </h2>
              <p className="text-xs text-slate-500">
                Define escalation timings, recipient roles, and anti-spam hourly caps per operational trigger.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowRuleForm((v) => !v)}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-[#0b3b24] bg-white px-3 py-1.5 text-xs font-semibold text-[#0b3b24] hover:bg-emerald-50 whitespace-nowrap"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{showRuleForm ? 'Close Rule Form' : 'Add Escalation Rule'}</span>
            </button>
          </div>

          {showRuleForm ? (
            <form
              onSubmit={handleSaveRule}
              className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2 lg:grid-cols-3"
            >
              <div className="sm:col-span-2 lg:col-span-1">
                <label htmlFor="esc-name" className="block text-xs font-medium text-slate-700">
                  Rule Name *
                </label>
                <input
                  id="esc-name"
                  type="text"
                  required
                  minLength={3}
                  value={ruleName}
                  onChange={(e) => setRuleName(e.target.value)}
                  placeholder="e.g. Critical Incident 15m Escalation"
                  className="mt-1 min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 text-xs"
                />
              </div>
              <div>
                <label htmlFor="esc-trigger" className="block text-xs font-medium text-slate-700">
                  Trigger Event
                </label>
                <select
                  id="esc-trigger"
                  value={ruleTrigger}
                  onChange={(e) => setRuleTrigger(e.target.value as EscalationRule['triggerType'])}
                  className="mt-1 min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-2.5 text-xs"
                >
                  {(Object.keys(ESCALATION_TRIGGER_LABELS) as EscalationRule['triggerType'][]).map(
                    (k) => (
                      <option key={k} value={k}>
                        {ESCALATION_TRIGGER_LABELS[k]}
                      </option>
                    )
                  )}
                </select>
              </div>
              <div>
                <label htmlFor="esc-priority" className="block text-xs font-medium text-slate-700">
                  Priority
                </label>
                <select
                  id="esc-priority"
                  value={rulePriority}
                  onChange={(e) => setRulePriority(e.target.value as IncidentUrgency)}
                  className="mt-1 min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-2.5 text-xs"
                >
                  {Object.values(IncidentUrgency).map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="esc-resp" className="block text-xs font-medium text-slate-700">
                  Responsible Role
                </label>
                <select
                  id="esc-resp"
                  value={ruleResponsibleRole}
                  onChange={(e) => setRuleResponsibleRole(e.target.value as UserRole)}
                  className="mt-1 min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-2.5 text-xs"
                >
                  {[
                    UserRole.OPERATIONS_OFFICER,
                    UserRole.WARD_COORDINATOR,
                    UserRole.VERIFICATION_OFFICER,
                    UserRole.FUNTUA_SUPER_ADMIN,
                    UserRole.DANDUME_SUPER_ADMIN,
                  ].map((r) => (
                    <option key={r} value={r}>
                      {USER_ROLE_META[r].label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="esc-recip" className="block text-xs font-medium text-slate-700">
                  Escalate To Role
                </label>
                <select
                  id="esc-recip"
                  value={ruleRecipientRole}
                  onChange={(e) => setRuleRecipientRole(e.target.value as UserRole)}
                  className="mt-1 min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-2.5 text-xs"
                >
                  {[
                    UserRole.FULL_CONTROL_ADMIN,
                    UserRole.FUNTUA_SUPER_ADMIN,
                    UserRole.DANDUME_SUPER_ADMIN,
                    UserRole.WARD_COORDINATOR,
                  ].map((r) => (
                    <option key={r} value={r}>
                      {USER_ROLE_META[r].label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label htmlFor="esc-mins" className="block text-xs font-medium text-slate-700">
                    Escalate (min)
                  </label>
                  <input
                    id="esc-mins"
                    type="number"
                    min={5}
                    max={1440}
                    value={ruleEscalateMins}
                    onChange={(e) => setRuleEscalateMins(e.target.value)}
                    className="mt-1 min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-2.5 font-mono text-xs tabular-nums"
                  />
                </div>
                <div>
                  <label htmlFor="esc-cap" className="block text-xs font-medium text-slate-700">
                    Max / hr
                  </label>
                  <input
                    id="esc-cap"
                    type="number"
                    min={1}
                    max={60}
                    value={ruleMaxPerHour}
                    onChange={(e) => setRuleMaxPerHour(e.target.value)}
                    className="mt-1 min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-2.5 font-mono text-xs tabular-nums"
                  />
                </div>
              </div>
              <div className="sm:col-span-2 lg:col-span-3 flex justify-end">
                <button
                  type="submit"
                  disabled={savingRule}
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-[#0b3b24] px-4 py-2 text-xs font-semibold text-white hover:bg-[#115233] disabled:opacity-60"
                >
                  <span>{savingRule ? 'Saving...' : 'Save Escalation Rule'}</span>
                </button>
              </div>
            </form>
          ) : null}

          {escalationRules.length === 0 ? (
            <p className="text-xs text-slate-500">
              No custom escalation rules configured yet. Add rules to standardize unacknowledged alert escalation across wards and LGAs.
            </p>
          ) : (
            <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {escalationRules.map((rule) => (
                <div
                  key={rule.id}
                  className="flex flex-col justify-between gap-2 p-3 sm:flex-row sm:items-center"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-slate-900">
                      {rule.ruleName}{' '}
                      <span className="font-mono text-[11px] font-normal text-slate-500">
                        · {ESCALATION_TRIGGER_LABELS[rule.triggerType]} · {rule.priority}
                      </span>
                    </p>
                    <p className="mt-0.5 text-[11px] text-slate-600">
                      {USER_ROLE_META[rule.responsibleRole]?.shortLabel || rule.responsibleRole} -&gt;{' '}
                      {USER_ROLE_META[rule.recipientRole]?.shortLabel || rule.recipientRole} after{' '}
                      <span className="font-mono tabular-nums">{rule.escalateAfterMinutes}m</span> ·
                      Cap <span className="font-mono tabular-nums">{rule.maxNotificationsPerHour}</span>/hr
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void handleToggleRuleEnabled(rule)}
                      className={`min-h-[34px] rounded-lg border px-2.5 text-[11px] font-semibold whitespace-nowrap ${
                        rule.enabled
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                          : 'border-slate-200 bg-slate-100 text-slate-600'
                      }`}
                    >
                      {rule.enabled ? 'Enabled' : 'Paused'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDeleteRule(rule.id)}
                      aria-label={`Delete escalation rule ${rule.ruleName}`}
                      className="flex min-h-[34px] min-w-[34px] items-center justify-center rounded-lg border border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {/* Notification Feed Controls & Unread Management */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          {(
            [
              { id: 'ALL', label: `All (${notifications.length})` },
              { id: 'UNREAD', label: `Unread (${unreadCount})` },
              {
                id: 'CRITICAL',
                label: `Critical (${notifications.filter((n) => n.isCritical).length})`,
              },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setNotifFilter(tab.id)}
              className={`min-h-[36px] rounded-lg border px-3 text-xs font-semibold transition-colors whitespace-nowrap ${
                notifFilter === tab.id
                  ? 'border-[#0b3b24] bg-[#0b3b24] text-white'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {unreadCount > 0 ? (
          <button
            type="button"
            onClick={markAllRead}
            className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
          >
            <CheckCheck className="h-3.5 w-3.5 text-[#0b3b24]" aria-hidden="true" />
            <span>Mark All Read</span>
          </button>
        ) : null}
      </div>

      {/* Notifications List */}
      {visibleNotifications.length === 0 && queuedBroadcasts.length === 0 ? (
        <EmptyState
          title={
            notifications.length === 0
              ? 'No operational data has been submitted yet.'
              : 'No notifications match the selected filter.'
          }
          description="Operational alerts, agent check-in notices, and verified directives within your assigned scope will appear here."
        />
      ) : (
        <div className="space-y-3">
          {visibleNotifications.map((n) => {
            const isRead = readIds.has(n.id);
            return (
              <div
                key={n.id}
                className={`rounded-xl border p-4 transition-colors ${
                  n.isCritical
                    ? isRead
                      ? 'border-red-200 bg-red-50/40'
                      : 'border-red-300 bg-red-50/80'
                    : isRead
                      ? 'border-slate-200 bg-slate-50/50'
                      : 'border-slate-300 bg-white'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    {n.isCritical ? (
                      <AlertOctagon className="h-4 w-4 text-red-700 shrink-0" aria-hidden="true" />
                    ) : (
                      <Bell className="h-4 w-4 text-[#0b3b24] shrink-0" aria-hidden="true" />
                    )}
                    <h3
                      className={`text-sm ${
                        isRead ? 'font-medium text-slate-700' : 'font-semibold text-slate-900'
                      }`}
                    >
                      {n.title}
                    </h3>
                    {!isRead ? (
                      <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[#0b3b24]">
                        UNREAD
                      </span>
                    ) : null}
                    {n.isTestData ? (
                      <span className="rounded bg-amber-100 px-2 py-0.5 font-mono text-[10px] font-semibold text-amber-900">
                        TEST RECORD
                      </span>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-slate-500 tabular-nums">
                      {formatFirestoreTime(n.createdAt)}
                    </span>
                    <button
                      type="button"
                      onClick={() => toggleReadState(n.id)}
                      className="inline-flex min-h-[30px] items-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-[11px] font-medium text-slate-600 hover:bg-slate-100 whitespace-nowrap"
                    >
                      <Check className="h-3 w-3" aria-hidden="true" />
                      <span>{isRead ? 'Mark Unread' : 'Mark Read'}</span>
                    </button>
                  </div>
                </div>
                <p className="mt-1.5 text-xs text-slate-700">{n.body}</p>
                <p className="mt-2 font-mono text-[11px] text-slate-500">
                  Scope:{' '}
                  {n.targetLgaId === 'all'
                    ? 'All Areas'
                    : LGA_DEFINITIONS[n.targetLgaId as 'funtua' | 'dandume']?.shortName ||
                      n.targetLgaId}
                  {n.targetWardId ? ` · Ward ${n.targetWardId}` : ''}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
