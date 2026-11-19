import { useMemo, useState, type FormEvent } from 'react';
import {
  AlertOctagon,
  CheckCircle2,
  Edit3,
  MapPin,
  Phone,
  PhoneCall,
  Plus,
  Search,
  Send,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import { EmptyState } from '../components/EmptyState';
import {
  removeEmergencyContact,
  saveEmergencyContact,
  submitEmergencyReport,
  updateEmergencyReportStatus,
} from '../services/emergencyService';
import { enqueueOfflineSubmission } from '../services/offlineQueue';
import {
  EMERGENCY_CATEGORIES,
  IncidentUrgency,
  LGA_DEFINITIONS,
  UserRole,
  canManageEmergencyContacts,
  formatFirestoreTime,
  sanitizeTelHref,
  type EmergencyContact,
  type EmergencyReport,
  type EmergencyReportStatus,
  type LgaId,
  type PollingUnit,
  type UserAccount,
} from '../types/fdmis';

interface EmergencyAssistancePageProps {
  user: UserAccount;
  contacts: EmergencyContact[];
  pollingUnits?: PollingUnit[];
  emergencyReports?: EmergencyReport[];
  users?: UserAccount[];
  isOnline?: boolean;
}

const EMERGENCY_STATUS_LABELS: Record<EmergencyReportStatus, { label: string; style: string }> = {
  SUBMITTED: { label: 'Submitted', style: 'border-red-200 bg-red-50 text-red-800' },
  ACKNOWLEDGED: { label: 'Acknowledged', style: 'border-amber-200 bg-amber-50 text-amber-900' },
  RESPONDER_ASSIGNED: {
    label: 'Responder Assigned',
    style: 'border-blue-200 bg-blue-50 text-blue-900',
  },
  RESOLVED: { label: 'Resolved', style: 'border-emerald-200 bg-emerald-50 text-emerald-900' },
  CLOSED: { label: 'Closed', style: 'border-slate-200 bg-slate-100 text-slate-700' },
};

export function EmergencyAssistancePage({
  user,
  contacts,
  pollingUnits = [],
  emergencyReports = [],
  users = [],
  isOnline = true,
}: EmergencyAssistancePageProps) {
  const canManage = canManageEmergencyContacts(user.role);
  const isFullAdmin = user.role === UserRole.FULL_CONTROL_ADMIN;
  const fixedLgaScope: 'all' | LgaId =
    user.role === UserRole.FUNTUA_SUPER_ADMIN
      ? 'funtua'
      : user.role === UserRole.DANDUME_SUPER_ADMIN
        ? 'dandume'
        : 'all';

  const [search, setSearch] = useState('');
  const [scopeFilter, setScopeFilter] = useState<'ALL' | 'PRIORITY'>('ALL');
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Add / Edit modal state
  const [formOpen, setFormOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<EmergencyContact | null>(null);
  const [name, setName] = useState('');
  const [roleLabel, setRoleLabel] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [scopeLgaId, setScopeLgaId] = useState<'all' | LgaId>(fixedLgaScope);
  const [isPriority, setIsPriority] = useState(true);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  // Delete confirmation modal
  const [deleteTarget, setDeleteTarget] = useState<EmergencyContact | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Structured Emergency Assistance Report form state
  const [showReportForm, setShowReportForm] = useState(false);
  const [emgCategory, setEmgCategory] = useState<string>(EMERGENCY_CATEGORIES[0]);
  const [emgUrgency, setEmgUrgency] = useState<IncidentUrgency>(IncidentUrgency.CRITICAL);
  const [emgPuId, setEmgPuId] = useState<string>(user.assignedPollingUnitId || '');
  const [emgDesc, setEmgDesc] = useState('');
  const [emgGps, setEmgGps] = useState<{ lat: number; lng: number } | null>(null);
  const [capturingGps, setCapturingGps] = useState(false);
  const [submittingEmg, setSubmittingEmg] = useState(false);

  // Admin responder/status update modal
  const [managingReport, setManagingReport] = useState<EmergencyReport | null>(null);
  const [manageStatus, setManageStatus] = useState<EmergencyReportStatus>('ACKNOWLEDGED');
  const [manageResponderUid, setManageResponderUid] = useState('');
  const [manageNotes, setManageNotes] = useState('');
  const [updatingReport, setUpdatingReport] = useState(false);

  const captureEmergencyGps = () => {
    if (!navigator.geolocation) {
      setFeedback({ type: 'err', text: 'Device GPS is unavailable on this browser.' });
      return;
    }
    setCapturingGps(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setEmgGps({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setCapturingGps(false);
      },
      () => {
        setCapturingGps(false);
        setFeedback({ type: 'err', text: 'Unable to obtain GPS fix. You can still submit without GPS.' });
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const handleSubmitEmergencyReport = async (e: FormEvent) => {
    e.preventDefault();
    if (emgDesc.trim().length < 5) {
      setFeedback({ type: 'err', text: 'Provide a clear emergency description (at least 5 characters).' });
      return;
    }
    setSubmittingEmg(true);
    setFeedback(null);

    const matchedPu = pollingUnits.find((p) => p.id === emgPuId) || null;
    const targetLga: LgaId | 'all' = matchedPu
      ? matchedPu.lgaId
      : user.assignedLgaId === 'funtua' || user.assignedLgaId === 'dandume'
        ? user.assignedLgaId
        : 'all';

    const payload = {
      category: emgCategory,
      description: emgDesc.trim(),
      urgency: emgUrgency,
      lgaId: targetLga,
      wardId: matchedPu?.wardId || user.assignedWardId || '',
      puId: matchedPu?.id || '',
      puCode: matchedPu?.puCode || '',
      puName: matchedPu?.name || '',
      latitude: emgGps?.lat ?? null,
      longitude: emgGps?.lng ?? null,
    };

    if (!isOnline) {
      await enqueueOfflineSubmission({
        ownerUid: user.uid,
        reportType: 'EMERGENCY_REPORT',
        puId: payload.puId,
        puCode: payload.puCode,
        puName: payload.puName,
        lgaId: payload.lgaId,
        wardId: payload.wardId,
        summary: `[${emgUrgency}] ${emgCategory}`,
        payload,
        status: 'PENDING_SYNC',
      });
      setEmgDesc('');
      setEmgGps(null);
      setShowReportForm(false);
      setSubmittingEmg(false);
      setFeedback({
        type: 'ok',
        text: 'OFFLINE: Emergency assistance request queued on this device and will transmit automatically when internet returns. Use Call Now above for immediate voice contact.',
      });
      return;
    }

    try {
      await submitEmergencyReport(user, payload);
      setEmgDesc('');
      setEmgGps(null);
      setShowReportForm(false);
      setFeedback({
        type: 'ok',
        text: 'Emergency assistance request transmitted to the Situation Room.',
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to transmit emergency request.',
      });
    } finally {
      setSubmittingEmg(false);
    }
  };

  const handleUpdateEmergencyReport = async (e: FormEvent) => {
    e.preventDefault();
    if (!managingReport) return;
    setUpdatingReport(true);
    setFeedback(null);
    try {
      const responder = users.find((u) => u.uid === manageResponderUid);
      await updateEmergencyReportStatus(user, managingReport, {
        status: manageStatus,
        assignedResponderUid: responder ? responder.uid : managingReport.assignedResponderUid,
        assignedResponderName: responder ? responder.displayName : managingReport.assignedResponderName,
        resolutionNotes: manageNotes,
      });
      setManagingReport(null);
      setFeedback({ type: 'ok', text: `Emergency request updated to ${manageStatus}.` });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to update emergency request.',
      });
    } finally {
      setUpdatingReport(false);
    }
  };

  const canModifyContact = (contact: EmergencyContact): boolean => {
    if (!canManage) return false;
    if (isFullAdmin) return true;
    return contact.scopeLgaId === fixedLgaScope;
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return contacts.filter((c) => {
      if (scopeFilter === 'PRIORITY' && !c.isPriority) return false;
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        c.roleLabel.toLowerCase().includes(q) ||
        c.phoneNumber.toLowerCase().includes(q) ||
        c.notes.toLowerCase().includes(q)
      );
    });
  }, [contacts, search, scopeFilter]);

  const openAddModal = () => {
    setEditingContact(null);
    setName('');
    setRoleLabel('');
    setPhoneNumber('');
    setScopeLgaId(fixedLgaScope);
    setIsPriority(true);
    setNotes('');
    setFeedback(null);
    setFormOpen(true);
  };

  const openEditModal = (contact: EmergencyContact) => {
    setEditingContact(contact);
    setName(contact.name);
    setRoleLabel(contact.roleLabel || '');
    setPhoneNumber(contact.phoneNumber);
    setScopeLgaId(contact.scopeLgaId);
    setIsPriority(contact.isPriority);
    setNotes(contact.notes || '');
    setFeedback(null);
    setFormOpen(true);
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFeedback(null);
    try {
      await saveEmergencyContact(
        user,
        {
          name,
          roleLabel,
          phoneNumber,
          scopeLgaId: isFullAdmin ? scopeLgaId : fixedLgaScope,
          isPriority,
          notes,
        },
        editingContact
      );
      setFormOpen(false);
      setEditingContact(null);
      setFeedback({
        type: 'ok',
        text: editingContact
          ? `Updated emergency contact "${name.trim()}".`
          : `Added emergency contact "${name.trim()}".`,
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to save emergency contact.',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setFeedback(null);
    try {
      await removeEmergencyContact(user, deleteTarget);
      setFeedback({
        type: 'ok',
        text: `Removed emergency contact "${deleteTarget.name}".`,
      });
      setDeleteTarget(null);
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to remove emergency contact.',
      });
    } finally {
      setDeleting(false);
    }
  };

  const priorityCount = contacts.filter((c) => c.isPriority).length;

  return (
    <div className="space-y-5">
      {/* Header Banner */}
      <div className="flex flex-col justify-between gap-4 rounded-xl border border-slate-200 bg-white p-5 sm:flex-row sm:items-center">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-red-50 text-red-700">
            <PhoneCall className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="font-display text-base font-semibold text-slate-900">
              Emergency Assistance Numbers
            </h2>
            <p className="mt-0.5 text-xs text-slate-600">
              Verified Situation Room, security, and coordination rapid-response numbers for
              authenticated operators only. Tap <strong>Call Now</strong> on any device to open the
              phone dialer directly.
            </p>
          </div>
        </div>

        {canManage ? (
          <button
            type="button"
            onClick={openAddModal}
            className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-2 rounded-lg bg-[#0b3b24] px-4 py-2 text-sm font-semibold text-white hover:bg-[#115233] whitespace-nowrap"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            <span>Add Emergency Contact</span>
          </button>
        ) : null}
      </div>

      {feedback ? (
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${
            feedback.type === 'ok'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : 'border-red-200 bg-red-50 text-red-900'
          }`}
        >
          {feedback.text}
        </div>
      ) : null}

      {/* Summary & Filters */}
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 sm:max-w-sm">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
            aria-hidden="true"
          />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search contact name, unit, or phone..."
            className="min-h-[44px] w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setScopeFilter('ALL')}
            className={`min-h-[40px] rounded-lg border px-3 text-xs font-semibold transition-colors ${
              scopeFilter === 'ALL'
                ? 'border-[#0b3b24] bg-[#0b3b24] text-white'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            All Contacts ({contacts.length})
          </button>
          <button
            type="button"
            onClick={() => setScopeFilter('PRIORITY')}
            className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition-colors ${
              scopeFilter === 'PRIORITY'
                ? 'border-red-700 bg-red-700 text-white'
                : 'border-red-200 bg-red-50 text-red-900 hover:bg-red-100'
            }`}
          >
            <Star className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Priority Only ({priorityCount})</span>
          </button>
        </div>
      </div>

      {/* Contact List */}
      {filtered.length === 0 ? (
        <EmptyState
          title="No emergency assistance contacts configured yet."
          description={
            canManage
              ? 'Use "Add Emergency Contact" to publish verified rapid-response phone numbers for field agents and coordinators.'
              : 'Authorized Super Admins have not added emergency phone numbers for your scope yet.'
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {filtered.map((c) => {
            const telHref = `tel:${sanitizeTelHref(c.phoneNumber)}`;
            const editable = canModifyContact(c);
            return (
              <div
                key={c.id}
                className={`flex flex-col justify-between gap-4 rounded-xl border bg-white p-5 ${
                  c.isPriority ? 'border-red-300 ring-1 ring-red-100' : 'border-slate-200'
                }`}
              >
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-display text-base font-semibold text-slate-900">
                          {c.name}
                        </h3>
                        {c.isPriority ? (
                          <span className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-800">
                            <Star
                              className="h-3 w-3 fill-red-700 text-red-700"
                              aria-hidden="true"
                            />
                            <span>Priority Contact</span>
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-0.5 text-xs text-slate-600">
                        {c.roleLabel || 'Emergency Desk'} ·{' '}
                        <span className="font-medium text-slate-800">
                          {c.scopeLgaId === 'all'
                            ? 'Constituency-Wide (Funtua & Dandume)'
                            : LGA_DEFINITIONS[c.scopeLgaId as LgaId]?.displayName || c.scopeLgaId}
                        </span>
                      </p>
                    </div>
                  </div>

                  <p className="font-mono text-lg font-bold text-[#0b3b24] tabular-nums">
                    {c.phoneNumber}
                  </p>

                  {c.notes ? (
                    <p className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                      {c.notes}
                    </p>
                  ) : null}

                  <p className="text-[11px] text-slate-400">
                    Updated: {formatFirestoreTime(c.updatedAt)}
                  </p>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
                  <a
                    href={telHref}
                    className={`inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white transition-colors ${
                      c.isPriority
                        ? 'bg-red-700 hover:bg-red-800'
                        : 'bg-[#0b3b24] hover:bg-[#115233]'
                    }`}
                  >
                    <Phone className="h-4 w-4" aria-hidden="true" />
                    <span>Call Now</span>
                  </a>

                  {editable ? (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => openEditModal(c)}
                        className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Edit</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(c)}
                        className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-800 hover:bg-red-100"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Remove</span>
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Structured Emergency Assistance Reports (Separate from Verified Election Incidents) */}
      <section className="rounded-xl border border-red-200 bg-white p-5 space-y-4">
        <div className="flex flex-col justify-between gap-3 border-b border-slate-100 pb-3 sm:flex-row sm:items-center">
          <div className="flex items-start gap-2.5">
            <AlertOctagon className="mt-0.5 h-5 w-5 shrink-0 text-red-700" aria-hidden="true" />
            <div>
              <h2 className="font-display text-sm font-semibold text-slate-900">
                Structured Emergency Assistance Requests ({emergencyReports.length})
              </h2>
              <p className="text-xs text-slate-600">
                Operational Emergency Support — strictly separated from formal Election Incident
                Reports for rapid responder dispatch.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowReportForm((v) => !v)}
            className="inline-flex min-h-[42px] shrink-0 items-center justify-center gap-2 rounded-lg bg-red-700 px-4 py-2 text-xs font-semibold text-white hover:bg-red-800 whitespace-nowrap"
          >
            <Send className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{showReportForm ? 'Close Request Form' : 'Request Rapid Assistance'}</span>
          </button>
        </div>

        {showReportForm ? (
          <form
            onSubmit={handleSubmitEmergencyReport}
            className="space-y-3 rounded-xl border border-red-200 bg-red-50/40 p-4"
          >
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <label htmlFor="emg-cat" className="block text-xs font-medium text-slate-700">
                  Emergency Category *
                </label>
                <select
                  id="emg-cat"
                  value={emgCategory}
                  onChange={(e) => setEmgCategory(e.target.value)}
                  className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 text-xs"
                >
                  {EMERGENCY_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="emg-urg" className="block text-xs font-medium text-slate-700">
                  Urgency Level *
                </label>
                <select
                  id="emg-urg"
                  value={emgUrgency}
                  onChange={(e) => setEmgUrgency(e.target.value as IncidentUrgency)}
                  className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 text-xs"
                >
                  {Object.values(IncidentUrgency).map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="emg-pu" className="block text-xs font-medium text-slate-700">
                  Polling Unit (Optional)
                </label>
                <select
                  id="emg-pu"
                  value={emgPuId}
                  onChange={(e) => setEmgPuId(e.target.value)}
                  className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 text-xs"
                >
                  <option value="">General Area / Not PU-Specific</option>
                  {pollingUnits.slice(0, 500).map((pu) => (
                    <option key={pu.id} value={pu.id}>
                      {pu.puCode} · {pu.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="sm:col-span-2 lg:col-span-3">
                <label htmlFor="emg-desc" className="block text-xs font-medium text-slate-700">
                  Immediate Situation &amp; Assistance Needed *
                </label>
                <textarea
                  id="emg-desc"
                  required
                  minLength={5}
                  rows={2}
                  value={emgDesc}
                  onChange={(e) => setEmgDesc(e.target.value)}
                  placeholder="Describe exact location, safety/medical/logistics need, and best callback number..."
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                disabled={capturingGps}
                onClick={captureEmergencyGps}
                className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                <MapPin className="h-3.5 w-3.5 text-[#0b3b24]" aria-hidden="true" />
                <span>
                  {capturingGps
                    ? 'Locating GPS...'
                    : emgGps
                      ? `GPS Attached (${emgGps.lat.toFixed(4)}, ${emgGps.lng.toFixed(4)})`
                      : 'Attach Current GPS (Optional)'}
                </span>
              </button>

              <button
                type="submit"
                disabled={submittingEmg}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-red-700 px-4 py-2 text-xs font-semibold text-white hover:bg-red-800 disabled:opacity-60"
              >
                <Send className="h-3.5 w-3.5" aria-hidden="true" />
                <span>
                  {submittingEmg
                    ? 'Sending...'
                    : isOnline
                      ? 'Send Emergency Request'
                      : 'Queue Request Offline'}
                </span>
              </button>
            </div>
          </form>
        ) : null}

        {emergencyReports.length === 0 ? (
          <p className="text-xs text-slate-500">
            No structured emergency assistance requests have been filed in your authorized scope.
          </p>
        ) : (
          <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {emergencyReports.map((rep) => {
              const stMeta = EMERGENCY_STATUS_LABELS[rep.status] || EMERGENCY_STATUS_LABELS.SUBMITTED;
              return (
                <div key={rep.id} className="p-3.5 space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded border px-2 py-0.5 font-mono text-[10px] font-semibold ${stMeta.style}`}
                      >
                        {stMeta.label}
                      </span>
                      <span className="font-mono text-[11px] font-semibold text-red-800">
                        {rep.urgency}
                      </span>
                      <span className="text-xs font-semibold text-slate-900">{rep.category}</span>
                    </div>
                    <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                      {formatFirestoreTime(rep.createdAt || rep.clientCreatedAtIso)}
                    </span>
                  </div>
                  <p className="text-xs text-slate-700">{rep.description}</p>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
                    <span>
                      Reporter: <strong className="text-slate-700">{rep.reporterName}</strong>
                      {rep.reporterPhone ? ` (${rep.reporterPhone})` : ''}
                      {rep.puCode ? ` · PU ${rep.puCode}` : ''}
                      {rep.assignedResponderName
                        ? ` · Responder: ${rep.assignedResponderName}`
                        : ''}
                    </span>
                    {canManage ? (
                      <button
                        type="button"
                        onClick={() => {
                          setManagingReport(rep);
                          setManageStatus(rep.status);
                          setManageResponderUid(rep.assignedResponderUid || '');
                          setManageNotes(rep.resolutionNotes || '');
                        }}
                        className="inline-flex min-h-[32px] items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5 text-[#0b3b24]" aria-hidden="true" />
                        <span>Update Response</span>
                      </button>
                    ) : null}
                  </div>
                  {rep.resolutionNotes ? (
                    <p className="rounded bg-slate-50 px-2.5 py-1.5 text-[11px] text-slate-600">
                      Response Note: {rep.resolutionNotes}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Emergency Report Response Modal */}
      {managingReport ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-display text-sm font-semibold text-slate-900">
                Update Emergency Response · {managingReport.category}
              </h3>
              <button
                type="button"
                onClick={() => setManagingReport(null)}
                aria-label="Close emergency response modal"
                className="flex min-h-[34px] min-w-[34px] items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleUpdateEmergencyReport} className="mt-4 space-y-3">
              <div>
                <label htmlFor="emg-st" className="block text-xs font-medium text-slate-700">
                  Response Status
                </label>
                <select
                  id="emg-st"
                  value={manageStatus}
                  onChange={(e) => setManageStatus(e.target.value as EmergencyReportStatus)}
                  className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 text-xs"
                >
                  {(Object.keys(EMERGENCY_STATUS_LABELS) as EmergencyReportStatus[]).map((st) => (
                    <option key={st} value={st}>
                      {EMERGENCY_STATUS_LABELS[st].label}
                    </option>
                  ))}
                </select>
              </div>
              {users.length > 0 ? (
                <div>
                  <label htmlFor="emg-resp" className="block text-xs font-medium text-slate-700">
                    Assigned Responder (Optional)
                  </label>
                  <select
                    id="emg-resp"
                    value={manageResponderUid}
                    onChange={(e) => setManageResponderUid(e.target.value)}
                    className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 text-xs"
                  >
                    <option value="">Unassigned</option>
                    {users.map((u) => (
                      <option key={u.uid} value={u.uid}>
                        {u.displayName} ({u.role})
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
              <div>
                <label htmlFor="emg-note" className="block text-xs font-medium text-slate-700">
                  Dispatch / Resolution Notes
                </label>
                <textarea
                  id="emg-note"
                  rows={3}
                  value={manageNotes}
                  onChange={(e) => setManageNotes(e.target.value)}
                  placeholder="Record responder dispatch details or resolution outcome..."
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setManagingReport(null)}
                  className="min-h-[40px] rounded-lg border border-slate-200 px-4 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={updatingReport}
                  className="min-h-[40px] rounded-lg bg-[#0b3b24] px-4 text-xs font-semibold text-white hover:bg-[#115233] disabled:opacity-60"
                >
                  {updatingReport ? 'Saving...' : 'Save Update'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* Add / Edit Contact Modal */}
      {formOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-display text-base font-semibold text-slate-900">
                {editingContact ? 'Edit Emergency Contact' : 'Add Emergency Contact'}
              </h3>
              <button
                type="button"
                onClick={() => setFormOpen(false)}
                aria-label="Close contact dialog"
                className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSave} className="mt-4 space-y-4">
              <div>
                <label htmlFor="ec-name" className="block text-xs font-medium text-slate-700">
                  Contact Name / Desk *
                </label>
                <input
                  id="ec-name"
                  type="text"
                  required
                  minLength={2}
                  maxLength={120}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Funtua Rapid Response Desk"
                  className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-300 px-3 text-sm"
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="ec-phone" className="block text-xs font-medium text-slate-700">
                    Phone Number *
                  </label>
                  <input
                    id="ec-phone"
                    type="tel"
                    required
                    minLength={6}
                    maxLength={24}
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    placeholder="e.g. +234 800 123 4567"
                    className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-300 px-3 font-mono text-sm"
                  />
                </div>

                <div>
                  <label htmlFor="ec-role" className="block text-xs font-medium text-slate-700">
                    Unit / Role Label
                  </label>
                  <input
                    id="ec-role"
                    type="text"
                    maxLength={100}
                    value={roleLabel}
                    onChange={(e) => setRoleLabel(e.target.value)}
                    placeholder="e.g. Security, Legal, Medical"
                    className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-300 px-3 text-sm"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="ec-scope" className="block text-xs font-medium text-slate-700">
                  Geographical Scope *
                </label>
                <select
                  id="ec-scope"
                  disabled={!isFullAdmin}
                  value={isFullAdmin ? scopeLgaId : fixedLgaScope}
                  onChange={(e) => setScopeLgaId(e.target.value as 'all' | LgaId)}
                  className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm disabled:bg-slate-100"
                >
                  {isFullAdmin ? (
                    <option value="all">Constituency-Wide (Funtua &amp; Dandume)</option>
                  ) : null}
                  <option value="funtua">Funtua LGA (20-14)</option>
                  <option value="dandume">Dandume LGA (20/07)</option>
                </select>
              </div>

              <div>
                <label htmlFor="ec-notes" className="block text-xs font-medium text-slate-700">
                  When to Call / Escalation Notes (Optional)
                </label>
                <textarea
                  id="ec-notes"
                  rows={2}
                  maxLength={240}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Brief guidance for field agents before dialing..."
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>

              <label className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50/50 p-3 text-xs text-slate-800">
                <input
                  type="checkbox"
                  checked={isPriority}
                  onChange={(e) => setIsPriority(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-red-700"
                />
                <span>
                  <strong className="text-red-900">Mark as Priority Contact</strong>
                  <span className="mt-0.5 block text-slate-600">
                    Pins this number at the top of Polling Unit Agent dashboards for immediate
                    rapid dialing.
                  </span>
                </span>
              </label>

              <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => setFormOpen(false)}
                  className="min-h-[44px] rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="min-h-[44px] rounded-lg bg-[#0b3b24] px-5 py-2 text-sm font-semibold text-white hover:bg-[#115233] disabled:opacity-60"
                >
                  {saving ? 'Saving...' : editingContact ? 'Update Contact' : 'Save Contact'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* Remove Confirmation Modal */}
      {deleteTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <h3 className="font-display text-base font-semibold text-slate-900">
              Remove Emergency Contact
            </h3>
            <p className="mt-2 text-sm text-slate-700">
              Are you sure you want to remove <strong>{deleteTarget.name}</strong> (
              <span className="font-mono">{deleteTarget.phoneNumber}</span>)? Polling Unit Agents
              will immediately stop seeing this number.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={deleting}
                onClick={() => setDeleteTarget(null)}
                className="min-h-[44px] rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={() => void handleConfirmDelete()}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-60"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                <span>{deleting ? 'Removing...' : 'Confirm Remove'}</span>
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
