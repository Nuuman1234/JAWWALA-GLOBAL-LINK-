import { useState, type ChangeEvent } from 'react';
import { CheckCircle2, Flag, ShieldCheck, Upload } from 'lucide-react';
import { PartyLogo } from '../components/PartyLogo';
import { uploadPartyLogo } from '../services/partyService';
import {
  FIXED_PARTIES,
  UserRole,
  formatFirestoreTime,
  type PartyCode,
  type PartyConfig,
  type UserAccount,
} from '../types/fdmis';

interface PartyManagementPageProps {
  user: UserAccount;
  partyConfigs: Record<PartyCode, PartyConfig | null>;
}

export function PartyManagementPage({ user, partyConfigs }: PartyManagementPageProps) {
  const isFullAdmin = user.role === UserRole.FULL_CONTROL_ADMIN;

  const [pendingFiles, setPendingFiles] = useState<Partial<Record<PartyCode, File>>>({});
  const [previewUrls, setPreviewUrls] = useState<Partial<Record<PartyCode, string>>>({});
  const [uploadingParty, setUploadingParty] = useState<PartyCode | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  if (!isFullAdmin) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-900">
        Access Restricted: Only Full Control Admin can manage political party logos.
      </div>
    );
  }

  const handleSelectFile = (partyCode: PartyCode, e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFeedback(null);

    const reader = new FileReader();
    reader.onload = () => {
      setPendingFiles((prev) => ({ ...prev, [partyCode]: file }));
      setPreviewUrls((prev) => ({ ...prev, [partyCode]: String(reader.result || '') }));
    };
    reader.readAsDataURL(file);
  };

  const handleCancelPreview = (partyCode: PartyCode) => {
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

  const handleUpload = async (partyCode: PartyCode) => {
    const file = pendingFiles[partyCode];
    if (!file) return;
    setUploadingParty(partyCode);
    setFeedback(null);
    try {
      const saved = await uploadPartyLogo(user, partyCode, file);
      handleCancelPreview(partyCode);
      setFeedback({
        type: 'ok',
        text: `Official logo for ${saved.partyCode} (${saved.partyName}) saved securely to ${saved.storageMode === 'firebase_storage' ? 'Cloud Storage' : 'Cloud Database'}.`,
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to upload party logo.',
      });
    } finally {
      setUploadingParty(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#0b3b24] text-white">
              <Flag className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900">
                Fixed Political Party Management
              </h2>
              <p className="mt-0.5 text-xs text-slate-600">
                Exactly four immutable party options are authorized across FDMIS: APC, PDP, ADC,
                and OTHERS. Parties cannot be added, removed, or renamed.
              </p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-900">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-700" aria-hidden="true" />
            <span>4 Fixed Parties Enforced</span>
          </span>
        </div>
      </div>

      {feedback ? (
        <div
          className={`flex items-center gap-2 rounded-lg border px-4 py-3 text-sm ${
            feedback.type === 'ok'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : 'border-red-200 bg-red-50 text-red-900'
          }`}
        >
          {feedback.type === 'ok' ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-700" aria-hidden="true" />
          ) : null}
          <span>{feedback.text}</span>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        {FIXED_PARTIES.map((party) => {
          const config = partyConfigs[party.code];
          const stagedPreview = previewUrls[party.code];
          const stagedFile = pendingFiles[party.code];
          const isBusy = uploadingParty === party.code;

          return (
            <div
              key={party.code}
              className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-5"
            >
              <div>
                <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
                  <div className="flex items-center gap-3.5">
                    {stagedPreview ? (
                      <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border-2 border-[#0b3b24] bg-white p-1">
                        <img
                          src={stagedPreview}
                          alt={`${party.code} pending upload preview`}
                          className="h-full w-full object-contain"
                        />
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
                        {config?.logoUrl
                          ? `Uploaded (${config.storageMode === 'firebase_storage' ? 'Cloud Storage' : 'Cloud Database'})`
                          : 'No logo uploaded — showing party abbreviation fallback'}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="mt-4 space-y-2 text-xs text-slate-600">
                  <div className="flex items-center justify-between">
                    <span>Current Asset:</span>
                    <span className="font-mono text-slate-800">
                      {config?.fileName || 'Abbreviation fallback only'}
                    </span>
                  </div>
                  {config?.updatedAt ? (
                    <div className="flex items-center justify-between">
                      <span>Last Updated:</span>
                      <span className="font-mono text-slate-800">
                        {formatFirestoreTime(config.updatedAt)} · {config.updatedByName}
                      </span>
                    </div>
                  ) : null}
                  {config?.sha256Hash ? (
                    <div className="flex items-center justify-between">
                      <span>SHA-256:</span>
                      <span className="font-mono text-[11px] text-slate-500">
                        {config.sha256Hash.slice(0, 16)}...
                      </span>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="mt-5 space-y-3 border-t border-slate-100 pt-4">
                <label className="flex min-h-[44px] cursor-pointer items-center justify-center gap-2 rounded-lg border border-slate-300 bg-slate-50 px-4 py-2 text-xs font-medium text-slate-800 hover:bg-slate-100">
                  <Upload className="h-4 w-4 text-slate-600" aria-hidden="true" />
                  <span>
                    {stagedFile
                      ? `Selected: ${stagedFile.name}`
                      : config?.logoUrl
                        ? `Replace ${party.code} Logo`
                        : `Upload ${party.code} Logo`}
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => handleSelectFile(party.code, e)}
                    className="sr-only"
                  />
                </label>

                {stagedFile ? (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => void handleUpload(party.code)}
                      className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-lg bg-[#0b3b24] px-4 py-2 text-xs font-semibold text-white hover:bg-[#115233] disabled:opacity-60"
                    >
                      <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                      <span>
                        {isBusy ? 'Uploading Logo...' : `Confirm & Save ${party.code} Logo`}
                      </span>
                    </button>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => handleCancelPreview(party.code)}
                      className="min-h-[44px] rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Cancel
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
