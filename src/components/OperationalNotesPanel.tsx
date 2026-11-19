import { useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Edit3,
  Pin,
  Plus,
  RefreshCw,
  Search,
  StickyNote,
  Trash2,
  X,
} from 'lucide-react';
import { OfflineSyncBadge } from './StatusBadge';
import {
  deleteOperationalNote,
  saveOperationalNote,
} from '../services/notesService';
import {
  LGA_DEFINITIONS,
  UserRole,
  formatFirestoreTime,
  getAuthorizedLgas,
  type LgaId,
  type OperationalNote,
  type OperationalNoteCategory,
  type PollingUnit,
  type UserAccount,
  type Ward,
} from '../types/fdmis';

const CATEGORY_LABELS: Record<OperationalNoteCategory, string> = {
  GENERAL: 'General Note',
  FIELD_UPDATE: 'Field Update',
  LOGISTICS: 'Materials / Logistics',
  HANDOVER: 'Shift Handover',
  URGENT: 'Urgent Follow-Up',
};

interface OperationalNotesPanelProps {
  user: UserAccount;
  notes: OperationalNote[];
  wards: Ward[];
  pollingUnits: PollingUnit[];
  isOnline: boolean;
  onRetrySync?: () => void;
  syncingNow?: boolean;
  compact?: boolean;
}

export function OperationalNotesPanel({
  user,
  notes,
  wards,
  pollingUnits,
  isOnline,
  onRetrySync,
  syncingNow = false,
  compact = false,
}: OperationalNotesPanelProps) {
  const authorizedLgas = getAuthorizedLgas(user);
  const defaultLgaId: 'all' | LgaId =
    user.role === UserRole.FULL_CONTROL_ADMIN
      ? 'all'
      : authorizedLgas[0] || 'funtua';
  const defaultWardId = user.assignedWardId || '';
  const defaultPuId = user.assignedPollingUnitId || '';

  const [editingNote, setEditingNote] = useState<OperationalNote | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [category, setCategory] = useState<OperationalNoteCategory>('GENERAL');
  const [lgaId, setLgaId] = useState<'all' | LgaId>(defaultLgaId);
  const [wardId, setWardId] = useState(defaultWardId);
  const [puId, setPuId] = useState(defaultPuId);
  const [isPinned, setIsPinned] = useState(false);

  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'ALL' | OperationalNoteCategory>('ALL');
  const [saving, setSaving] = useState(false);
  const [confirmDeleteNote, setConfirmDeleteNote] = useState<OperationalNote | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );

  const scopedWards = wards.filter((w) => lgaId === 'all' || w.lgaId === lgaId);
  const scopedPus = pollingUnits.filter((p) => {
    if (lgaId !== 'all' && p.lgaId !== lgaId) return false;
    if (wardId && p.wardId !== wardId) return false;
    return true;
  });

  const resetForm = () => {
    setEditingNote(null);
    setTitle('');
    setContent('');
    setCategory('GENERAL');
    setLgaId(defaultLgaId);
    setWardId(defaultWardId);
    setPuId(defaultPuId);
    setIsPinned(false);
  };

  const startEdit = (note: OperationalNote) => {
    setEditingNote(note);
    setTitle(note.title);
    setContent(note.content);
    setCategory(note.category);
    setLgaId(note.lgaId);
    setWardId(note.wardId);
    setPuId(note.puId);
    setIsPinned(note.isPinned);
    setFeedback(null);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    if (content.trim().length < 1) {
      setFeedback({ type: 'error', text: 'Enter a note or message before saving.' });
      return;
    }

    const selectedPu = pollingUnits.find((p) => p.id === puId);
    const resolvedLga: 'all' | LgaId = selectedPu
      ? selectedPu.lgaId
      : user.role === UserRole.POLLING_UNIT_AGENT && authorizedLgas[0]
        ? authorizedLgas[0]
        : lgaId;
    const resolvedWard = selectedPu
      ? selectedPu.wardId
      : user.assignedWardId || wardId;

    setSaving(true);
    try {
      const result = await saveOperationalNote(user, {
        clientNoteId: editingNote?.clientNoteId || editingNote?.id,
        title,
        content,
        category,
        lgaId: resolvedLga,
        wardId: resolvedWard,
        puId: selectedPu?.id || puId,
        puCode: selectedPu?.puCode || editingNote?.puCode || '',
        puName: selectedPu?.name || editingNote?.puName || '',
        isPinned,
        isTestData: editingNote?.isTestData ?? false,
        existingRevision: editingNote?.revision,
        existingCreatedAt: editingNote?.createdAt,
      });

      resetForm();
      setFeedback({
        type: 'success',
        text:
          result.mode === 'offline'
            ? 'Note saved offline on this device (PENDING SYNCHRONIZATION). It will synchronize automatically when internet returns.'
            : editingNote
              ? 'Note updated and SYNCHRONIZED.'
              : 'Note saved and SYNCHRONIZED.',
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Unable to save note.',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!confirmDeleteNote) return;
    setDeleting(true);
    setFeedback(null);
    try {
      const outcome = await deleteOperationalNote(user, confirmDeleteNote);
      if (editingNote && editingNote.clientNoteId === confirmDeleteNote.clientNoteId) {
        resetForm();
      }
      setConfirmDeleteNote(null);
      setFeedback({
        type: 'success',
        text:
          outcome === 'queued_offline'
            ? 'Note removed from this device and queued for permanent server removal when online.'
            : 'Note permanently deleted.',
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to delete note.',
      });
    } finally {
      setDeleting(false);
    }
  };

  const canModifyNote = (note: OperationalNote): boolean => {
    return user.role === UserRole.FULL_CONTROL_ADMIN || note.authorUid === user.uid;
  };

  const filteredNotes = notes.filter((n) => {
    if (categoryFilter !== 'ALL' && n.category !== categoryFilter) return false;
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      const hay =
        `${n.title} ${n.content} ${n.authorName} ${n.puCode} ${n.puName}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const unsyncedCount = notes.filter(
    (n) => n.syncState && n.syncState !== 'SYNCED'
  ).length;

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4">
          <div className="flex items-start gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#0b3b24] text-white">
              <StickyNote className="h-4 w-4" aria-hidden="true" />
            </div>
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900">
                {editingNote ? 'Edit Operational Note' : 'Operational Notes & Field Messages'}
              </h2>
              <p className="text-xs text-slate-600">
                Record short operational notes, logistics updates, and handover messages. Works offline and syncs automatically without duplicates.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {unsyncedCount > 0 && onRetrySync ? (
              <button
                type="button"
                onClick={onRetrySync}
                disabled={syncingNow || !isOnline}
                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${syncingNow ? 'animate-spin' : ''}`}
                  aria-hidden="true"
                />
                <span>Retry Sync ({unsyncedCount})</span>
              </button>
            ) : null}
            {editingNote ? (
              <button
                type="button"
                onClick={resetForm}
                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Cancel Edit</span>
              </button>
            ) : null}
          </div>
        </div>

        {feedback ? (
          <div
            className={`mt-4 flex items-start gap-2 rounded-lg border p-3 text-xs ${
              feedback.type === 'success'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                : 'border-red-200 bg-red-50 text-red-900'
            }`}
          >
            {feedback.type === 'success' ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" aria-hidden="true" />
            ) : (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-700" aria-hidden="true" />
            )}
            <span>{feedback.text}</span>
          </div>
        ) : null}

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor="note-title" className="block text-xs font-medium text-slate-700">
                Subject / Short Title (Optional)
              </label>
              <input
                id="note-title"
                type="text"
                maxLength={120}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Gate opening update"
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-[#0b3b24] focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="note-category" className="block text-xs font-medium text-slate-700">
                Category
              </label>
              <select
                id="note-category"
                value={category}
                onChange={(e) => setCategory(e.target.value as OperationalNoteCategory)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-[#0b3b24] focus:outline-none"
              >
                {Object.entries(CATEGORY_LABELS).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            {!compact && user.role !== UserRole.POLLING_UNIT_AGENT ? (
              <div>
                <label htmlFor="note-lga" className="block text-xs font-medium text-slate-700">
                  Area Scope
                </label>
                <select
                  id="note-lga"
                  value={lgaId}
                  onChange={(e) => {
                    const nextLga = e.target.value as 'all' | LgaId;
                    setLgaId(nextLga);
                    setWardId('');
                    setPuId('');
                  }}
                  disabled={authorizedLgas.length === 1 && user.role !== UserRole.FULL_CONTROL_ADMIN}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-[#0b3b24] focus:outline-none disabled:bg-slate-50"
                >
                  {user.role === UserRole.FULL_CONTROL_ADMIN ? (
                    <option value="all">All Constituency</option>
                  ) : null}
                  {authorizedLgas.map((id) => (
                    <option key={id} value={id}>
                      {LGA_DEFINITIONS[id].displayName}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="flex items-end pb-2">
                <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={isPinned}
                    onChange={(e) => setIsPinned(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-[#0b3b24] focus:ring-[#0b3b24]"
                  />
                  <span>Pin note at top</span>
                </label>
              </div>
            )}
          </div>

          {!compact && user.role !== UserRole.POLLING_UNIT_AGENT ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label htmlFor="note-ward" className="block text-xs font-medium text-slate-700">
                  Ward (Optional)
                </label>
                <select
                  id="note-ward"
                  value={wardId}
                  onChange={(e) => {
                    setWardId(e.target.value);
                    setPuId('');
                  }}
                  disabled={Boolean(user.assignedWardId)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-[#0b3b24] focus:outline-none disabled:bg-slate-50"
                >
                  <option value="">All / Ward-wide</option>
                  {scopedWards.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="note-pu" className="block text-xs font-medium text-slate-700">
                  Polling Unit (Optional)
                </label>
                <select
                  id="note-pu"
                  value={puId}
                  onChange={(e) => setPuId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-[#0b3b24] focus:outline-none"
                >
                  <option value="">General / Not unit-specific</option>
                  {scopedPus.slice(0, 300).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.puCode} · {p.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-end pb-2">
                <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={isPinned}
                    onChange={(e) => setIsPinned(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-[#0b3b24] focus:ring-[#0b3b24]"
                  />
                  <span>Pin note at top</span>
                </label>
              </div>
            </div>
          ) : null}

          <div>
            <label htmlFor="note-content" className="block text-xs font-medium text-slate-700">
              Note / Short Message *
            </label>
            <textarea
              id="note-content"
              rows={compact ? 2 : 3}
              required
              maxLength={1000}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Write a brief note, observation, queue count, or shift message..."
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-[#0b3b24] focus:outline-none"
            />
            <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500">
              <span>{isOnline ? 'Saves online & locally' : 'Offline mode: saves safely on device'}</span>
              <span className="font-mono tabular-nums">{content.length}/1000</span>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex min-h-[42px] items-center gap-2 rounded-lg bg-[#0b3b24] px-4 py-2 text-sm font-semibold text-white hover:bg-[#115233] disabled:opacity-60"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              <span>
                {saving
                  ? 'Saving...'
                  : editingNote
                    ? 'Update Note'
                    : isOnline
                      ? 'Save Note'
                      : 'Save Note Offline'}
              </span>
            </button>
          </div>
        </form>
      </div>

      {/* Saved Notes List */}
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              Saved Notes ({filteredNotes.length})
            </h3>
            <p className="text-xs text-slate-500">
              Accessible offline and synchronized across sessions.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
                aria-hidden="true"
              />
              <input
                type="search"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search notes..."
                aria-label="Search notes"
                className="w-44 rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-8 pr-3 text-xs text-slate-900 focus:border-[#0b3b24] focus:bg-white focus:outline-none"
              />
            </div>

            <select
              value={categoryFilter}
              onChange={(e) =>
                setCategoryFilter(e.target.value as 'ALL' | OperationalNoteCategory)
              }
              aria-label="Filter notes by category"
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 focus:border-[#0b3b24] focus:outline-none"
            >
              <option value="ALL">All Categories</option>
              {Object.entries(CATEGORY_LABELS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {filteredNotes.length === 0 ? (
          <p className="py-8 text-center text-xs text-slate-500">
            No operational notes recorded yet. Add a note above to save brief updates or handover messages.
          </p>
        ) : (
          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
            {filteredNotes.map((note) => {
              const editable = canModifyNote(note);
              return (
                <article
                  key={note.clientNoteId || note.id}
                  className={`flex flex-col justify-between rounded-lg border p-3.5 ${
                    note.isPinned
                      ? 'border-emerald-300 bg-emerald-50/40'
                      : 'border-slate-200 bg-slate-50/60'
                  }`}
                >
                  <div>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {note.isPinned ? (
                            <Pin className="h-3.5 w-3.5 text-[#0b3b24]" aria-hidden="true" />
                          ) : null}
                          <span className="rounded bg-slate-200/70 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-700">
                            {CATEGORY_LABELS[note.category] || note.category}
                          </span>
                          {note.puCode ? (
                            <span className="font-mono text-[11px] font-medium text-[#0b3b24]">
                              {note.puCode}
                            </span>
                          ) : null}
                        </div>
                        {note.title ? (
                          <h4 className="mt-1.5 text-sm font-semibold text-slate-900">
                            {note.title}
                          </h4>
                        ) : null}
                      </div>

                      <OfflineSyncBadge status={note.syncState || 'SYNCED'} />
                    </div>

                    <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-relaxed text-slate-800">
                      {note.content}
                    </p>

                    {note.syncError ? (
                      <p className="mt-2 rounded bg-red-50 px-2 py-1 text-[11px] text-red-800">
                        {note.syncError}
                      </p>
                    ) : null}
                  </div>

                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200/70 pt-2.5 text-[11px] text-slate-500">
                    <span>
                      {note.authorName} · Orig:{' '}
                      {formatFirestoreTime(note.clientCreatedAtIso || note.createdAt)} ·{' '}
                      {note.syncState && note.syncState !== 'SYNCED'
                        ? 'PENDING SYNCHRONIZATION'
                        : `Synced: ${formatFirestoreTime(note.serverSyncedAt || note.updatedAt)}`}
                    </span>

                    {editable ? (
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => startEdit(note)}
                          className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                        >
                          <Edit3 className="h-3 w-3" aria-hidden="true" />
                          <span>Edit</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteNote(note)}
                          className="inline-flex items-center gap-1 rounded border border-red-200 bg-white px-2 py-1 text-[11px] font-medium text-red-700 hover:bg-red-50"
                        >
                          <Trash2 className="h-3 w-3" aria-hidden="true" />
                          <span>Delete</span>
                        </button>
                      </div>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      {/* Confirmation Dialog for Permanent Note Deletion */}
      {confirmDeleteNote ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Confirm Note Deletion"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
        >
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <h3 className="font-display text-base font-bold text-slate-900">
              Permanently Delete Note?
            </h3>
            <p className="mt-2 text-xs leading-relaxed text-slate-600">
              This will permanently remove the selected note, its timestamps, and any offline copy across devices. This action cannot be undone.
            </p>
            <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-800">
              {confirmDeleteNote.title ? (
                <p className="font-semibold">{confirmDeleteNote.title}</p>
              ) : null}
              <p className="mt-1 line-clamp-3">{confirmDeleteNote.content}</p>
            </div>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteNote(null)}
                disabled={deleting}
                className="min-h-[40px] rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmDelete()}
                disabled={deleting}
                className="min-h-[40px] rounded-lg bg-red-700 px-4 py-2 text-xs font-semibold text-white hover:bg-red-800 disabled:opacity-60"
              >
                {deleting ? 'Deleting...' : 'Confirm Delete'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
