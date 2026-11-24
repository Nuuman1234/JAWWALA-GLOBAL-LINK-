import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Flag,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { PartyLogo } from '../components/PartyLogo';
import {
  fetchPartyConfigsFromServer,
  hasConfiguredPartyLogo,
  removePartyLogo,
  resolvePartyLogoDisplayUrl,
  uploadPartyLogo,
  validatePartyLogoFile,
} from '../services/partyService';
import {
  FIXED_PARTIES,
  FIXED_PARTY_MAP,
  UserRole,
  formatFirestoreTime,
  type PartyCode,
  type PartyConfig,
  type UserAccount,
} from '../types/fdmis';

interface PartyManagementPageProps {
  user: UserAccount;
  partyConfigs: Record<PartyCode, PartyConfig | null>;
  onPartyConfigsRefreshed?: (configs: Record<PartyCode, PartyConfig | null>) => void;
}

function formatErrorMessage(err: unknown, fallback: string): string {
  const raw = err instanceof Error ? err.message : String(err || '');
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as { error?: string; operationType?: string; path?: string };
    if (parsed && typeof parsed.error === 'string') {
      if (parsed.error.toLowerCase().includes('permission')) {
        return 'Permission denied while saving to cloud storage. Confirm you are signed in as Full Control Admin and try again.';
      }
      return parsed.error;
    }
  } catch {
    // Plain error message
  }
  return raw;
}

function formatStorageLabel(config?: PartyConfig | null): string {
  if (!config || !hasConfiguredPartyLogo(config)) {
    return 'No logo uploaded — showing party abbreviation fallback';
  }
  switch (config.storageMode) {
    case 'firebase_storage':
      return 'Persisted in Firebase Cloud Storage';
    case 'firestore_asset_store':
      return 'Persisted in Cloud Asset Storage';
    case 'firestore_cloud':
      return 'Persisted in Cloud Database (Legacy Record)';
    default:
      return 'No logo uploaded — showing party abbreviation fallback';
  }
}

function formatFileSize(bytes?: number | null): string | null {
  if (!bytes || bytes <= 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  return `${Math.round(bytes / 1024)} KB`;
}

export function PartyManagementPage({
  user,
  partyConfigs,
  onPartyConfigsRefreshed,
}: PartyManagementPageProps) {
  const isFullAdmin = user.role === UserRole.FULL_CONTROL_ADMIN;

  const [pendingFiles, setPendingFiles] = useState<Partial<Record<PartyCode, File>>>({});
  const [previewUrls, setPreviewUrls] = useState<Partial<Record<PartyCode, string>>>({});
  const [validatingParty, setValidatingParty] = useState<PartyCode | null>(null);
  const [uploadingParty, setUploadingParty] = useState<PartyCode | null>(null);
  const [removingParty, setRemovingParty] = useState<PartyCode | null>(null);
  const [confirmRemoveParty, setConfirmRemoveParty] = useState<PartyCode | null>(null);
  const [reloadingServer, setReloadingServer] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const previewUrlsRef = useRef(previewUrls);
  previewUrlsRef.current = previewUrls;

  // Clean up any ephemeral preview object URLs on unmount
  useEffect(() => {
    return () => {
      Object.values(previewUrlsRef.current).forEach((url) => {
        if (url && url.startsWith('blob:')) {
          URL.revokeObjectURL(url);
        }
      });
    };
  }, []);

  if (!isFullAdmin) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-900">
        Access Restricted: Only Full Control Admin can manage political party logos.
      </div>
    );
  }

  const revokeStagedPreview = (partyCode: PartyCode) => {
    const existing = previewUrlsRef.current[partyCode];
    if (existing && existing.startsWith('blob:')) {
      URL.revokeObjectURL(existing);
    }
  };

  const clearStagedSelection = (partyCode: PartyCode) => {
    revokeStagedPreview(partyCode);
    setPendingFiles((prev) => {
      const next = { ...prev };
      delete next[partyCode];
      return next;
    });
    setPreviewUrls((prev) => {
      const next = { ...prev };
      delete next[partyCode];
      return next;
    });
  };

  const handleSelectFile = async (partyCode: PartyCode, e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset input value so re-selecting the same file after error or replacement always fires onChange
    e.target.value = '';
    if (!file) return;

    setFeedback(null);
    setValidatingParty(partyCode);
    try {
      await validatePartyLogoFile(file);
      revokeStagedPreview(partyCode);
      // Ephemeral preview URL used strictly for pre-upload preview in browser memory (never persisted)
      const localPreviewUrl = URL.createObjectURL(file);
      setPendingFiles((prev) => ({ ...prev, [partyCode]: file }));
      setPreviewUrls((prev) => ({ ...prev, [partyCode]: localPreviewUrl }));
    } catch (err) {
      clearStagedSelection(partyCode);
      setFeedback({
        type: 'err',
        text: formatErrorMessage(
          err,
          'Invalid logo file. Only valid PNG, JPG, JPEG, or WebP images up to 5 MB are allowed.'
        ),
      });
    } finally {
      setValidatingParty(null);
    }
  };

  const refreshFromServer = async (silent = false) => {
    setReloadingServer(true);
    try {
      const serverConfigs = await fetchPartyConfigsFromServer();
      await Promise.all(
        Object.values(serverConfigs).map((cfg) =>
          cfg && hasConfiguredPartyLogo(cfg)
            ? resolvePartyLogoDisplayUrl(cfg, { forceServer: true })
            : Promise.resolve(null)
        )
      );
      onPartyConfigsRefreshed?.(serverConfigs);
      if (!silent) {
        const activeCount = Object.values(serverConfigs).filter((c) =>
          hasConfiguredPartyLogo(c)
        ).length;
        setFeedback({
          type: 'ok',
          text: `Reloaded authoritative party records from cloud server (${activeCount}/4 party logos confirmed).`,
        });
      }
    } catch (err) {
      if (!silent) {
        setFeedback({
          type: 'err',
          text: formatErrorMessage(
            err,
            'Unable to verify party logos from server. Check your internet connection.'
          ),
        });
      }
    } finally {
      setReloadingServer(false);
    }
  };

  const handleUpload = async (partyCode: PartyCode) => {
    const file = pendingFiles[partyCode];
    if (!file) return;
    setUploadingParty(partyCode);
    setFeedback(null);
    try {
      const result = await uploadPartyLogo(user, partyCode, file);

      // Reload authoritative server state immediately so UI reflects verified cloud storage
      try {
        const latestServerConfigs = await fetchPartyConfigsFromServer();
        onPartyConfigsRefreshed?.(latestServerConfigs);
      } catch {
        onPartyConfigsRefreshed?.({
          ...partyConfigs,
          [partyCode]: result.config,
        });
      }

      clearStagedSelection(partyCode);
      setFeedback({
        type: 'ok',
        text: `${result.replacedExisting ? 'Replaced' : 'Uploaded'} and verified official ${result.config.partyCode} (${result.config.partyName}) logo in permanent cloud storage. It will remain saved across refreshes, logins, and authorized devices.`,
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: formatErrorMessage(
          err,
          `Unable to save ${partyCode} logo permanently. Verify your connection and try again.`
        ),
      });
    } finally {
      setUploadingParty(null);
    }
  };

  const handleConfirmRemove = async () => {
    if (!confirmRemoveParty) return;
    const partyCode = confirmRemoveParty;
    setRemovingParty(partyCode);
    setFeedback(null);
    try {
      const updated = await removePartyLogo(user, partyCode);
      clearStagedSelection(partyCode);

      try {
        const latestServerConfigs = await fetchPartyConfigsFromServer();
        onPartyConfigsRefreshed?.(latestServerConfigs);
      } catch {
        onPartyConfigsRefreshed?.({
          ...partyConfigs,
          [partyCode]: updated,
        });
      }

      setConfirmRemoveParty(null);
      setFeedback({
        type: 'ok',
        text: `Removed logo for ${partyCode} (${FIXED_PARTY_MAP[partyCode].name}) from permanent cloud storage. The party record remains preserved with its abbreviation badge.`,
      });
    } catch (err) {
      setConfirmRemoveParty(null);
      setFeedback({
        type: 'err',
        text: formatErrorMessage(
          err,
          `Unable to remove ${partyCode} logo from cloud storage. Please try again.`
        ),
      });
    } finally {
      setRemovingParty(null);
    }
  };

  const configuredCount = FIXED_PARTIES.filter((p) =>
    hasConfiguredPartyLogo(partyConfigs[p.code])
  ).length;

  return (
    <div className="space-y-3.5 sm:space-y-4">
      <div className="fdmis-surface p-3.5 sm:p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#06452F] text-white">
              <Flag className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900">
                Fixed Political Party Management
              </h2>
              <p className="mt-0.5 text-xs text-slate-600">
                Exactly four immutable party options are authorized across FDMIS: APC, PDP, ADC,
                and OTHERS. Logos are validated (PNG, JPG, JPEG, WebP up to 5 MB) and stored
                permanently in cloud storage linked by party ID.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-900">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-700" aria-hidden="true" />
              <span>{configuredCount}/4 Logos Saved</span>
            </span>
            <button
              type="button"
              disabled={reloadingServer || uploadingParty !== null || removingParty !== null}
              onClick={() => void refreshFromServer(false)}
              className="inline-flex min-h-[34px] items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 text-slate-500 ${reloadingServer ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              <span>{reloadingServer ? 'Verifying...' : 'Reload from Server'}</span>
            </button>
          </div>
        </div>
      </div>

      {feedback ? (
        <div
          role={feedback.type === 'err' ? 'alert' : 'status'}
          className={`flex items-start gap-2.5 rounded-lg border px-4 py-3 text-sm ${
            feedback.type === 'ok'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : 'border-red-200 bg-red-50 text-red-900'
          }`}
        >
          {feedback.type === 'ok' ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" aria-hidden="true" />
          ) : (
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-700" aria-hidden="true" />
          )}
          <span className="flex-1">{feedback.text}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            aria-label="Dismiss notification"
            className="rounded p-0.5 opacity-70 hover:opacity-100"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-2">
        {FIXED_PARTIES.map((party) => {
          const config = partyConfigs[party.code];
          const hasSavedLogo = hasConfiguredPartyLogo(config);
          const stagedPreview = previewUrls[party.code];
          const stagedFile = pendingFiles[party.code];
          const isValidating = validatingParty === party.code;
          const isUploading = uploadingParty === party.code;
          const isRemoving = removingParty === party.code;
          const isBusy = isValidating || isUploading || isRemoving;
          const sizeLabel = formatFileSize(config?.fileSizeBytes);

          return (
            <div
              key={party.code}
              className="flex flex-col justify-between fdmis-surface p-3.5 sm:p-4"
            >
              <div>
                <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
                  <div className="flex items-center gap-3.5">
                    {stagedPreview ? (
                      <div className="relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border-2 border-[#06452F] bg-white p-1">
                        <img
                          src={stagedPreview}
                          alt={`${party.code} pending upload preview`}
                          className="h-full w-full object-contain"
                        />
                        <span className="absolute bottom-0 left-0 right-0 bg-[#06452F]/90 py-0.5 text-center text-[9px] font-semibold uppercase tracking-wide text-white">
                          Preview
                        </span>
                      </div>
                    ) : (
                      <PartyLogo partyCode={party.code} partyConfig={config} size="xl" />
                    )}
                    <div>
                      <span
                        className={`inline-block rounded border px-2 py-0.5 font-mono text-xs font-bold ${party.badgeClass}`}
                      >
                        {party.code}
                      </span>
                      <h3 className="mt-1.5 font-display text-base font-semibold text-slate-900">
                        {party.name}
                      </h3>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {formatStorageLabel(config)}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="mt-4 space-y-2 text-xs text-slate-600">
                  <div className="flex items-center justify-between gap-2">
                    <span>Party ID:</span>
                    <span className="font-mono font-semibold text-slate-800">{party.code}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span>Current Asset:</span>
                    <span className="truncate font-mono text-slate-800">
                      {hasSavedLogo && config?.fileName
                        ? `${config.fileName}${sizeLabel ? ` (${sizeLabel})` : ''}`
                        : 'Abbreviation fallback only'}
                    </span>
                  </div>
                  {hasSavedLogo && config?.storagePath ? (
                    <div className="flex items-center justify-between gap-2">
                      <span>Storage Ref:</span>
                      <span className="truncate font-mono text-[11px] text-slate-600">
                        {config.storagePath}
                      </span>
                    </div>
                  ) : null}
                  {config?.updatedAt ? (
                    <div className="flex items-center justify-between gap-2">
                      <span>Last Updated:</span>
                      <span className="font-mono text-slate-800">
                        {formatFirestoreTime(config.updatedAt)} · {config.updatedByName}
                      </span>
                    </div>
                  ) : null}
                  {hasSavedLogo && config?.sha256Hash ? (
                    <div className="flex items-center justify-between gap-2">
                      <span>SHA-256:</span>
                      <span className="font-mono text-[11px] text-slate-500">
                        {config.sha256Hash.slice(0, 16)}...
                      </span>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="mt-5 space-y-3 border-t border-slate-100 pt-4">
                <div className="flex items-center gap-2">
                  <label
                    className={`flex min-h-[44px] flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg border border-slate-300 bg-slate-50 px-4 py-2 text-xs font-medium text-slate-800 hover:bg-slate-100 ${
                      isBusy ? 'pointer-events-none opacity-60' : ''
                    }`}
                  >
                    <Upload className="h-4 w-4 shrink-0 text-slate-600" aria-hidden="true" />
                    <span className="truncate">
                      {isValidating
                        ? 'Validating image...'
                        : stagedFile
                          ? `Selected: ${stagedFile.name}`
                          : hasSavedLogo
                            ? `Replace ${party.code} Logo`
                            : `Upload ${party.code} Logo`}
                    </span>
                    <input
                      type="file"
                      accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
                      disabled={isBusy}
                      onChange={(e) => void handleSelectFile(party.code, e)}
                      className="sr-only"
                    />
                  </label>

                  {hasSavedLogo && !stagedFile ? (
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => {
                        setFeedback(null);
                        setConfirmRemoveParty(party.code);
                      }}
                      className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-800 hover:bg-red-100 disabled:opacity-60"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                      <span>Remove</span>
                    </button>
                  ) : null}
                </div>

                {stagedFile ? (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => void handleUpload(party.code)}
                      className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-lg bg-[#06452F] px-4 py-2 text-xs font-semibold text-white hover:bg-[#043B29] disabled:opacity-60"
                    >
                      <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                      <span>
                        {isUploading
                          ? 'Saving & Verifying on Server...'
                          : hasSavedLogo
                            ? `Confirm & Replace ${party.code} Logo`
                            : `Confirm & Save ${party.code} Logo`}
                      </span>
                    </button>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => clearStagedSelection(party.code)}
                      className="min-h-[44px] rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                    >
                      Cancel
                    </button>
                  </div>
                ) : null}

                <p className="text-[11px] text-slate-500">
                  Accepted formats: PNG, JPG, JPEG, WebP (max 5 MB). Saved logos are verified on
                  the cloud server before confirmation.
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Explicit Confirmation Modal for Removing a Party Logo */}
      {confirmRemoveParty ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="remove-logo-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
        >
          <div className="w-full max-w-md fdmis-surface p-4 sm:p-5 shadow-xl">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-red-100 text-red-700">
                <Trash2 className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <h3
                  id="remove-logo-modal-title"
                  className="font-display text-base font-semibold text-slate-900"
                >
                  Remove {confirmRemoveParty} Party Logo?
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-slate-600">
                  This will permanently delete the uploaded logo image for{' '}
                  <span className="font-semibold text-slate-900">
                    {confirmRemoveParty} ({FIXED_PARTY_MAP[confirmRemoveParty].name})
                  </span>{' '}
                  from cloud storage and revert all dashboards, result tables, and charts to the
                  official party abbreviation badge. The party record itself will not be deleted.
                </p>
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-2.5">
              <button
                type="button"
                disabled={removingParty !== null}
                onClick={() => setConfirmRemoveParty(null)}
                className="min-h-[40px] rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={removingParty !== null}
                onClick={() => void handleConfirmRemove()}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-red-700 px-4 py-2 text-xs font-semibold text-white hover:bg-red-800 disabled:opacity-60"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                <span>
                  {removingParty === confirmRemoveParty
                    ? 'Removing from Cloud...'
                    : `Confirm Remove ${confirmRemoveParty} Logo`}
                </span>
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
