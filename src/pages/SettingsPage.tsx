import { useEffect, useState, type FormEvent } from 'react';
import {
  Bell,
  CheckCircle2,
  KeyRound,
  Lock,
  LogOut,
  MessageCircle,
  RotateCcw,
  Settings as SettingsIcon,
  ShieldCheck,
  User,
  X,
} from 'lucide-react';
import { AccountStatusBadge, RoleBadge } from '../components/StatusBadge';
import { WhatsAppGroupCard } from '../components/WhatsAppGroupCard';
import {
  changeAccountPassword,
  getAuthProviderSummary,
  saveUserPreferences,
  subscribeToUserPreferences,
  updateOwnProfile,
} from '../services/authService';
import { updateGlobalSettings } from '../services/directoryService';
import {
  DEFAULT_WHATSAPP_GROUP_NAME,
  DEFAULT_WHATSAPP_GROUP_URL,
  LGA_DEFINITIONS,
  UserRole,
  canManageSettings,
  resolveWhatsAppGroupConfig,
  type GlobalSettings,
  type LgaId,
  type UserAccount,
} from '../types/fdmis';

interface SettingsPageProps {
  user: UserAccount;
  settings: GlobalSettings | null;
  onSignOut: () => Promise<void>;
}

function describeUserScope(user: UserAccount): string {
  if (user.role === UserRole.FULL_CONTROL_ADMIN) return 'Constituency-wide (Funtua & Dandume LGAs)';
  if (user.role === UserRole.FUNTUA_SUPER_ADMIN) return LGA_DEFINITIONS.funtua.displayName;
  if (user.role === UserRole.DANDUME_SUPER_ADMIN) return LGA_DEFINITIONS.dandume.displayName;
  if (user.role === UserRole.VERIFICATION_OFFICER) {
    if (user.assignedWardId) return `Ward ${user.assignedWardId}`;
    if (user.assignedLgaId && user.assignedLgaId in LGA_DEFINITIONS) {
      return LGA_DEFINITIONS[user.assignedLgaId as LgaId].displayName;
    }
    return 'Constituency-wide Verification Scope';
  }
  if (user.role === UserRole.WARD_COORDINATOR) {
    return user.assignedWardId ? `Ward ${user.assignedWardId}` : 'Assigned Ward';
  }
  if (user.role === UserRole.POLLING_UNIT_AGENT) {
    return user.assignedPollingUnitId ? `Polling Unit ${user.assignedPollingUnitId}` : 'Unassigned PU';
  }
  return 'Unassigned';
}

export function SettingsPage({ user, settings, onSignOut }: SettingsPageProps) {
  const isFullAdmin = canManageSettings(user.role);
  const authSummary = getAuthProviderSummary();

  // Profile state
  const [displayName, setDisplayName] = useState(user.displayName);
  const [phone, setPhone] = useState(user.phone || '');
  const [savingProfile, setSavingProfile] = useState(false);

  // Password change state (for password-enabled Firebase accounts)
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  // Notification preferences state
  const [criticalAlertsEnabled, setCriticalAlertsEnabled] = useState(true);
  const [resultUpdatesEnabled, setResultUpdatesEnabled] = useState(true);
  const [incidentDigestEnabled, setIncidentDigestEnabled] = useState(true);
  const [soundAlertsEnabled, setSoundAlertsEnabled] = useState(false);
  const [savingPrefs, setSavingPrefs] = useState(false);

  // Admin system policy state
  const [timeoutMinutes, setTimeoutMinutes] = useState(
    String(settings?.inactivityTimeoutMinutes ?? 30)
  );
  const [mfaPrepared, setMfaPrepared] = useState(settings?.mfaPrepared ?? true);
  const [publicSummaryEnabled, setPublicSummaryEnabled] = useState(
    settings?.publicSummaryEnabled ?? false
  );
  const [savingPolicy, setSavingPolicy] = useState(false);

  // Admin WhatsApp group integration state
  const initialWa = resolveWhatsAppGroupConfig(settings);
  const [whatsappGroupEnabled, setWhatsappGroupEnabled] = useState(
    settings?.whatsappGroupEnabled ?? true
  );
  const [whatsappGroupName, setWhatsappGroupName] = useState(
    settings?.whatsappGroupName || DEFAULT_WHATSAPP_GROUP_NAME
  );
  const [whatsappGroupUrl, setWhatsappGroupUrl] = useState(
    settings?.whatsappGroupUrl !== undefined ? settings.whatsappGroupUrl : initialWa.inviteUrl
  );
  const [savingWhatsapp, setSavingWhatsapp] = useState(false);

  // Logout confirmation modal state
  const [confirmLogoutOpen, setConfirmLogoutOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    setDisplayName(user.displayName);
    setPhone(user.phone || '');
  }, [user.displayName, user.phone]);

  useEffect(() => {
    if (settings) {
      setTimeoutMinutes(String(settings.inactivityTimeoutMinutes));
      setMfaPrepared(settings.mfaPrepared);
      setPublicSummaryEnabled(settings.publicSummaryEnabled);
      setWhatsappGroupEnabled(settings.whatsappGroupEnabled ?? true);
      setWhatsappGroupName(settings.whatsappGroupName || DEFAULT_WHATSAPP_GROUP_NAME);
      setWhatsappGroupUrl(
        settings.whatsappGroupUrl !== undefined
          ? settings.whatsappGroupUrl
          : DEFAULT_WHATSAPP_GROUP_URL
      );
    }
  }, [settings]);

  useEffect(() => {
    const unsub = subscribeToUserPreferences(
      user.uid,
      (prefs) => {
        if (prefs) {
          setCriticalAlertsEnabled(prefs.criticalAlertsEnabled);
          setResultUpdatesEnabled(prefs.resultUpdatesEnabled);
          setIncidentDigestEnabled(prefs.incidentDigestEnabled);
          setSoundAlertsEnabled(prefs.soundAlertsEnabled);
        }
      },
      () => {
        // Default toggles stay active if preferences doc has not been created yet
      }
    );
    return () => unsub();
  }, [user.uid]);

  const handleSaveProfile = async (e: FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    setFeedback(null);
    try {
      await updateOwnProfile(user, { displayName, phone });
      setFeedback({ type: 'ok', text: 'Account profile updated.' });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to update profile.',
      });
    } finally {
      setSavingProfile(false);
    }
  };

  const handleChangePassword = async (e: FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    if (newPassword !== confirmPassword) {
      setFeedback({ type: 'err', text: 'New password and confirmation do not match.' });
      return;
    }
    setSavingPassword(true);
    try {
      await changeAccountPassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setFeedback({ type: 'ok', text: 'Account password updated successfully.' });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to update password.',
      });
    } finally {
      setSavingPassword(false);
    }
  };

  const handleSavePrefs = async (e: FormEvent) => {
    e.preventDefault();
    setSavingPrefs(true);
    setFeedback(null);
    try {
      await saveUserPreferences(user.uid, {
        criticalAlertsEnabled,
        resultUpdatesEnabled,
        incidentDigestEnabled,
        soundAlertsEnabled,
      });
      setFeedback({ type: 'ok', text: 'Personal notification preferences saved.' });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to save preferences.',
      });
    } finally {
      setSavingPrefs(false);
    }
  };

  const handleSaveSystemPolicy = async (e: FormEvent) => {
    e.preventDefault();
    setSavingPolicy(true);
    setFeedback(null);
    try {
      await updateGlobalSettings(user, {
        inactivityTimeoutMinutes: Number(timeoutMinutes) || 30,
        mfaPrepared,
        publicSummaryEnabled,
        smsFallbackConfigured: settings?.smsFallbackConfigured ?? false,
        whatsappConfigured: settings?.whatsappConfigured ?? false,
        emailConfigured: settings?.emailConfigured ?? false,
        whatsappGroupName,
        whatsappGroupUrl,
        whatsappGroupEnabled,
      });
      setFeedback({
        type: 'ok',
        text: 'System security policies saved and recorded in audit log.',
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to save system settings.',
      });
    } finally {
      setSavingPolicy(false);
    }
  };

  const handleSaveWhatsAppGroup = async (e: FormEvent) => {
    e.preventDefault();
    setSavingWhatsapp(true);
    setFeedback(null);
    try {
      await updateGlobalSettings(user, {
        inactivityTimeoutMinutes: settings?.inactivityTimeoutMinutes ?? (Number(timeoutMinutes) || 30),
        mfaPrepared: settings?.mfaPrepared ?? mfaPrepared,
        publicSummaryEnabled: settings?.publicSummaryEnabled ?? publicSummaryEnabled,
        smsFallbackConfigured: settings?.smsFallbackConfigured ?? false,
        whatsappConfigured: settings?.whatsappConfigured ?? false,
        emailConfigured: settings?.emailConfigured ?? false,
        whatsappGroupName,
        whatsappGroupUrl,
        whatsappGroupEnabled,
      });
      setFeedback({
        type: 'ok',
        text: whatsappGroupEnabled
          ? `WhatsApp group "${whatsappGroupName.trim() || DEFAULT_WHATSAPP_GROUP_NAME}" updated.`
          : 'WhatsApp group invitation link disabled for operators.',
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to save WhatsApp group settings.',
      });
    } finally {
      setSavingWhatsapp(false);
    }
  };

  const handleConfirmLogout = async () => {
    setLoggingOut(true);
    try {
      await onSignOut();
    } finally {
      setLoggingOut(false);
      setConfirmLogoutOpen(false);
    }
  };

  return (
    <div className="space-y-6">
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

      {/* 1. Prominent Session & Logout Card (Visible to Every Authenticated Role) */}
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-base font-semibold text-slate-900">
                Active Operator Session
              </h2>
              <RoleBadge role={user.role} />
              <AccountStatusBadge status={user.status} />
            </div>
            <p className="mt-1 text-xs text-slate-600">
              Signed in as <span className="font-medium text-slate-900">{user.email}</span> ·
              Scope: <span className="font-medium text-slate-800">{describeUserScope(user)}</span>
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Inactivity auto-lock timeout: {settings?.inactivityTimeoutMinutes ?? 30} minutes.
              Logging out terminates your active session, clears local auth tokens, and locks
              protected routes.
            </p>
          </div>

          <button
            type="button"
            onClick={() => setConfirmLogoutOpen(true)}
            className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-2 rounded-lg border border-red-300 bg-red-50 px-5 py-2.5 text-sm font-semibold text-red-800 transition-colors hover:bg-red-100"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            <span>Log Out</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* 2. Account Profile */}
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <div className="flex items-center gap-2.5 border-b border-slate-100 pb-3">
            <User className="h-4 w-4 text-[#0b3b24]" aria-hidden="true" />
            <h3 className="font-display text-sm font-semibold text-slate-900">
              Account Profile Information
            </h3>
          </div>

          <form onSubmit={handleSaveProfile} className="mt-4 space-y-3.5">
            <div>
              <label htmlFor="prof-email" className="block text-xs font-medium text-slate-700">
                Verified Email (Immutable)
              </label>
              <input
                id="prof-email"
                type="text"
                disabled
                value={user.email}
                className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-600"
              />
            </div>

            <div>
              <label htmlFor="prof-name" className="block text-xs font-medium text-slate-700">
                Operational Display Name *
              </label>
              <input
                id="prof-name"
                type="text"
                required
                minLength={2}
                maxLength={110}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-300 px-3 text-sm text-slate-900"
              />
            </div>

            <div>
              <label htmlFor="prof-phone" className="block text-xs font-medium text-slate-700">
                Contact Phone Number
              </label>
              <input
                id="prof-phone"
                type="tel"
                maxLength={30}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="e.g. +234 800 000 0000"
                className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-300 px-3 text-sm text-slate-900"
              />
            </div>

            <button
              type="submit"
              disabled={savingProfile}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-[#0b3b24] px-4 py-2 text-sm font-medium text-white hover:bg-[#115233] disabled:opacity-60"
            >
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              <span>{savingProfile ? 'Saving Profile...' : 'Save Profile'}</span>
            </button>
          </form>
        </div>

        {/* 3. Account Security & Password */}
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <div className="flex items-center gap-2.5 border-b border-slate-100 pb-3">
            <KeyRound className="h-4 w-4 text-[#0b3b24]" aria-hidden="true" />
            <h3 className="font-display text-sm font-semibold text-slate-900">
              Account Security &amp; Authentication
            </h3>
          </div>

          {authSummary.hasPasswordProvider ? (
            <form onSubmit={handleChangePassword} className="mt-4 space-y-3.5">
              <div>
                <label htmlFor="sec-cur-pass" className="block text-xs font-medium text-slate-700">
                  Current Password *
                </label>
                <input
                  id="sec-cur-pass"
                  type="password"
                  required
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-300 px-3 text-sm"
                />
              </div>
              <div>
                <label htmlFor="sec-new-pass" className="block text-xs font-medium text-slate-700">
                  New Password (min 8 characters) *
                </label>
                <input
                  id="sec-new-pass"
                  type="password"
                  required
                  minLength={8}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-300 px-3 text-sm"
                />
              </div>
              <div>
                <label htmlFor="sec-conf-pass" className="block text-xs font-medium text-slate-700">
                  Confirm New Password *
                </label>
                <input
                  id="sec-conf-pass"
                  type="password"
                  required
                  minLength={8}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-300 px-3 text-sm"
                />
              </div>
              <button
                type="submit"
                disabled={savingPassword}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-[#0b3b24] px-4 py-2 text-sm font-medium text-white hover:bg-[#115233] disabled:opacity-60"
              >
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                <span>{savingPassword ? 'Updating...' : 'Update Password'}</span>
              </button>
            </form>
          ) : (
            <div className="mt-4 space-y-3 text-xs leading-relaxed text-slate-600">
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3.5 text-emerald-950">
                <p className="font-semibold">Google Single Sign-On Active</p>
                <p className="mt-1">
                  Your FDMIS session is authenticated via Google Identity ({authSummary.email || user.email}).
                  Password updates and 2-Step Verification are protected directly by your Google
                  Account security settings.
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5">
                <p className="font-medium text-slate-800">Session Enforcement</p>
                <p className="mt-1 text-slate-600">
                  Token verification, server-side revocation checks, and{' '}
                  {settings?.inactivityTimeoutMinutes ?? 30}-minute inactivity lockouts remain active
                  on every request.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 4. Notification Preferences (Every Active User) */}
      <div className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex items-center gap-2.5 border-b border-slate-100 pb-3">
          <Bell className="h-4 w-4 text-[#0b3b24]" aria-hidden="true" />
          <div>
            <h3 className="font-display text-sm font-semibold text-slate-900">
              Notification Preferences
            </h3>
            <p className="text-xs text-slate-500">
              Saved privately to your operator profile in Cloud Firestore.
            </p>
          </div>
        </div>

        <form onSubmit={handleSavePrefs} className="mt-4 space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {[
              {
                label: 'Critical Incident Alerts',
                desc: 'Highlight urgent high/critical escalation notices in your scope.',
                checked: criticalAlertsEnabled,
                onChange: setCriticalAlertsEnabled,
              },
              {
                label: 'Result Verification Updates',
                desc: 'Track submission approvals, rejections, and correction requests.',
                checked: resultUpdatesEnabled,
                onChange: setResultUpdatesEnabled,
              },
              {
                label: 'Incident Workflow Digest',
                desc: 'Receive updates when field incidents transition across statuses.',
                checked: incidentDigestEnabled,
                onChange: setIncidentDigestEnabled,
              },
              {
                label: 'Browser Alert Chime (Optional)',
                desc: 'Play a subtle chime when critical alerts arrive while active.',
                checked: soundAlertsEnabled,
                onChange: setSoundAlertsEnabled,
              },
            ].map((pref) => (
              <label
                key={pref.label}
                className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50/70 p-3"
              >
                <input
                  type="checkbox"
                  checked={pref.checked}
                  onChange={(e) => pref.onChange(e.target.checked)}
                  className="mt-1 h-4 w-4 accent-[#0b3b24]"
                />
                <span className="text-xs text-slate-800">
                  <span className="font-semibold">{pref.label}</span>
                  <span className="mt-0.5 block text-slate-500">{pref.desc}</span>
                </span>
              </label>
            ))}
          </div>

          <button
            type="submit"
            disabled={savingPrefs}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-60"
          >
            <CheckCircle2 className="h-4 w-4 text-[#0b3b24]" aria-hidden="true" />
            <span>{savingPrefs ? 'Saving Preferences...' : 'Save Notification Preferences'}</span>
          </button>
        </form>
      </div>

      {/* 5. Full Control Admin System Policies & Gateways */}
      {isFullAdmin ? (
        <>
          <div className="rounded-xl border border-slate-200 bg-white p-6">
            <div className="flex items-center gap-2.5 border-b border-slate-100 pb-4">
              <SettingsIcon className="h-5 w-5 text-[#0b3b24]" aria-hidden="true" />
              <div>
                <h3 className="font-display text-base font-semibold text-slate-900">
                  Constituency Session Security &amp; Operational Policies
                </h3>
                <p className="text-xs text-slate-500">
                  Full Control Admin global configuration for Funtua–Dandume Situation Room
                </p>
              </div>
            </div>

            <form onSubmit={handleSaveSystemPolicy} className="mt-5 space-y-5">
              <div>
                <label
                  htmlFor="inactivity-timeout"
                  className="block text-xs font-medium text-slate-700"
                >
                  Inactivity Auto-Logout Timeout (Minutes, 5–480)
                </label>
                <input
                  id="inactivity-timeout"
                  type="number"
                  min={5}
                  max={480}
                  required
                  value={timeoutMinutes}
                  onChange={(e) => setTimeoutMinutes(e.target.value)}
                  className="mt-1.5 min-h-[44px] w-full max-w-xs rounded-lg border border-slate-300 px-3 font-mono text-sm tabular-nums"
                />
                <p className="mt-1 text-xs text-slate-500">
                  Automatically terminates inactive Situation Room sessions and logs the timeout
                  event.
                </p>
              </div>

              <div className="space-y-3 border-t border-slate-100 pt-4">
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={mfaPrepared}
                    onChange={(e) => setMfaPrepared(e.target.checked)}
                    className="mt-1 h-4 w-4 rounded border-slate-300 accent-[#0b3b24]"
                  />
                  <span className="text-sm text-slate-800">
                    <span className="font-medium">
                      Multi-Factor Authentication (MFA) Enforcement Prepared
                    </span>
                    <span className="block text-xs text-slate-500">
                      Marks operator profiles ready for hardware/TOTP MFA enforcement via Firebase
                      Auth.
                    </span>
                  </span>
                </label>

                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={publicSummaryEnabled}
                    onChange={(e) => setPublicSummaryEnabled(e.target.checked)}
                    className="mt-1 h-4 w-4 rounded border-slate-300 accent-[#0b3b24]"
                  />
                  <span className="text-sm text-slate-800">
                    <span className="font-medium">Public Verified Results Summary Gate</span>
                    <span className="block text-xs text-slate-500">
                      Allows publishing explicitly verified, sanitized polling-unit results (zero PII
                      or internal notes).
                    </span>
                  </span>
                </label>
              </div>

              <button
                type="submit"
                disabled={savingPolicy}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-[#0b3b24] px-5 py-2 text-sm font-medium text-white hover:bg-[#115233] disabled:opacity-60"
              >
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                <span>{savingPolicy ? 'Saving Policy...' : 'Save Security Settings'}</span>
              </button>
            </form>
          </div>

          {/* Official WhatsApp Group Integration (Free Direct Team Coordination) */}
          <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2.5">
                <MessageCircle className="h-5 w-5 text-[#0b3b24]" aria-hidden="true" />
                <div>
                  <h3 className="font-display text-base font-semibold text-slate-900">
                    WhatsApp Group Integration
                  </h3>
                  <p className="text-xs text-slate-500">
                    Manage the authenticated-only Situation Room WhatsApp invite link (no paid
                    WhatsApp API required).
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  setWhatsappGroupEnabled(true);
                  setWhatsappGroupName(DEFAULT_WHATSAPP_GROUP_NAME);
                  setWhatsappGroupUrl(DEFAULT_WHATSAPP_GROUP_URL);
                }}
                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Restore Official Link</span>
              </button>
            </div>

            <form onSubmit={handleSaveWhatsAppGroup} className="space-y-4">
              <label className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50/70 p-3.5">
                <input
                  type="checkbox"
                  checked={whatsappGroupEnabled}
                  onChange={(e) => setWhatsappGroupEnabled(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-[#0b3b24]"
                />
                <span className="text-xs text-slate-800">
                  <strong className="text-sm font-semibold text-slate-900">
                    Enable Join FDMIS WhatsApp Group Button
                  </strong>
                  <span className="mt-0.5 block text-slate-500">
                    Visible strictly to authenticated active operators on desktop and mobile; never
                    exposed to unauthenticated visitors.
                  </span>
                </span>
              </label>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="wa-group-name" className="block text-xs font-medium text-slate-700">
                    Official WhatsApp Group Name *
                  </label>
                  <input
                    id="wa-group-name"
                    type="text"
                    required
                    maxLength={120}
                    value={whatsappGroupName}
                    onChange={(e) => setWhatsappGroupName(e.target.value)}
                    placeholder={DEFAULT_WHATSAPP_GROUP_NAME}
                    className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-300 px-3 text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="wa-group-url" className="block text-xs font-medium text-slate-700">
                    WhatsApp Group Invite Link
                  </label>
                  <input
                    id="wa-group-url"
                    type="url"
                    maxLength={400}
                    value={whatsappGroupUrl}
                    onChange={(e) => setWhatsappGroupUrl(e.target.value)}
                    placeholder="https://chat.whatsapp.com/..."
                    className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-300 px-3 font-mono text-xs"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={savingWhatsapp}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-[#0b3b24] px-5 py-2 text-sm font-medium text-white hover:bg-[#115233] disabled:opacity-60"
              >
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                <span>{savingWhatsapp ? 'Saving WhatsApp Group...' : 'Save WhatsApp Group Settings'}</span>
              </button>
            </form>

            <WhatsAppGroupCard settings={settings} compact />
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
            <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
              <Lock className="h-4 w-4 text-slate-600" aria-hidden="true" />
              <div>
                <h3 className="font-display text-sm font-semibold text-slate-900">
                  External Communication Providers &amp; Free Channels
                </h3>
                <p className="text-xs text-slate-500">
                  External gateways remain strictly inactive until valid server credentials are
                  configured and tested. No credentials are ever stored or exposed in the browser.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-3.5">
                <p className="text-xs font-semibold text-[#0b3b24]">
                  In-App Situation Room Notifications (Free Core)
                </p>
                <p className="mt-1 text-xs font-medium text-emerald-900">
                  Active — Operates independently without external API keys
                </p>
              </div>
              <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-3.5">
                <p className="text-xs font-semibold text-[#0b3b24]">
                  WhatsApp Direct Group ({whatsappGroupName || DEFAULT_WHATSAPP_GROUP_NAME})
                </p>
                <p className="mt-1 text-xs font-medium text-emerald-900">
                  {whatsappGroupEnabled && whatsappGroupUrl
                    ? 'Active (Free Direct Invite Link)'
                    : 'Disabled by Administrator'}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {[
                {
                  label: 'SMS / USSD Fallback',
                  active: settings?.smsFallbackConfigured ?? false,
                  note: 'Disabled until a real server SMS/USSD provider is configured',
                },
                {
                  label: 'WhatsApp Alert Gateway',
                  active: settings?.whatsappConfigured ?? false,
                  note: 'Inactive until verified server WhatsApp Business credentials are configured',
                },
                {
                  label: 'Email Dispatch Gateway',
                  active: settings?.emailConfigured ?? false,
                  note: 'Optional free-tier email relay inactive until server credentials are configured',
                },
              ].map((gw) => (
                <div key={gw.label} className="rounded-lg border border-slate-200 bg-slate-50 p-3.5">
                  <p className="text-xs font-semibold text-slate-800">{gw.label}</p>
                  <p className="mt-1 text-xs font-semibold text-slate-700">
                    {gw.active ? 'Configured (Server Active)' : 'Not Configured'}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-500">{gw.note}</p>
                </div>
              ))}
            </div>
          </div>
        </>
      ) : null}

      {/* Logout Confirmation Modal */}
      {confirmLogoutOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2 text-red-800">
                <LogOut className="h-5 w-5" aria-hidden="true" />
                <h3 className="font-display text-base font-semibold">Confirm Logout</h3>
              </div>
              <button
                type="button"
                onClick={() => setConfirmLogoutOpen(false)}
                aria-label="Close confirmation dialog"
                className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-slate-700">
              Are you sure you want to log out of the FDMIS Situation Room? Your active session and
              local authentication tokens will be cleared immediately.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={loggingOut}
                onClick={() => setConfirmLogoutOpen(false)}
                className="min-h-[44px] rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={loggingOut}
                onClick={() => void handleConfirmLogout()}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-60"
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
                <span>{loggingOut ? 'Logging Out...' : 'Confirm Logout'}</span>
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
