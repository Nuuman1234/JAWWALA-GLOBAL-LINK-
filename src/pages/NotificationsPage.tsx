import { useMemo, useState, type FormEvent } from 'react';
import {
  AlertOctagon,
  Bell,
  CheckCircle2,
  Lock,
  Mail,
  MessageSquare,
  RefreshCw,
  Send,
} from 'lucide-react';
import { EmptyState } from '../components/EmptyState';
import { OfflineSyncBadge } from '../components/StatusBadge';
import { WhatsAppGroupCard } from '../components/WhatsAppGroupCard';
import {
  LGA_DEFINITIONS,
  UserRole,
  canReviewIncidents,
  formatFirestoreTime,
  type GlobalSettings,
  type LgaId,
  type NotificationItem,
  type OfflineQueuedItem,
  type UserAccount,
  type Ward,
} from '../types/fdmis';
import { enqueueOfflineSubmission } from '../services/offlineQueue';
import { sendSituationNotification } from '../services/operationsService';

interface NotificationsPageProps {
  user: UserAccount;
  wards: Ward[];
  notifications: NotificationItem[];
  settings: GlobalSettings | null;
  isOnline?: boolean;
  queuedItems?: OfflineQueuedItem[];
  onRetrySync?: () => void;
  syncingNow?: boolean;
}

export function NotificationsPage({
  user,
  wards,
  notifications,
  settings,
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

  const wardsInTargetLga = useMemo(
    () => wards.filter((w) => targetLgaId === 'all' || w.lgaId === targetLgaId),
    [wards, targetLgaId]
  );

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

      {/* Notifications List */}
      {notifications.length === 0 && queuedBroadcasts.length === 0 ? (
        <EmptyState
          title="No operational data has been submitted yet."
          description="Operational alerts, agent check-in notices, and verified directives within your assigned scope will appear here."
        />
      ) : (
        <div className="space-y-3">
          {notifications.map((n) => (
            <div
              key={n.id}
              className={`rounded-xl border p-4 ${
                n.isCritical
                  ? 'border-red-200 bg-red-50/70'
                  : 'border-slate-200 bg-white'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  {n.isCritical ? (
                    <AlertOctagon className="h-4 w-4 text-red-700 shrink-0" aria-hidden="true" />
                  ) : (
                    <Bell className="h-4 w-4 text-[#0b3b24] shrink-0" aria-hidden="true" />
                  )}
                  <h3 className="text-sm font-semibold text-slate-900">{n.title}</h3>
                  {n.isTestData ? (
                    <span className="rounded bg-amber-100 px-2 py-0.5 font-mono text-[10px] font-semibold text-amber-900">
                      TEST RECORD
                    </span>
                  ) : null}
                </div>
                <span className="font-mono text-xs text-slate-500 tabular-nums">
                  {formatFirestoreTime(n.createdAt)}
                </span>
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
          ))}
        </div>
      )}
    </div>
  );
}
