import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { User as FirebaseUser } from 'firebase/auth';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  LogOut,
  MapPin,
  RefreshCw,
  Shield,
  ShieldCheck,
  Trash2,
  UserCheck,
  UserPlus,
  WifiOff,
} from 'lucide-react';
import {
  AccountStatus,
  UserRole,
  type LocationCatalogLga,
  type PendingOfflineRegistration,
  type UserAccount,
} from '../types/fdmis';
import type {
  PhoneRegistrationResult,
  RegistrationLocationSelection,
} from '../services/authService';
import { formatAccountIdentifier } from '../utils/phoneAuth';
import { AccountStatusBadge, RoleBadge } from './StatusBadge';

type WelcomeMode = 'signin' | 'signup' | 'forgot';
type ForgotSubMode = 'request' | 'complete';

interface AuthGateProps {
  firebaseUser: FirebaseUser | null;
  account: UserAccount | null;
  needsBootstrap: boolean;
  needsRegistration: boolean;
  loading: boolean;
  authError: string | null;
  connectionStatus: 'checking' | 'connected' | 'offline';
  isOnline: boolean;
  locationCatalog: LocationCatalogLga[];
  refreshingLocations: boolean;
  onRefreshLocations: () => Promise<void>;
  pendingOfflineRegistrations: PendingOfflineRegistration[];
  hasEphemeralOfflinePassword: (regId: string) => boolean;
  onPhoneSignIn: (phone: string, password: string) => Promise<void>;
  onPhoneRegister: (input: {
    fullName: string;
    phone: string;
    password: string;
    confirmPassword: string;
    location: RegistrationLocationSelection;
  }) => Promise<PhoneRegistrationResult>;
  onGoogleSignIn: () => Promise<void>;
  onSubmitPasswordResetRequest: (input: {
    phone: string;
    fullName: string;
    lgaId: string;
    wardName: string;
    puCode: string;
    recoveryKey?: string;
  }) => Promise<{ requestId: string; recoveryKeyMatched: boolean; maskedPhone: string }>;
  onCompleteApprovedPasswordReset: (input: {
    phone: string;
    resetPin: string;
    fullName?: string;
    newPassword: string;
    confirmPassword: string;
  }) => Promise<UserAccount>;
  onSyncPendingOfflineRegistration: (
    reg: PendingOfflineRegistration,
    password?: string
  ) => Promise<void>;
  onDiscardPendingOfflineRegistration: (regId: string) => Promise<void>;
  onBootstrapSubmit: (displayName: string, phone: string) => Promise<void>;
  onRegisterPending: (
    displayName: string,
    phone: string,
    location?: RegistrationLocationSelection | null
  ) => Promise<void>;
  onSignOut: () => Promise<void>;
  onRecheckProfile: () => Promise<void>;
}

export function AuthGate({
  firebaseUser,
  account,
  needsBootstrap,
  needsRegistration,
  loading,
  authError,
  connectionStatus,
  isOnline,
  locationCatalog,
  refreshingLocations,
  onRefreshLocations,
  pendingOfflineRegistrations,
  hasEphemeralOfflinePassword,
  onPhoneSignIn,
  onPhoneRegister,
  onGoogleSignIn,
  onSubmitPasswordResetRequest,
  onCompleteApprovedPasswordReset,
  onSyncPendingOfflineRegistration,
  onDiscardPendingOfflineRegistration,
  onBootstrapSubmit,
  onRegisterPending,
  onSignOut,
  onRecheckProfile,
}: AuthGateProps) {
  const [welcomeMode, setWelcomeMode] = useState<WelcomeMode>('signin');
  const [forgotSubMode, setForgotSubMode] = useState<ForgotSubMode>('request');

  // Sign-in form state
  const [signInPhone, setSignInPhone] = useState('');
  const [signInPassword, setSignInPassword] = useState('');
  const [showSignInPassword, setShowSignInPassword] = useState(false);

  // Registration form state
  const [regFullName, setRegFullName] = useState('');
  const [regPhone, setRegPhone] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regConfirmPassword, setRegConfirmPassword] = useState('');
  const [showRegPassword, setShowRegPassword] = useState(false);
  const [selectedLgaId, setSelectedLgaId] = useState('');
  const [selectedWardId, setSelectedWardId] = useState('');
  const [selectedPuId, setSelectedPuId] = useState('');

  // Forgot password state
  const [forgotPhone, setForgotPhone] = useState('');
  const [forgotName, setForgotName] = useState('');
  const [forgotLgaId, setForgotLgaId] = useState('');
  const [forgotWardName, setForgotWardName] = useState('');
  const [forgotPuCode, setForgotPuCode] = useState('');
  const [forgotRecoveryKey, setForgotRecoveryKey] = useState('');
  const [resetPinInput, setResetPinInput] = useState('');
  const [resetNewPassword, setResetNewPassword] = useState('');
  const [resetConfirmPassword, setResetConfirmPassword] = useState('');
  const [showResetPassword, setShowResetPassword] = useState(false);

  // Google pending / bootstrap state
  const [displayName, setDisplayName] = useState(firebaseUser?.displayName || '');
  const [phone, setPhone] = useState('');

  // Offline registration manual password sync prompt state
  const [offlineSyncPasswords, setOfflineSyncPasswords] = useState<Record<string, string>>({});
  const [syncingRegId, setSyncingRegId] = useState<string | null>(null);

  // One-time Recovery Key display state (survives auth state switch to Pending card)
  const [issuedRecoveryKey, setIssuedRecoveryKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [localInfo, setLocalInfo] = useState<string | null>(null);

  useEffect(() => {
    if (firebaseUser?.displayName && !displayName) {
      setDisplayName(firebaseUser.displayName);
    }
  }, [firebaseUser?.displayName, displayName]);

  // Dynamic LGA -> Ward -> Polling Unit options strictly from synchronized catalog
  const selectedLgaObj = useMemo(
    () => locationCatalog.find((l) => l.lgaId === selectedLgaId) || null,
    [locationCatalog, selectedLgaId]
  );

  const availableWards = useMemo(() => {
    if (!selectedLgaObj) return [];
    return selectedLgaObj.wards;
  }, [selectedLgaObj]);

  const availablePollingUnits = useMemo(() => {
    if (!selectedLgaObj || !selectedWardId) return [];
    return selectedLgaObj.pollingUnits.filter((pu) => pu.wardId === selectedWardId);
  }, [selectedLgaObj, selectedWardId]);

  const forgotLgaObj = useMemo(
    () => locationCatalog.find((l) => l.lgaId === forgotLgaId) || null,
    [locationCatalog, forgotLgaId]
  );

  const forgotAvailableWards = useMemo(
    () => (forgotLgaObj ? forgotLgaObj.wards : []),
    [forgotLgaObj]
  );

  const forgotAvailablePus = useMemo(() => {
    if (!forgotLgaObj || !forgotWardName) return [];
    return forgotLgaObj.pollingUnits.filter((pu) => pu.wardName === forgotWardName);
  }, [forgotLgaObj, forgotWardName]);

  const combinedError = localError || authError;

  const buildSelectedLocation = (): RegistrationLocationSelection | null => {
    if (!selectedLgaObj || !selectedWardId || !selectedPuId) return null;
    const ward = selectedLgaObj.wards.find((w) => w.id === selectedWardId);
    const pu = selectedLgaObj.pollingUnits.find((p) => p.id === selectedPuId);
    if (!ward || !pu) return null;
    return {
      lgaId: selectedLgaObj.lgaId,
      lgaName: selectedLgaObj.lgaName,
      wardId: ward.id,
      wardName: ward.name,
      puId: pu.id,
      puCode: pu.puCode,
      puName: pu.name,
    };
  };

  const handleCopyRecoveryKey = async (key: string) => {
    try {
      await navigator.clipboard.writeText(key);
      setCopiedKey(true);
      window.setTimeout(() => setCopiedKey(false), 2500);
    } catch {
      // Clipboard API restricted
    }
  };

  const handlePhoneSignInSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    setLocalInfo(null);
    setSubmitting(true);
    try {
      await onPhoneSignIn(signInPhone, signInPassword);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Unable to sign in.');
    } finally {
      setSubmitting(false);
    }
  };

  const handlePhoneRegisterSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    setLocalInfo(null);

    const loc = buildSelectedLocation();
    if (!loc) {
      setLocalError(
        'Select your Local Government Area, Ward, and Polling Unit from the synchronized directory.'
      );
      return;
    }

    setSubmitting(true);
    try {
      const res = await onPhoneRegister({
        fullName: regFullName,
        phone: regPhone,
        password: regPassword,
        confirmPassword: regConfirmPassword,
        location: loc,
      });
      setIssuedRecoveryKey(res.recoveryKey);
      setCopiedKey(false);
      setRegPassword('');
      setRegConfirmPassword('');
      if (res.queuedOffline) {
        setLocalInfo(
          'Registration saved offline on this device. Connect to the internet to submit it for administrator verification and activation.'
        );
        setWelcomeMode('signin');
      }
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Registration failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleForgotSubmitRequest = async (e: FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    setLocalInfo(null);
    setSubmitting(true);
    try {
      const result = await onSubmitPasswordResetRequest({
        phone: forgotPhone,
        fullName: forgotName,
        lgaId: forgotLgaId,
        wardName: forgotWardName,
        puCode: forgotPuCode,
        recoveryKey: forgotRecoveryKey,
      });
      setLocalInfo(
        result.recoveryKeyMatched
          ? `Recovery request submitted for ${result.maskedPhone} with verified Recovery Key. Obtain your one-time Reset PIN from your administrator, then open "Enter Reset PIN".`
          : `Recovery request submitted for ${result.maskedPhone}. An authorized administrator will verify your identity and provide a one-time Reset PIN.`
      );
      setForgotSubMode('complete');
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Unable to submit recovery request.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCompleteResetSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    setLocalInfo(null);
    setSubmitting(true);
    try {
      await onCompleteApprovedPasswordReset({
        phone: forgotPhone,
        resetPin: resetPinInput,
        fullName: forgotName,
        newPassword: resetNewPassword,
        confirmPassword: resetConfirmPassword,
      });
      setResetPinInput('');
      setResetNewPassword('');
      setResetConfirmPassword('');
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Unable to complete password reset.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleManualSyncOfflineReg = async (reg: PendingOfflineRegistration) => {
    setLocalError(null);
    setLocalInfo(null);
    setSyncingRegId(reg.id);
    try {
      const pw = offlineSyncPasswords[reg.id];
      await onSyncPendingOfflineRegistration(reg, pw);
      setOfflineSyncPasswords((prev) => {
        const next = { ...prev };
        delete next[reg.id];
        return next;
      });
      setLocalInfo(`Offline registration for ${reg.displayName} synchronized successfully.`);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Failed to sync offline registration.');
    } finally {
      setSyncingRegId(null);
    }
  };

  const handleBootstrap = async (e: FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    setSubmitting(true);
    try {
      await onBootstrapSubmit(displayName, phone);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Failed to initialize Full Control Admin.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleRegisterPending = async (e: FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    setSubmitting(true);
    try {
      await onRegisterPending(displayName, phone, buildSelectedLocation());
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Failed to register operator profile.');
    } finally {
      setSubmitting(false);
    }
  };

  const renderLocationSelectors = (optional = false) => {
    const emptyCatalog = locationCatalog.length === 0;
    return (
      <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/80 p-3.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5 text-[#0b3b24]" aria-hidden="true" />
            <span className="text-xs font-semibold text-slate-800">
              Official Constituency Location {optional ? '(Optional)' : '*'}
            </span>
          </div>
          <button
            type="button"
            disabled={refreshingLocations || !isOnline}
            onClick={() => void onRefreshLocations()}
            className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
          >
            <RefreshCw
              className={`h-3 w-3 ${refreshingLocations ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            <span>Sync</span>
          </button>
        </div>

        {emptyCatalog ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950">
            Synchronized LGA, Ward, and Polling Unit records are not cached on this device yet. Connect
            to the internet and tap <span className="font-semibold">Sync</span> once an administrator
            has published the official directory.
          </div>
        ) : (
          <>
            <div>
              <label htmlFor="loc-lga" className="block text-xs font-medium text-slate-700">
                Local Government Area {!optional ? '*' : ''}
              </label>
              <select
                id="loc-lga"
                required={!optional}
                value={selectedLgaId}
                onChange={(e) => {
                  setSelectedLgaId(e.target.value);
                  setSelectedWardId('');
                  setSelectedPuId('');
                }}
                className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-[#0b3b24] focus:outline-none"
              >
                <option value="">Select Local Government Area...</option>
                {locationCatalog.map((lga) => (
                  <option key={lga.lgaId} value={lga.lgaId}>
                    {lga.lgaName} ({lga.wardCount} Wards · {lga.puCount} PUs)
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="loc-ward" className="block text-xs font-medium text-slate-700">
                Ward {!optional ? '*' : ''}
              </label>
              <select
                id="loc-ward"
                required={!optional && Boolean(selectedLgaId)}
                disabled={!selectedLgaId}
                value={selectedWardId}
                onChange={(e) => {
                  setSelectedWardId(e.target.value);
                  setSelectedPuId('');
                }}
                className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-[#0b3b24] focus:outline-none disabled:bg-slate-100 disabled:text-slate-500"
              >
                <option value="">
                  {!selectedLgaId ? 'Select LGA first...' : `Select Ward (${availableWards.length})...`}
                </option>
                {availableWards.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} ({w.wardCode})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="loc-pu" className="block text-xs font-medium text-slate-700">
                Polling Unit {!optional ? '*' : ''}
              </label>
              <select
                id="loc-pu"
                required={!optional && Boolean(selectedWardId)}
                disabled={!selectedWardId}
                value={selectedPuId}
                onChange={(e) => setSelectedPuId(e.target.value)}
                className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-[#0b3b24] focus:outline-none disabled:bg-slate-100 disabled:text-slate-500"
              >
                <option value="">
                  {!selectedWardId
                    ? 'Select Ward first...'
                    : `Select Polling Unit (${availablePollingUnits.length})...`}
                </option>
                {availablePollingUnits.map((pu) => (
                  <option key={pu.id} value={pu.id}>
                    {pu.puCode} · {pu.name}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-[#0b3b24] text-white">
            <Shield className="h-6 w-6" aria-hidden="true" />
          </div>
          <h1 className="text-lg font-semibold text-slate-900">
            Verifying Situation Room Session
          </h1>
          <p className="mt-1.5 text-sm text-slate-600">
            Checking authentication credentials, role permissions, and session availability.
          </p>
        </div>
      </div>
    );
  }

  // 1. Unauthenticated Welcome / Dual Auth Screen
  if (!firebaseUser) {
    return (
      <div className="flex min-h-screen flex-col justify-between bg-slate-50">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#0b3b24] text-white">
                <Shield className="h-5 w-5" aria-hidden="true" />
              </div>
              <span className="font-display text-base font-bold tracking-tight text-slate-900 sm:text-lg">
                FDMIS Command Portal
              </span>
            </div>
            <div className="flex items-center gap-2">
              {!isOnline ? (
                <span className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-900">
                  <WifiOff className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Offline</span>
                </span>
              ) : null}
              <span className="hidden text-xs font-medium text-slate-600 sm:inline">
                2027 Election Cycle · Katsina State
              </span>
            </div>
          </div>
        </header>

        <main className="mx-auto flex w-full max-w-6xl flex-1 items-center px-4 py-8 sm:px-6">
          <div className="grid w-full grid-cols-1 gap-8 lg:grid-cols-12 lg:items-start">
            {/* Left Command Context Column */}
            <div className="flex flex-col justify-between rounded-xl border border-slate-200 bg-[#0b3b24] p-7 text-white lg:col-span-5">
              <div>
                <p className="text-xs font-medium tracking-wide text-emerald-200">
                  Funtua–Dandume Federal Constituency
                </p>
                <h1 className="mt-2 font-display text-2xl font-bold leading-tight text-balance sm:text-3xl">
                  Funtua–Dandume Mandate Intelligence System
                </h1>
                <p className="mt-3 text-sm leading-relaxed text-emerald-50/90">
                  Authorized election-day coordination, polling-unit monitoring, field agent
                  verification, incident escalation, and audited result management across Funtua and
                  Dandume LGAs.
                </p>

                <div className="mt-6 space-y-2.5 rounded-lg border border-white/15 bg-white/5 p-4 text-xs leading-relaxed text-emerald-50/90">
                  <p className="font-semibold text-white">Dual Authentication &amp; Role Security</p>
                  <p>
                    Existing verified operators sign in with Google or Phone &amp; Password. New
                    accounts start with zero permissions until approved and assigned by an
                    authorized administrator.
                  </p>
                </div>
              </div>

              <div className="mt-8 grid grid-cols-1 gap-4 border-t border-white/15 pt-6 sm:grid-cols-2 lg:grid-cols-1">
                <div>
                  <p className="text-xs font-medium text-emerald-200">Funtua LGA (Code 20-14)</p>
                  <p className="mt-1 font-mono text-base font-semibold tabular-nums">
                    11 Wards · 298 Polling Units
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-emerald-200">Dandume LGA (Code 20/07)</p>
                  <p className="mt-1 font-mono text-base font-semibold tabular-nums">
                    11 Wards · 177 Polling Units
                  </p>
                </div>
              </div>
            </div>

            {/* Right Dual Authentication Column */}
            <div className="rounded-xl border border-slate-200 bg-white p-6 sm:p-7 lg:col-span-7">
              {/* Tab Switcher */}
              <div className="grid grid-cols-2 gap-1.5 rounded-lg bg-slate-100 p-1">
                <button
                  type="button"
                  onClick={() => {
                    setWelcomeMode('signin');
                    setLocalError(null);
                    setLocalInfo(null);
                  }}
                  className={`inline-flex min-h-[44px] items-center justify-center gap-2 rounded-md px-3 text-sm font-semibold transition-colors ${
                    welcomeMode === 'signin' || welcomeMode === 'forgot'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Lock className="h-4 w-4" aria-hidden="true" />
                  <span>Sign In</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setWelcomeMode('signup');
                    setLocalError(null);
                    setLocalInfo(null);
                  }}
                  className={`inline-flex min-h-[44px] items-center justify-center gap-2 rounded-md px-3 text-sm font-semibold transition-colors ${
                    welcomeMode === 'signup'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <UserPlus className="h-4 w-4" aria-hidden="true" />
                  <span>Create New Account</span>
                </button>
              </div>

              {connectionStatus === 'offline' || !isOnline ? (
                <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
                  <span>
                    Device is currently offline. Previously authenticated operators remain active
                    offline; new registrations entered offline are securely queued locally and
                    require server verification when connectivity returns.
                  </span>
                </div>
              ) : null}

              {issuedRecoveryKey ? (
                <div className="mt-4 rounded-lg border border-emerald-300 bg-emerald-50 p-4 text-xs text-emerald-950">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-emerald-900">
                        Save Your Personal Recovery Key (Shown Once)
                      </p>
                      <p className="mt-1 text-emerald-800">
                        Write down or copy this key for faster self-verified password recovery if you
                        ever forget your password.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIssuedRecoveryKey(null)}
                      className="rounded border border-emerald-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-emerald-900 hover:bg-emerald-100"
                    >
                      Dismiss
                    </button>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-2 rounded-md border border-emerald-200 bg-white px-3 py-2">
                    <span className="font-mono text-sm font-bold tracking-wider text-slate-900">
                      {issuedRecoveryKey}
                    </span>
                    <button
                      type="button"
                      onClick={() => void handleCopyRecoveryKey(issuedRecoveryKey)}
                      className="inline-flex items-center gap-1 rounded border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>{copiedKey ? 'Copied' : 'Copy'}</span>
                    </button>
                  </div>
                </div>
              ) : null}

              {localInfo ? (
                <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-950">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" aria-hidden="true" />
                  <span>{localInfo}</span>
                </div>
              ) : null}

              {combinedError ? (
                <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-900">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-700" aria-hidden="true" />
                  <span>{combinedError}</span>
                </div>
              ) : null}

              {/* Queued Offline Registrations awaiting Server Sync */}
              {pendingOfflineRegistrations.length > 0 ? (
                <div className="mt-4 space-y-2.5 rounded-lg border border-amber-300 bg-amber-50/70 p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-amber-950">
                      Queued Offline Account Registrations ({pendingOfflineRegistrations.length})
                    </p>
                    <span className="text-[11px] font-medium text-amber-800">
                      Unverified until server sync
                    </span>
                  </div>
                  {pendingOfflineRegistrations.map((reg) => {
                    const hasCachedPw = hasEphemeralOfflinePassword(reg.id);
                    const isBusy = syncingRegId === reg.id;
                    return (
                      <div
                        key={reg.id}
                        className="rounded-lg border border-amber-200 bg-white p-3 text-xs"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <p className="font-semibold text-slate-900">
                              {reg.displayName} · {reg.phoneE164}
                            </p>
                            <p className="mt-0.5 text-slate-600">
                              {reg.requestedLgaName} · {reg.requestedWardName} · {reg.requestedPollingUnitCode}
                            </p>
                            {reg.errorMessage ? (
                              <p className="mt-1 text-red-700">{reg.errorMessage}</p>
                            ) : null}
                          </div>
                          <button
                            type="button"
                            onClick={() => void onDiscardPendingOfflineRegistration(reg.id)}
                            aria-label="Discard queued registration"
                            className="inline-flex min-h-[32px] items-center gap-1 rounded border border-slate-200 px-2 text-[11px] text-slate-600 hover:bg-slate-50"
                          >
                            <Trash2 className="h-3 w-3" aria-hidden="true" />
                            <span>Remove</span>
                          </button>
                        </div>

                        {isOnline ? (
                          <div className="mt-2.5 flex flex-col gap-2 sm:flex-row sm:items-center">
                            {!hasCachedPw ? (
                              <input
                                type="password"
                                value={offlineSyncPasswords[reg.id] || ''}
                                onChange={(e) =>
                                  setOfflineSyncPasswords((prev) => ({
                                    ...prev,
                                    [reg.id]: e.target.value,
                                  }))
                                }
                                placeholder="Confirm password to finalize upload"
                                className="min-h-[38px] flex-1 rounded border border-slate-300 px-2.5 text-xs"
                              />
                            ) : null}
                            <button
                              type="button"
                              disabled={isBusy || (!hasCachedPw && !offlineSyncPasswords[reg.id])}
                              onClick={() => void handleManualSyncOfflineReg(reg)}
                              className="inline-flex min-h-[38px] items-center justify-center gap-1.5 rounded bg-[#0b3b24] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#115233] disabled:opacity-50"
                            >
                              <RefreshCw
                                className={`h-3.5 w-3.5 ${isBusy ? 'animate-spin' : ''}`}
                                aria-hidden="true"
                              />
                              <span>{isBusy ? 'Uploading...' : 'Sync Registration'}</span>
                            </button>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : null}

              {/* MODE A: SIGN IN */}
              {welcomeMode === 'signin' ? (
                <div className="mt-5">
                  <h2 className="font-display text-lg font-semibold text-slate-900">
                    Sign In to FDMIS
                  </h2>
                  <p className="mt-1 text-xs text-slate-600">
                    Sign in using your registered Phone Number and Password, or use Google for
                    verified Google-linked operators and administrators.
                  </p>

                  <form onSubmit={handlePhoneSignInSubmit} className="mt-4 space-y-4">
                    <div>
                      <label htmlFor="signin-phone" className="block text-xs font-medium text-slate-700">
                        Phone Number *
                      </label>
                      <input
                        id="signin-phone"
                        type="tel"
                        required
                        autoComplete="tel"
                        value={signInPhone}
                        onChange={(e) => setSignInPhone(e.target.value)}
                        placeholder="e.g. 0803 123 4567 or +2348031234567"
                        className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-[#0b3b24] focus:outline-none"
                      />
                    </div>

                    <div>
                      <div className="flex items-center justify-between">
                        <label
                          htmlFor="signin-password"
                          className="block text-xs font-medium text-slate-700"
                        >
                          Password *
                        </label>
                        <button
                          type="button"
                          onClick={() => {
                            setWelcomeMode('forgot');
                            setForgotPhone(signInPhone);
                            setLocalError(null);
                            setLocalInfo(null);
                          }}
                          className="text-xs font-semibold text-[#0b3b24] hover:underline"
                        >
                          Forgot Password?
                        </button>
                      </div>
                      <div className="relative mt-1">
                        <input
                          id="signin-password"
                          type={showSignInPassword ? 'text' : 'password'}
                          required
                          autoComplete="current-password"
                          value={signInPassword}
                          onChange={(e) => setSignInPassword(e.target.value)}
                          placeholder="Enter your password"
                          className="min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 pr-11 text-sm text-slate-900 focus:border-[#0b3b24] focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => setShowSignInPassword((v) => !v)}
                          aria-label={showSignInPassword ? 'Hide password' : 'Show password'}
                          className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-slate-500 hover:text-slate-800"
                        >
                          {showSignInPassword ? (
                            <EyeOff className="h-4 w-4" aria-hidden="true" />
                          ) : (
                            <Eye className="h-4 w-4" aria-hidden="true" />
                          )}
                        </button>
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={submitting}
                      className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-lg bg-[#0b3b24] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#115233] disabled:opacity-60"
                    >
                      <Lock className="h-4 w-4" aria-hidden="true" />
                      <span>{submitting ? 'Signing In...' : 'Sign In'}</span>
                    </button>
                  </form>

                  <div className="my-5 flex items-center gap-3">
                    <div className="h-px flex-1 bg-slate-200" />
                    <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
                      Verified Google Operators
                    </span>
                    <div className="h-px flex-1 bg-slate-200" />
                  </div>

                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => void onGoogleSignIn()}
                    className="inline-flex min-h-[48px] w-full items-center justify-center gap-2.5 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 transition-colors hover:bg-slate-50 disabled:opacity-60"
                  >
                    <ShieldCheck className="h-4 w-4 text-[#0b3b24]" aria-hidden="true" />
                    <span>Continue with Google</span>
                  </button>

                  <p className="mt-4 text-[11px] leading-relaxed text-slate-500">
                    Google sign-in preserves access for existing verified administrators and
                    operators. Signing in with Google never grants administrative privileges
                    automatically to new accounts.
                  </p>
                </div>
              ) : null}

              {/* MODE B: CREATE NEW ACCOUNT */}
              {welcomeMode === 'signup' ? (
                <div className="mt-5">
                  <h2 className="font-display text-lg font-semibold text-slate-900">
                    Create New Operator Account
                  </h2>
                  <p className="mt-1 text-xs text-slate-600">
                    All newly registered accounts remain <span className="font-semibold">Unverified / Pending Approval</span> until reviewed and assigned by an authorized administrator.
                  </p>

                  <form onSubmit={handlePhoneRegisterSubmit} className="mt-4 space-y-3.5">
                    <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                      <div>
                        <label htmlFor="reg-fullname" className="block text-xs font-medium text-slate-700">
                          Full Name *
                        </label>
                        <input
                          id="reg-fullname"
                          type="text"
                          required
                          minLength={2}
                          maxLength={110}
                          autoComplete="name"
                          value={regFullName}
                          onChange={(e) => setRegFullName(e.target.value)}
                          placeholder="Enter official full name"
                          className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-[#0b3b24] focus:outline-none"
                        />
                      </div>

                      <div>
                        <label htmlFor="reg-phone-num" className="block text-xs font-medium text-slate-700">
                          Phone Number *
                        </label>
                        <input
                          id="reg-phone-num"
                          type="tel"
                          required
                          autoComplete="tel"
                          value={regPhone}
                          onChange={(e) => setRegPhone(e.target.value)}
                          placeholder="e.g. 0803 123 4567"
                          className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-[#0b3b24] focus:outline-none"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                      <div>
                        <label htmlFor="reg-pass" className="block text-xs font-medium text-slate-700">
                          Create Password *
                        </label>
                        <div className="relative mt-1">
                          <input
                            id="reg-pass"
                            type={showRegPassword ? 'text' : 'password'}
                            required
                            minLength={8}
                            maxLength={128}
                            autoComplete="new-password"
                            value={regPassword}
                            onChange={(e) => setRegPassword(e.target.value)}
                            placeholder="Min 8 chars, letters & numbers"
                            className="min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 pr-11 text-sm text-slate-900 focus:border-[#0b3b24] focus:outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => setShowRegPassword((v) => !v)}
                            aria-label={showRegPassword ? 'Hide password' : 'Show password'}
                            className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-slate-500 hover:text-slate-800"
                          >
                            {showRegPassword ? (
                              <EyeOff className="h-4 w-4" aria-hidden="true" />
                            ) : (
                              <Eye className="h-4 w-4" aria-hidden="true" />
                            )}
                          </button>
                        </div>
                      </div>

                      <div>
                        <label htmlFor="reg-conf-pass" className="block text-xs font-medium text-slate-700">
                          Confirm Password *
                        </label>
                        <input
                          id="reg-conf-pass"
                          type={showRegPassword ? 'text' : 'password'}
                          required
                          minLength={8}
                          maxLength={128}
                          autoComplete="new-password"
                          value={regConfirmPassword}
                          onChange={(e) => setRegConfirmPassword(e.target.value)}
                          placeholder="Re-enter password"
                          className="mt-1 min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-[#0b3b24] focus:outline-none"
                        />
                      </div>
                    </div>

                    {renderLocationSelectors(false)}

                    <button
                      type="submit"
                      disabled={submitting || locationCatalog.length === 0}
                      className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-lg bg-[#0b3b24] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#115233] disabled:opacity-60"
                    >
                      <UserPlus className="h-4 w-4" aria-hidden="true" />
                      <span>
                        {submitting
                          ? 'Creating Account...'
                          : isOnline
                            ? 'Create Operator Account'
                            : 'Save Registration Offline'}
                      </span>
                    </button>
                  </form>
                </div>
              ) : null}

              {/* MODE C: FORGOT PASSWORD RECOVERY */}
              {welcomeMode === 'forgot' ? (
                <div className="mt-5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <KeyRound className="h-4 w-4 text-[#0b3b24]" aria-hidden="true" />
                      <h2 className="font-display text-lg font-semibold text-slate-900">
                        Account Password Recovery
                      </h2>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setWelcomeMode('signin');
                        setLocalError(null);
                      }}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 hover:text-slate-900"
                    >
                      <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Back to Sign In</span>
                    </button>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1">
                    <button
                      type="button"
                      onClick={() => {
                        setForgotSubMode('request');
                        setLocalError(null);
                      }}
                      className={`min-h-[38px] rounded-md px-2 text-xs font-semibold ${
                        forgotSubMode === 'request'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600'
                      }`}
                    >
                      1. Request Recovery
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setForgotSubMode('complete');
                        setLocalError(null);
                      }}
                      className={`min-h-[38px] rounded-md px-2 text-xs font-semibold ${
                        forgotSubMode === 'complete'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600'
                      }`}
                    >
                      2. Enter Reset PIN
                    </button>
                  </div>

                  {forgotSubMode === 'request' ? (
                    <form onSubmit={handleForgotSubmitRequest} className="mt-4 space-y-3.5">
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                          <label htmlFor="fg-phone" className="block text-xs font-medium text-slate-700">
                            Registered Phone Number *
                          </label>
                          <input
                            id="fg-phone"
                            type="tel"
                            required
                            value={forgotPhone}
                            onChange={(e) => setForgotPhone(e.target.value)}
                            placeholder="0803 123 4567"
                            className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-300 px-3 text-sm"
                          />
                        </div>
                        <div>
                          <label htmlFor="fg-name" className="block text-xs font-medium text-slate-700">
                            Registered Full Name *
                          </label>
                          <input
                            id="fg-name"
                            type="text"
                            required
                            minLength={2}
                            value={forgotName}
                            onChange={(e) => setForgotName(e.target.value)}
                            placeholder="Your full name"
                            className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-300 px-3 text-sm"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                        <div>
                          <label htmlFor="fg-lga" className="block text-xs font-medium text-slate-700">
                            Assigned LGA
                          </label>
                          <select
                            id="fg-lga"
                            value={forgotLgaId}
                            onChange={(e) => {
                              setForgotLgaId(e.target.value);
                              setForgotWardName('');
                              setForgotPuCode('');
                            }}
                            className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-2.5 text-xs"
                          >
                            <option value="">Select LGA...</option>
                            {locationCatalog.map((l) => (
                              <option key={l.lgaId} value={l.lgaId}>
                                {l.lgaName}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label htmlFor="fg-ward" className="block text-xs font-medium text-slate-700">
                            Ward
                          </label>
                          <select
                            id="fg-ward"
                            disabled={!forgotLgaId}
                            value={forgotWardName}
                            onChange={(e) => {
                              setForgotWardName(e.target.value);
                              setForgotPuCode('');
                            }}
                            className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-2.5 text-xs disabled:bg-slate-100"
                          >
                            <option value="">Select Ward...</option>
                            {forgotAvailableWards.map((w) => (
                              <option key={w.id} value={w.name}>
                                {w.name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label htmlFor="fg-pu" className="block text-xs font-medium text-slate-700">
                            Polling Unit
                          </label>
                          <select
                            id="fg-pu"
                            disabled={!forgotWardName}
                            value={forgotPuCode}
                            onChange={(e) => setForgotPuCode(e.target.value)}
                            className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-300 bg-white px-2.5 text-xs disabled:bg-slate-100"
                          >
                            <option value="">Select PU...</option>
                            {forgotAvailablePus.map((p) => (
                              <option key={p.id} value={p.puCode}>
                                {p.puCode} · {p.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div>
                        <label htmlFor="fg-rkey" className="block text-xs font-medium text-slate-700">
                          Personal Recovery Key (Optional — speeds up verification)
                        </label>
                        <input
                          id="fg-rkey"
                          type="text"
                          value={forgotRecoveryKey}
                          onChange={(e) => setForgotRecoveryKey(e.target.value)}
                          placeholder="FDM-XXXX-XXXX-XXXX"
                          className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-300 px-3 font-mono text-sm uppercase"
                        />
                      </div>

                      <button
                        type="submit"
                        disabled={submitting || !isOnline}
                        className="inline-flex min-h-[46px] w-full items-center justify-center gap-2 rounded-lg bg-[#0b3b24] px-4 py-2 text-sm font-semibold text-white hover:bg-[#115233] disabled:opacity-60"
                      >
                        <span>
                          {submitting ? 'Submitting Request...' : 'Submit Recovery Request'}
                        </span>
                      </button>
                    </form>
                  ) : (
                    <form onSubmit={handleCompleteResetSubmit} className="mt-4 space-y-3.5">
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                          <label htmlFor="rst-phone" className="block text-xs font-medium text-slate-700">
                            Registered Phone Number *
                          </label>
                          <input
                            id="rst-phone"
                            type="tel"
                            required
                            value={forgotPhone}
                            onChange={(e) => setForgotPhone(e.target.value)}
                            placeholder="0803 123 4567"
                            className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-300 px-3 text-sm"
                          />
                        </div>
                        <div>
                          <label htmlFor="rst-pin" className="block text-xs font-medium text-slate-700">
                            Admin-Issued Reset PIN *
                          </label>
                          <input
                            id="rst-pin"
                            type="text"
                            required
                            value={resetPinInput}
                            onChange={(e) => setResetPinInput(e.target.value)}
                            placeholder="RST-XXXXXX"
                            className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-300 px-3 font-mono text-sm uppercase"
                          />
                        </div>
                      </div>

                      <div>
                        <label htmlFor="rst-name" className="block text-xs font-medium text-slate-700">
                          Full Operational Name *
                        </label>
                        <input
                          id="rst-name"
                          type="text"
                          required
                          minLength={2}
                          value={forgotName}
                          onChange={(e) => setForgotName(e.target.value)}
                          placeholder="Confirm your full name"
                          className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-300 px-3 text-sm"
                        />
                      </div>

                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                          <label htmlFor="rst-pass" className="block text-xs font-medium text-slate-700">
                            New Password *
                          </label>
                          <div className="relative mt-1">
                            <input
                              id="rst-pass"
                              type={showResetPassword ? 'text' : 'password'}
                              required
                              minLength={8}
                              value={resetNewPassword}
                              onChange={(e) => setResetNewPassword(e.target.value)}
                              placeholder="Min 8 chars, letters & numbers"
                              className="min-h-[42px] w-full rounded-lg border border-slate-300 px-3 pr-10 text-sm"
                            />
                            <button
                              type="button"
                              onClick={() => setShowResetPassword((v) => !v)}
                              aria-label={showResetPassword ? 'Hide password' : 'Show password'}
                              className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-slate-500"
                            >
                              {showResetPassword ? (
                                <EyeOff className="h-4 w-4" />
                              ) : (
                                <Eye className="h-4 w-4" />
                              )}
                            </button>
                          </div>
                        </div>
                        <div>
                          <label htmlFor="rst-conf" className="block text-xs font-medium text-slate-700">
                            Confirm New Password *
                          </label>
                          <input
                            id="rst-conf"
                            type={showResetPassword ? 'text' : 'password'}
                            required
                            minLength={8}
                            value={resetConfirmPassword}
                            onChange={(e) => setResetConfirmPassword(e.target.value)}
                            placeholder="Re-enter password"
                            className="mt-1 min-h-[42px] w-full rounded-lg border border-slate-300 px-3 text-sm"
                          />
                        </div>
                      </div>

                      <button
                        type="submit"
                        disabled={submitting || !isOnline}
                        className="inline-flex min-h-[46px] w-full items-center justify-center gap-2 rounded-lg bg-[#0b3b24] px-4 py-2 text-sm font-semibold text-white hover:bg-[#115233] disabled:opacity-60"
                      >
                        <span>
                          {submitting ? 'Completing Reset...' : 'Set New Password'}
                        </span>
                      </button>
                    </form>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        </main>

        <footer className="border-t border-slate-200 bg-white px-4 py-4 text-center text-xs text-slate-500">
          Funtua–Dandume Mandate Intelligence System · Protected Constituency Operations
        </footer>
      </div>
    );
  }

  // 2. Initial Full Control Admin Bootstrap Setup (Verified Google Account Only)
  if (needsBootstrap) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
        <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-7">
          <div className="flex items-center justify-between gap-4 border-b border-slate-100 pb-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#0b3b24] text-white">
                <ShieldCheck className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <h1 className="font-display text-lg font-bold text-slate-900">
                  Initial Full Control Admin Setup
                </h1>
                <p className="text-xs text-slate-600">
                  One-time constituency command initialization
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void onSignOut()}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Sign Out</span>
            </button>
          </div>

          <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50/70 p-3.5 text-xs leading-relaxed text-emerald-950">
            No Full Control Admin has been initialized yet. Completing this form atomically binds
            <span className="font-semibold"> {firebaseUser.email} </span>
            as the constituency Full Control Admin and locks the bootstrap document against future
            takeover.
          </div>

          {combinedError ? (
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-700" aria-hidden="true" />
              <span>{combinedError}</span>
            </div>
          ) : null}

          <form onSubmit={handleBootstrap} className="mt-5 space-y-4">
            <div>
              <label htmlFor="bootstrap-email" className="block text-xs font-medium text-slate-700">
                Verified Google Account
              </label>
              <input
                id="bootstrap-email"
                type="text"
                disabled
                value={firebaseUser.email || ''}
                className="mt-1.5 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-600"
              />
            </div>

            <div>
              <label htmlFor="bootstrap-name" className="block text-xs font-medium text-slate-700">
                Full Operational Name *
              </label>
              <input
                id="bootstrap-name"
                type="text"
                required
                minLength={2}
                maxLength={110}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Enter administrator full name"
                className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-[#0b3b24] focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="bootstrap-phone" className="block text-xs font-medium text-slate-700">
                Operational Contact Phone (Optional)
              </label>
              <input
                id="bootstrap-phone"
                type="tel"
                maxLength={25}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="e.g. +234 800 000 0000"
                className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-[#0b3b24] focus:outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-lg bg-[#0b3b24] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#115233] disabled:opacity-60"
            >
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              <span>
                {submitting ? 'Initializing Command Account...' : 'Initialize Full Control Admin'}
              </span>
            </button>
          </form>
        </div>
      </div>
    );
  }

  // 3. New Google User Profile Registration (Bootstrap already exists -> registers as PENDING_APPROVAL)
  if (needsRegistration) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
        <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-7">
          <div className="flex items-center justify-between gap-4 border-b border-slate-100 pb-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-900 text-white">
                <UserCheck className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <h1 className="font-display text-lg font-bold text-slate-900">
                  Register Field or Admin Profile
                </h1>
                <p className="text-xs text-slate-600">
                  Account starts with zero privileges pending administrator assignment
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void onSignOut()}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Sign Out</span>
            </button>
          </div>

          {combinedError ? (
            <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-700" aria-hidden="true" />
              <span>{combinedError}</span>
            </div>
          ) : null}

          <form onSubmit={handleGoogleRegisterPending} className="mt-5 space-y-4">
            <div>
              <label htmlFor="reg-email" className="block text-xs font-medium text-slate-700">
                Authenticated Account
              </label>
              <input
                id="reg-email"
                type="text"
                disabled
                value={firebaseUser.email || ''}
                className="mt-1.5 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-600"
              />
            </div>

            <div>
              <label htmlFor="reg-name" className="block text-xs font-medium text-slate-700">
                Full Name *
              </label>
              <input
                id="reg-name"
                type="text"
                required
                minLength={2}
                maxLength={110}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Enter your official name"
                className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-[#0b3b24] focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="reg-phone" className="block text-xs font-medium text-slate-700">
                Contact Phone (Optional)
              </label>
              <input
                id="reg-phone"
                type="tel"
                maxLength={25}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="e.g. 0803 123 4567"
                className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-[#0b3b24] focus:outline-none"
              />
            </div>

            {locationCatalog.length > 0 ? renderLocationSelectors(true) : null}

            <button
              type="submit"
              disabled={submitting}
              className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-lg bg-[#0b3b24] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#115233] disabled:opacity-60"
            >
              <span>{submitting ? 'Submitting Registration...' : 'Submit Access Request'}</span>
            </button>
          </form>
        </div>
      </div>
    );
  }

  // 4. Suspended or Revoked Session Gate
  if (account && (account.status === AccountStatus.SUSPENDED || account.sessionRevoked)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
        <div className="w-full max-w-md rounded-xl border border-red-200 bg-white p-7">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-50 text-red-700">
              <Lock className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h1 className="font-display text-lg font-bold text-slate-900">
                Access Revoked or Suspended
              </h1>
              <p className="text-xs text-slate-600">{formatAccountIdentifier(account)}</p>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <AccountStatusBadge status={AccountStatus.SUSPENDED} />
            <RoleBadge role={account.role} />
          </div>

          <p className="mt-4 text-sm leading-relaxed text-slate-700">
            Your operational access to the Funtua–Dandume Mandate Intelligence System has been
            revoked by an authorized administrator. No submissions or queries can be performed from
            this session.
          </p>

          {account.revokedReason ? (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-900">
              <span className="font-semibold">Recorded Reason:</span> {account.revokedReason}
            </div>
          ) : null}

          <button
            type="button"
            onClick={() => void onSignOut()}
            className="mt-6 inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            <span>Sign Out</span>
          </button>
        </div>
      </div>
    );
  }

  // 5. Pending Approval / Unassigned Gate
  const primaryIdLabel =
    formatAccountIdentifier(account) || firebaseUser.email || 'Pending Operator';

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-7">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-50 text-amber-700">
            <Clock className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h1 className="font-display text-lg font-bold text-slate-900">
              Pending Administrator Approval
            </h1>
            <p className="text-xs text-slate-600">{primaryIdLabel}</p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <AccountStatusBadge status={account?.status || AccountStatus.PENDING_APPROVAL} />
          <RoleBadge role={account?.role || UserRole.PENDING} />
        </div>

        {issuedRecoveryKey ? (
          <div className="mt-4 rounded-lg border border-emerald-300 bg-emerald-50 p-4 text-xs text-emerald-950">
            <p className="font-semibold text-emerald-900">
              Save Your Personal Recovery Key (Shown Once)
            </p>
            <p className="mt-1 text-emerald-800">
              Keep this key in a safe place for faster password recovery if you forget your
              password.
            </p>
            <div className="mt-2.5 flex items-center justify-between gap-2 rounded-md border border-emerald-200 bg-white px-3 py-2">
              <span className="font-mono text-sm font-bold tracking-wider text-slate-900">
                {issuedRecoveryKey}
              </span>
              <button
                type="button"
                onClick={() => void handleCopyRecoveryKey(issuedRecoveryKey)}
                className="inline-flex items-center gap-1 rounded border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{copiedKey ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
            <button
              type="button"
              onClick={() => setIssuedRecoveryKey(null)}
              className="mt-2.5 text-xs font-semibold text-emerald-900 underline"
            >
              I Have Saved My Recovery Key
            </button>
          </div>
        ) : null}

        <p className="mt-4 text-sm leading-relaxed text-slate-700">
          Your identity has been registered, but your operational role and geographical assignment
          (Funtua LGA, Dandume LGA, Ward, or Polling Unit) have not been activated yet.
        </p>

        {account?.requestedLgaId ? (
          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
            <span className="font-semibold">Requested Assignment:</span>{' '}
            {account.requestedLgaId.toUpperCase()}
            {account.requestedWardName ? ` · ${account.requestedWardName}` : ''}
            {account.requestedPollingUnitCode
              ? ` · ${account.requestedPollingUnitCode} (${account.requestedPollingUnitName || ''})`
              : ''}
          </div>
        ) : null}

        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
          Account Status: Awaiting role &amp; area assignment by an authorized administrator.
        </div>

        <div className="mt-6 flex flex-col gap-2.5 sm:flex-row">
          <button
            type="button"
            onClick={() => void onRecheckProfile()}
            className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-lg bg-[#0b3b24] px-4 py-2 text-sm font-medium text-white hover:bg-[#115233]"
          >
            Refresh Assignment
          </button>
          <button
            type="button"
            onClick={() => {
              setIssuedRecoveryKey(null);
              void onSignOut();
            }}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            <span>Sign Out</span>
          </button>
        </div>
      </div>
    </div>
  );
}
