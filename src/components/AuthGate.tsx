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
  LogIn,
  LogOut,
  Mail,
  MapPin,
  RefreshCw,
  Shield,
  ShieldCheck,
  Trash2,
  User,
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
import { buildBundledLocationCatalog } from '../services/officialDirectory';
import { formatAccountIdentifier } from '../utils/phoneAuth';
import {
  ConstituencySkylineFooter,
  FdmisCrest,
  GoogleMark,
  NationalDomeBackdrop,
} from './FdmisBrandMark';
import { AccountStatusBadge, RoleBadge } from './StatusBadge';

type WelcomeMode = 'signin' | 'signup' | 'forgot';
type ForgotSubMode = 'email_reset' | 'email_confirm' | 'request' | 'complete';

interface AuthGateProps {
  firebaseUser: FirebaseUser | null;
  account: UserAccount | null;
  needsBootstrap: boolean;
  needsRegistration: boolean;
  loading: boolean;
  sessionCheckHint?: string;
  authError: string | null;
  connectionStatus: 'checking' | 'connected' | 'offline';
  isOnline: boolean;
  locationCatalog: LocationCatalogLga[];
  directoryStatus: 'offline' | 'updated';
  refreshingLocations: boolean;
  onRefreshLocations: () => Promise<void>;
  pendingOfflineRegistrations: PendingOfflineRegistration[];
  hasStoredSyncKey: (reg: PendingOfflineRegistration) => boolean;
  onIdentifierSignIn: (identifier: string, password: string) => Promise<void>;
  onEmailPhoneRegister: (input: {
    fullName: string;
    email: string;
    phone: string;
    password: string;
    confirmPassword: string;
    location: RegistrationLocationSelection;
  }) => Promise<PhoneRegistrationResult>;
  onGoogleSignIn: () => Promise<void>;
  onSendEmailPasswordReset: (email: string) => Promise<string>;
  onVerifyEmailResetCode?: (oobCode: string) => Promise<string>;
  onCompleteEmailReset?: (
    oobCode: string,
    newPassword: string,
    confirmPassword: string
  ) => Promise<string>;
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
  sessionCheckHint,
  authError,
  connectionStatus,
  isOnline,
  locationCatalog,
  directoryStatus,
  refreshingLocations,
  onRefreshLocations,
  pendingOfflineRegistrations,
  hasStoredSyncKey,
  onIdentifierSignIn,
  onEmailPhoneRegister,
  onGoogleSignIn,
  onSendEmailPasswordReset,
  onVerifyEmailResetCode,
  onCompleteEmailReset,
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
  const [forgotSubMode, setForgotSubMode] = useState<ForgotSubMode>('email_reset');

  // Sign-in form state
  const [signInIdentifier, setSignInIdentifier] = useState('');
  const [signInPassword, setSignInPassword] = useState('');
  const [showSignInPassword, setShowSignInPassword] = useState(false);

  // Registration form state
  const [regFullName, setRegFullName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPhone, setRegPhone] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regConfirmPassword, setRegConfirmPassword] = useState('');
  const [showRegPassword, setShowRegPassword] = useState(false);
  const [selectedLgaId, setSelectedLgaId] = useState('');
  const [selectedWardId, setSelectedWardId] = useState('');
  const [selectedPuId, setSelectedPuId] = useState('');

  // Forgot password state
  const [forgotEmail, setForgotEmail] = useState('');
  const [emailResetCode, setEmailResetCode] = useState('');
  const [verifiedResetEmail, setVerifiedResetEmail] = useState<string | null>(null);
  const [verifyingResetCode, setVerifyingResetCode] = useState(false);
  const [emailResetNewPassword, setEmailResetNewPassword] = useState('');
  const [emailResetConfirmPassword, setEmailResetConfirmPassword] = useState('');
  const [showEmailResetPass, setShowEmailResetPass] = useState(false);
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

  // Detect Firebase single-use password reset links (?mode=resetPassword&oobCode=...) on load
  useEffect(() => {
    if (typeof window === 'undefined' || !onVerifyEmailResetCode) return;
    const params = new URLSearchParams(window.location.search);
    const mode = params.get('mode');
    const oobCode = params.get('oobCode');
    if (mode === 'resetPassword' && oobCode && oobCode.trim()) {
      const cleanCode = oobCode.trim();
      setWelcomeMode('forgot');
      setForgotSubMode('email_confirm');
      setEmailResetCode(cleanCode);
      setLocalError(null);
      setLocalInfo(null);
      setVerifyingResetCode(true);
      void onVerifyEmailResetCode(cleanCode)
        .then((email) => {
          setVerifiedResetEmail(email);
        })
        .catch((err) => {
          setVerifiedResetEmail(null);
          setLocalError(
            err instanceof Error
              ? err.message
              : 'This password reset link is invalid or has expired. Please request a fresh reset link.'
          );
        })
        .finally(() => {
          setVerifyingResetCode(false);
        });
    }
  }, [onVerifyEmailResetCode]);

  useEffect(() => {
    if (firebaseUser?.displayName && !displayName) {
      setDisplayName(firebaseUser.displayName);
    }
  }, [firebaseUser?.displayName, displayName]);

  // Official directory catalog is bundled on install and updated live when online
  const effectiveCatalog = useMemo(
    () => (locationCatalog.length > 0 ? locationCatalog : buildBundledLocationCatalog()),
    [locationCatalog]
  );

  // Dynamic LGA -> Ward -> Polling Unit options strictly from official bundled/synchronized catalog
  const selectedLgaObj = useMemo(
    () => effectiveCatalog.find((l) => l.lgaId === selectedLgaId) || null,
    [effectiveCatalog, selectedLgaId]
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
    () => effectiveCatalog.find((l) => l.lgaId === forgotLgaId) || null,
    [effectiveCatalog, forgotLgaId]
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

  const handleIdentifierSignInSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    setLocalInfo(null);
    setSubmitting(true);
    try {
      await onIdentifierSignIn(signInIdentifier, signInPassword);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Unable to sign in.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEmailPhoneRegisterSubmit = async (e: FormEvent) => {
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
      const res = await onEmailPhoneRegister({
        fullName: regFullName,
        email: regEmail,
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
          'Registration saved securely offline with status: PENDING SYNCHRONIZATION. It will submit automatically when internet returns and activate as a standard Ordinary User.'
        );
        setWelcomeMode('signin');
      }
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Registration failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSendEmailResetSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    setLocalInfo(null);
    setSubmitting(true);
    try {
      const neutralMessage = await onSendEmailPasswordReset(forgotEmail);
      setLocalInfo(neutralMessage);
    } catch (err) {
      setLocalError(
        err instanceof Error ? err.message : 'Unable to process password reset request.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerifyEmailResetCode = async () => {
    if (!onVerifyEmailResetCode) return;
    setLocalError(null);
    setLocalInfo(null);
    setVerifyingResetCode(true);
    try {
      const email = await onVerifyEmailResetCode(emailResetCode);
      setVerifiedResetEmail(email);
      setLocalInfo(`Reset code verified for ${email}. Set your new password below.`);
    } catch (err) {
      setVerifiedResetEmail(null);
      setLocalError(
        err instanceof Error
          ? err.message
          : 'This password reset code is invalid or expired. Request a new reset link.'
      );
    } finally {
      setVerifyingResetCode(false);
    }
  };

  const handleCompleteEmailResetSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!onCompleteEmailReset) return;
    setLocalError(null);
    setLocalInfo(null);
    setSubmitting(true);
    try {
      const completedEmail = await onCompleteEmailReset(
        emailResetCode,
        emailResetNewPassword,
        emailResetConfirmPassword
      );
      setEmailResetCode('');
      setVerifiedResetEmail(null);
      setEmailResetNewPassword('');
      setEmailResetConfirmPassword('');
      try {
        window.history.replaceState({}, '', window.location.pathname || '/');
      } catch {
        // Ignore history restriction
      }
      setSignInIdentifier(completedEmail);
      setWelcomeMode('signin');
      setLocalInfo(
        'Your password has been reset successfully. Sign in below with your new password.'
      );
    } catch (err) {
      setLocalError(
        err instanceof Error ? err.message : 'Unable to complete password reset.'
      );
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
    const isDirectoryUpdated = directoryStatus === 'updated' && isOnline;
    return (
      <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/80 p-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5 text-[#06452F]" aria-hidden="true" />
            <span className="text-xs font-semibold text-[#102B3F]">
              Official Constituency Location {optional ? '(Optional)' : '*'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`rounded-md border px-2 py-0.5 text-[10.5px] font-semibold ${
                isDirectoryUpdated
                  ? 'border-emerald-200 bg-emerald-50 text-[#168653]'
                  : 'border-slate-200 bg-white text-slate-700'
              }`}
            >
              {isDirectoryUpdated ? 'Updated' : 'Available Offline'}
            </span>
            {isOnline ? (
              <button
                type="button"
                disabled={refreshingLocations}
                onClick={() => void onRefreshLocations()}
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[10.5px] font-semibold text-[#102B3F] hover:bg-slate-100 disabled:opacity-50"
              >
                <RefreshCw
                  className={`h-3 w-3 ${refreshingLocations ? 'animate-spin' : ''}`}
                  aria-hidden="true"
                />
                <span>Sync</span>
              </button>
            ) : null}
          </div>
        </div>

        <div>
          <label htmlFor="loc-lga" className="block text-xs font-semibold text-[#102B3F]">
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
            className="mt-1 min-h-[40px] w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-[#102B3F] focus:border-[#06452F] focus:outline-none"
          >
            <option value="">Select Local Government Area...</option>
            {effectiveCatalog.map((lga) => (
              <option key={lga.lgaId} value={lga.lgaId}>
                {lga.lgaName} ({lga.wardCount} Wards · {lga.puCount} PUs)
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="loc-ward" className="block text-xs font-semibold text-[#102B3F]">
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
            className="mt-1 min-h-[40px] w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-[#102B3F] focus:border-[#06452F] focus:outline-none disabled:bg-slate-100 disabled:text-slate-500"
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
          <label htmlFor="loc-pu" className="block text-xs font-semibold text-[#102B3F]">
            Polling Unit {!optional ? '*' : ''}
          </label>
          <select
            id="loc-pu"
            required={!optional && Boolean(selectedWardId)}
            disabled={!selectedWardId}
            value={selectedPuId}
            onChange={(e) => setSelectedPuId(e.target.value)}
            className="mt-1 min-h-[40px] w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-[#102B3F] focus:border-[#06452F] focus:outline-none disabled:bg-slate-100 disabled:text-slate-500"
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
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F5F7FA] px-4">
        <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <div className="mx-auto mb-3.5 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#06452F] text-white">
            <Shield className="h-6 w-6" aria-hidden="true" />
          </div>
          <h1 className="font-display text-base font-bold text-[#102B3F]">
            Verifying Session
          </h1>
          <p className="mt-1.5 text-xs leading-relaxed text-slate-600">
            {sessionCheckHint ||
              (isOnline
                ? 'Checking credentials, role permissions, and session availability.'
                : 'Checking encrypted local trusted session for offline access.')}
          </p>
        </div>
      </div>
    );
  }

  // 1. Unauthenticated Welcome / Dual Auth Screen (Matches Reference Image 2)
  if (!firebaseUser) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-[#F5F7FA] sm:px-4 sm:py-6">
        <div
          className={`flex min-h-screen w-full flex-col overflow-hidden bg-white sm:min-h-0 sm:rounded-[28px] sm:border sm:border-slate-200/90 sm:shadow-[0_14px_40px_rgba(6,69,47,0.12)] ${
            welcomeMode === 'signin' ? 'sm:max-w-[440px]' : 'sm:max-w-[500px]'
          }`}
        >
          {/* Forest-Green Institutional Top Banner */}
          <header className="relative overflow-hidden bg-gradient-to-br from-[#06452F] via-[#06452F] to-[#043B29] px-5 pt-7 pb-10 text-white">
            <NationalDomeBackdrop className="pointer-events-none absolute -right-4 bottom-0 h-full w-48 opacity-60" />

            {!isOnline ? (
              <div className="relative z-10 mb-3 flex justify-end">
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-[10.5px] font-bold text-amber-950">
                  <WifiOff className="h-3 w-3" aria-hidden="true" />
                  <span>Offline</span>
                </span>
              </div>
            ) : null}

            <div className="relative z-10 flex items-center justify-center gap-3.5">
              <FdmisCrest className="h-14 w-16 shrink-0 drop-shadow-xs" />
              <div className="h-11 w-px bg-white/25" aria-hidden="true" />
              <div className="leading-none">
                <h1 className="font-display text-[30px] font-extrabold tracking-tight text-white">
                  FDMIS
                </h1>
                <p className="mt-1 text-sm font-medium text-emerald-100/90">
                  Funtua-Dandume
                </p>
              </div>
            </div>

            <p className="relative z-10 mt-3.5 text-center text-xs font-medium italic text-emerald-100/90">
              Federal Constituency Mandate Intelligence System
            </p>
          </header>

          {/* Overlapping Rounded White Form Surface */}
          <main className="relative z-10 -mt-5 flex-1 rounded-t-[26px] bg-white px-5 pt-5 pb-3 sm:px-7">
            <div className="mb-4">
              <h2 className="font-display text-[22px] font-extrabold leading-tight tracking-tight text-[#102B3F]">
                {welcomeMode === 'signup'
                  ? 'Create Account'
                  : welcomeMode === 'forgot'
                    ? 'Password Recovery'
                    : 'Sign In to FDMIS'}
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                {welcomeMode === 'signup'
                  ? 'Register your account and select your Polling Unit'
                  : welcomeMode === 'forgot'
                    ? 'Recover access using email or administrator reset PIN'
                    : 'Access your account to continue'}
              </p>
            </div>

            {/* Segmented Mode Switcher (Sign In | Create Account) */}
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-[#EEF2F6] p-1">
              <button
                type="button"
                onClick={() => {
                  setWelcomeMode('signin');
                  setLocalError(null);
                  setLocalInfo(null);
                }}
                className={`inline-flex min-h-[40px] items-center justify-center gap-2 rounded-lg px-3 text-xs font-bold transition-all sm:text-sm ${
                  welcomeMode === 'signin' || welcomeMode === 'forgot'
                    ? 'bg-[#06452F] text-white shadow-xs'
                    : 'text-[#102B3F]/80 hover:text-[#06452F]'
                }`}
              >
                <User className="h-4 w-4" aria-hidden="true" />
                <span>Sign In</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setWelcomeMode('signup');
                  setLocalError(null);
                  setLocalInfo(null);
                }}
                className={`inline-flex min-h-[40px] items-center justify-center gap-2 rounded-lg px-3 text-xs font-bold transition-all sm:text-sm ${
                  welcomeMode === 'signup'
                    ? 'bg-[#06452F] text-white shadow-xs'
                    : 'text-[#102B3F]/80 hover:text-[#06452F]'
                }`}
              >
                <UserPlus className="h-4 w-4" aria-hidden="true" />
                <span>Create Account</span>
              </button>
            </div>

            {connectionStatus === 'offline' || !isOnline ? (
              <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-[11.5px] leading-snug text-amber-900">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
                <span>
                  Device is offline. First-time sign-in requires internet access; offline
                  registrations are queued locally for server sync.
                </span>
              </div>
            ) : null}

            {issuedRecoveryKey ? (
              <div className="mt-3 rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-xs text-emerald-950">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-bold text-[#06452F]">
                      Save Your Personal Recovery Key (Shown Once)
                    </p>
                    <p className="mt-0.5 text-[11px] text-emerald-900">
                      Store this key safely for faster password recovery.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIssuedRecoveryKey(null)}
                    className="rounded-lg border border-emerald-300 bg-white px-2 py-1 text-[11px] font-semibold text-[#06452F] hover:bg-emerald-100"
                  >
                    Dismiss
                  </button>
                </div>
                <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-white px-2.5 py-1.5">
                  <span className="font-mono text-xs font-bold tracking-wider text-[#102B3F]">
                    {issuedRecoveryKey}
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleCopyRecoveryKey(issuedRecoveryKey)}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] font-medium text-[#102B3F] hover:bg-slate-50"
                  >
                    <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>{copiedKey ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
              </div>
            ) : null}

            {localInfo ? (
              <div className="mt-3 flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-2.5 text-xs text-emerald-950">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#168653]" aria-hidden="true" />
                <span>{localInfo}</span>
              </div>
            ) : null}

            {combinedError ? (
              <div className="mt-3 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-2.5 text-xs text-red-900">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#DC4C45]" aria-hidden="true" />
                <span>{combinedError}</span>
              </div>
            ) : null}

            {/* Queued Offline Registrations awaiting Server Sync */}
            {pendingOfflineRegistrations.length > 0 ? (
              <div className="mt-3 space-y-2 rounded-xl border border-amber-300 bg-amber-50/70 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-bold text-amber-950">
                    Offline Registrations ({pendingOfflineRegistrations.length})
                  </p>
                  <span className="rounded-md border border-amber-300 bg-white px-2 py-0.5 text-[10px] font-bold tracking-wide text-amber-900 uppercase">
                    Pending Sync
                  </span>
                </div>
                {pendingOfflineRegistrations.map((reg) => {
                  const hasSyncKey = hasStoredSyncKey(reg);
                  const isBusy = syncingRegId === reg.id;
                  return (
                    <div
                      key={reg.id}
                      className="rounded-lg border border-amber-200 bg-white p-2.5 text-xs"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <p className="font-semibold text-[#102B3F]">
                              {reg.displayName} · {reg.email ? `${reg.email} · ` : ''}
                              {reg.phoneE164}
                            </p>
                            <span
                              className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                                reg.status === 'SYNC_FAILED'
                                  ? 'bg-red-100 text-[#DC4C45]'
                                  : 'bg-amber-100 text-amber-900'
                              }`}
                            >
                              {reg.status === 'SYNC_FAILED' ? 'Sync Failed' : 'Pending Sync'}
                            </span>
                          </div>
                          <p className="mt-0.5 text-[11px] text-slate-600">
                            {reg.requestedLgaName} · {reg.requestedWardName} ·{' '}
                            {reg.requestedPollingUnitCode}
                          </p>
                          {reg.errorMessage ? (
                            <p className="mt-1 text-[11px] text-[#DC4C45]">{reg.errorMessage}</p>
                          ) : null}
                        </div>
                        <button
                          type="button"
                          onClick={() => void onDiscardPendingOfflineRegistration(reg.id)}
                          aria-label="Discard queued registration"
                          className="inline-flex min-h-[30px] items-center gap-1 rounded-lg border border-slate-200 px-2 text-[11px] text-slate-600 hover:bg-slate-50"
                        >
                          <Trash2 className="h-3 w-3" aria-hidden="true" />
                          <span>Remove</span>
                        </button>
                      </div>

                      {isOnline ? (
                        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                          {!hasSyncKey ? (
                            <input
                              type="password"
                              value={offlineSyncPasswords[reg.id] || ''}
                              onChange={(e) =>
                                setOfflineSyncPasswords((prev) => ({
                                  ...prev,
                                  [reg.id]: e.target.value,
                                }))
                              }
                              placeholder="Confirm password to sync"
                              className="min-h-[36px] flex-1 rounded-lg border border-slate-300 px-2.5 text-xs"
                            />
                          ) : null}
                          <button
                            type="button"
                            disabled={isBusy || (!hasSyncKey && !offlineSyncPasswords[reg.id])}
                            onClick={() => void handleManualSyncOfflineReg(reg)}
                            className="inline-flex min-h-[36px] items-center justify-center gap-1.5 rounded-lg bg-[#06452F] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#043B29] disabled:opacity-50"
                          >
                            <RefreshCw
                              className={`h-3.5 w-3.5 ${isBusy ? 'animate-spin' : ''}`}
                              aria-hidden="true"
                            />
                            <span>{isBusy ? 'Syncing...' : 'Sync Now'}</span>
                          </button>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null}

            {/* MODE A: SIGN IN (Matches Reference Image 2) */}
            {welcomeMode === 'signin' ? (
              <div className="mt-4">
                <form onSubmit={handleIdentifierSignInSubmit} className="space-y-3.5">
                  <div>
                    <label
                      htmlFor="signin-identifier"
                      className="flex items-center gap-1.5 text-xs font-semibold text-[#102B3F]"
                    >
                      <Mail className="h-3.5 w-3.5 text-[#102B3F]/75" aria-hidden="true" />
                      <span>Email Address or Phone Number *</span>
                    </label>
                    <input
                      id="signin-identifier"
                      type="text"
                      required
                      autoComplete="username"
                      value={signInIdentifier}
                      onChange={(e) => setSignInIdentifier(e.target.value)}
                      placeholder="e.g. name@example.com or 0803 123 4567"
                      className="mt-1.5 min-h-[44px] w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-[#102B3F] placeholder:text-slate-400 focus:border-[#06452F] focus:outline-none focus:ring-2 focus:ring-[#06452F]/15"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <label
                        htmlFor="signin-password"
                        className="flex items-center gap-1.5 text-xs font-semibold text-[#102B3F]"
                      >
                        <Lock className="h-3.5 w-3.5 text-[#102B3F]/75" aria-hidden="true" />
                        <span>Password *</span>
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          setWelcomeMode('forgot');
                          if (signInIdentifier.includes('@')) {
                            setForgotEmail(signInIdentifier.trim());
                            setForgotSubMode('email_reset');
                          } else if (signInIdentifier.trim()) {
                            setForgotPhone(signInIdentifier.trim());
                          }
                          setLocalError(null);
                          setLocalInfo(null);
                        }}
                        className="text-xs font-semibold text-[#06452F] hover:underline"
                      >
                        Forgot Password?
                      </button>
                    </div>
                    <div className="relative mt-1.5">
                      <input
                        id="signin-password"
                        type={showSignInPassword ? 'text' : 'password'}
                        required
                        autoComplete="current-password"
                        value={signInPassword}
                        onChange={(e) => setSignInPassword(e.target.value)}
                        placeholder="Enter your password"
                        className="min-h-[44px] w-full rounded-xl border border-slate-200 bg-white px-3.5 pr-11 text-sm text-[#102B3F] placeholder:text-slate-400 focus:border-[#06452F] focus:outline-none focus:ring-2 focus:ring-[#06452F]/15"
                      />
                      <button
                        type="button"
                        onClick={() => setShowSignInPassword((v) => !v)}
                        aria-label={showSignInPassword ? 'Hide password' : 'Show password'}
                        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-slate-500 hover:text-[#102B3F]"
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
                    className="mt-1 inline-flex min-h-[46px] w-full items-center justify-center gap-2 rounded-xl bg-[#06452F] px-4 py-2.5 text-sm font-bold text-white shadow-xs transition-colors hover:bg-[#043B29] active:scale-[0.99] disabled:opacity-60"
                  >
                    <LogIn className="h-4 w-4" aria-hidden="true" />
                    <span>{submitting ? 'Signing In...' : 'Sign In'}</span>
                  </button>
                </form>

                <div className="my-4 flex items-center gap-3">
                  <div className="h-px flex-1 bg-slate-200" />
                  <span className="text-xs font-medium text-slate-500">or continue with</span>
                  <div className="h-px flex-1 bg-slate-200" />
                </div>

                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => void onGoogleSignIn()}
                  className="inline-flex min-h-[46px] w-full items-center justify-center gap-2.5 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-[#102B3F] shadow-[0_1px_2px_rgba(16,43,63,0.04)] transition-colors hover:bg-[#F5F7FA] active:scale-[0.99] disabled:opacity-60"
                >
                  <GoogleMark className="h-5 w-5 shrink-0" />
                  <span>Continue with Google</span>
                </button>

                <div className="mt-4 flex items-center justify-center gap-1.5 text-xs font-medium text-slate-500">
                  <ShieldCheck className="h-4 w-4 shrink-0 text-[#168653]" aria-hidden="true" />
                  <span>Your data is secure and protected</span>
                </div>
              </div>
            ) : null}

            {/* MODE B: CREATE NEW ACCOUNT */}
            {welcomeMode === 'signup' ? (
              <div className="mt-4">
                <form onSubmit={handleEmailPhoneRegisterSubmit} className="space-y-3">
                  <div>
                    <label htmlFor="reg-fullname" className="block text-xs font-semibold text-[#102B3F]">
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
                      className="mt-1 min-h-[42px] w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-[#102B3F] focus:border-[#06452F] focus:outline-none focus:ring-2 focus:ring-[#06452F]/15"
                    />
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label htmlFor="reg-email-addr" className="block text-xs font-semibold text-[#102B3F]">
                        Email Address *
                      </label>
                      <input
                        id="reg-email-addr"
                        type="email"
                        required
                        maxLength={200}
                        autoComplete="email"
                        value={regEmail}
                        onChange={(e) => setRegEmail(e.target.value)}
                        placeholder="name@example.com"
                        className="mt-1 min-h-[42px] w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-[#102B3F] focus:border-[#06452F] focus:outline-none focus:ring-2 focus:ring-[#06452F]/15"
                      />
                    </div>

                    <div>
                      <label htmlFor="reg-phone-num" className="block text-xs font-semibold text-[#102B3F]">
                        Phone Number *
                      </label>
                      <input
                        id="reg-phone-num"
                        type="tel"
                        required
                        autoComplete="tel"
                        value={regPhone}
                        onChange={(e) => setRegPhone(e.target.value)}
                        placeholder="0803 123 4567"
                        className="mt-1 min-h-[42px] w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-[#102B3F] focus:border-[#06452F] focus:outline-none focus:ring-2 focus:ring-[#06452F]/15"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label htmlFor="reg-pass" className="block text-xs font-semibold text-[#102B3F]">
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
                          className="min-h-[42px] w-full rounded-xl border border-slate-200 bg-white px-3 pr-10 text-sm text-[#102B3F] focus:border-[#06452F] focus:outline-none focus:ring-2 focus:ring-[#06452F]/15"
                        />
                        <button
                          type="button"
                          onClick={() => setShowRegPassword((v) => !v)}
                          aria-label={showRegPassword ? 'Hide password' : 'Show password'}
                          className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-slate-500 hover:text-[#102B3F]"
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
                      <label htmlFor="reg-conf-pass" className="block text-xs font-semibold text-[#102B3F]">
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
                        className="mt-1 min-h-[42px] w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-[#102B3F] focus:border-[#06452F] focus:outline-none focus:ring-2 focus:ring-[#06452F]/15"
                      />
                    </div>
                  </div>

                  {renderLocationSelectors(false)}

                  <button
                    type="submit"
                    disabled={submitting}
                    className="inline-flex min-h-[46px] w-full items-center justify-center gap-2 rounded-xl bg-[#06452F] px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#043B29] disabled:opacity-60"
                  >
                    <UserPlus className="h-4 w-4" aria-hidden="true" />
                    <span>
                      {submitting
                        ? 'Saving Account...'
                        : isOnline
                          ? 'Create Account'
                          : 'Save Registration Offline'}
                    </span>
                  </button>
                </form>

                <div className="mt-3.5 flex items-center justify-center gap-1.5 text-xs font-medium text-slate-500">
                  <ShieldCheck className="h-4 w-4 shrink-0 text-[#168653]" aria-hidden="true" />
                  <span>Your data is secure and protected</span>
                </div>
              </div>
            ) : null}

            {/* MODE C: FORGOT PASSWORD RECOVERY */}
            {welcomeMode === 'forgot' ? (
              <div className="mt-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <KeyRound className="h-4 w-4 text-[#06452F]" aria-hidden="true" />
                    <span className="text-xs font-bold text-[#102B3F]">Recovery Method</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setWelcomeMode('signin');
                      setLocalError(null);
                    }}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-[#06452F] hover:underline"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Back to Sign In</span>
                  </button>
                </div>

                <div className="mt-2.5 grid grid-cols-3 gap-1 rounded-xl bg-[#EEF2F6] p-1">
                  <button
                    type="button"
                    onClick={() => {
                      setForgotSubMode('email_reset');
                      setLocalError(null);
                    }}
                    className={`min-h-[36px] rounded-lg px-2 text-[11px] font-semibold ${
                      forgotSubMode === 'email_reset' || forgotSubMode === 'email_confirm'
                        ? 'bg-white text-[#06452F] shadow-xs'
                        : 'text-slate-600'
                    }`}
                  >
                    Email Reset
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setForgotSubMode('request');
                      setLocalError(null);
                    }}
                    className={`min-h-[36px] rounded-lg px-2 text-[11px] font-semibold ${
                      forgotSubMode === 'request'
                        ? 'bg-white text-[#06452F] shadow-xs'
                        : 'text-slate-600'
                    }`}
                  >
                    Phone Req
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setForgotSubMode('complete');
                      setLocalError(null);
                    }}
                    className={`min-h-[36px] rounded-lg px-2 text-[11px] font-semibold ${
                      forgotSubMode === 'complete'
                        ? 'bg-white text-[#06452F] shadow-xs'
                        : 'text-slate-600'
                    }`}
                  >
                    Reset PIN
                  </button>
                </div>

                {forgotSubMode === 'email_reset' ? (
                  <form onSubmit={handleSendEmailResetSubmit} className="mt-3.5 space-y-3">
                    <p className="text-xs leading-relaxed text-slate-600">
                      Enter your registered email address to request a single-use, time-limited
                      password reset link.
                    </p>
                    <div>
                      <label htmlFor="fg-email" className="block text-xs font-semibold text-[#102B3F]">
                        Registered Email Address *
                      </label>
                      <input
                        id="fg-email"
                        type="email"
                        required
                        autoComplete="email"
                        value={forgotEmail}
                        onChange={(e) => setForgotEmail(e.target.value)}
                        placeholder="name@example.com"
                        className="mt-1 min-h-[42px] w-full rounded-xl border border-slate-200 px-3 text-sm focus:border-[#06452F] focus:outline-none"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={submitting || !isOnline}
                      className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-[#06452F] px-4 py-2 text-sm font-bold text-white hover:bg-[#043B29] disabled:opacity-60"
                    >
                      <span>
                        {submitting
                          ? 'Sending Reset Link...'
                          : !isOnline
                            ? 'Internet Required'
                            : 'Send Password Reset Link'}
                      </span>
                    </button>
                    {onCompleteEmailReset ? (
                      <button
                        type="button"
                        onClick={() => {
                          setForgotSubMode('email_confirm');
                          setLocalError(null);
                          setLocalInfo(null);
                        }}
                        className="block w-full text-center text-xs font-semibold text-[#06452F] hover:underline"
                      >
                        Already have a reset code? Complete reset here
                      </button>
                    ) : null}
                  </form>
                ) : forgotSubMode === 'email_confirm' ? (
                  <form onSubmit={handleCompleteEmailResetSubmit} className="mt-3.5 space-y-3">
                    {verifyingResetCode ? (
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                        Verifying password reset link with server...
                      </div>
                    ) : verifiedResetEmail ? (
                      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-950">
                        Verified single-use reset link for{' '}
                        <strong className="font-semibold">{verifiedResetEmail}</strong>.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <label
                          htmlFor="fg-oob-code"
                          className="block text-xs font-semibold text-[#102B3F]"
                        >
                          Reset Verification Code *
                        </label>
                        <div className="flex gap-2">
                          <input
                            id="fg-oob-code"
                            type="text"
                            required
                            value={emailResetCode}
                            onChange={(e) => setEmailResetCode(e.target.value)}
                            placeholder="Paste reset code from email link"
                            className="min-h-[40px] flex-1 rounded-xl border border-slate-200 px-3 font-mono text-xs"
                          />
                          <button
                            type="button"
                            disabled={!emailResetCode.trim() || verifyingResetCode || !isOnline}
                            onClick={() => void handleVerifyEmailResetCode()}
                            className="min-h-[40px] rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-[#102B3F] hover:bg-slate-50 disabled:opacity-50"
                          >
                            Verify
                          </button>
                        </div>
                      </div>
                    )}

                    {verifiedResetEmail ? (
                      <>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <div>
                            <label
                              htmlFor="fg-email-new-pass"
                              className="block text-xs font-semibold text-[#102B3F]"
                            >
                              New Password *
                            </label>
                            <div className="relative mt-1">
                              <input
                                id="fg-email-new-pass"
                                type={showEmailResetPass ? 'text' : 'password'}
                                required
                                minLength={8}
                                maxLength={128}
                                autoComplete="new-password"
                                value={emailResetNewPassword}
                                onChange={(e) => setEmailResetNewPassword(e.target.value)}
                                placeholder="Min 8 chars"
                                className="min-h-[40px] w-full rounded-xl border border-slate-200 px-3 pr-10 text-sm"
                              />
                              <button
                                type="button"
                                onClick={() => setShowEmailResetPass((v) => !v)}
                                aria-label={showEmailResetPass ? 'Hide password' : 'Show password'}
                                className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-slate-500"
                              >
                                {showEmailResetPass ? (
                                  <EyeOff className="h-4 w-4" aria-hidden="true" />
                                ) : (
                                  <Eye className="h-4 w-4" aria-hidden="true" />
                                )}
                              </button>
                            </div>
                          </div>
                          <div>
                            <label
                              htmlFor="fg-email-conf-pass"
                              className="block text-xs font-semibold text-[#102B3F]"
                            >
                              Confirm New Password *
                            </label>
                            <input
                              id="fg-email-conf-pass"
                              type={showEmailResetPass ? 'text' : 'password'}
                              required
                              minLength={8}
                              maxLength={128}
                              autoComplete="new-password"
                              value={emailResetConfirmPassword}
                              onChange={(e) => setEmailResetConfirmPassword(e.target.value)}
                              placeholder="Re-enter password"
                              className="mt-1 min-h-[40px] w-full rounded-xl border border-slate-200 px-3 text-sm"
                            />
                          </div>
                        </div>

                        <button
                          type="submit"
                          disabled={submitting || !isOnline}
                          className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-[#06452F] px-4 py-2 text-sm font-bold text-white hover:bg-[#043B29] disabled:opacity-60"
                        >
                          <span>
                            {submitting ? 'Updating Password...' : 'Confirm & Save New Password'}
                          </span>
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setForgotSubMode('email_reset');
                          setLocalError(null);
                        }}
                        className="inline-flex min-h-[40px] w-full items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-xs font-semibold text-[#102B3F] hover:bg-slate-50"
                      >
                        Request a Fresh Password Reset Link
                      </button>
                    )}
                  </form>
                ) : forgotSubMode === 'request' ? (
                  <form onSubmit={handleForgotSubmitRequest} className="mt-3.5 space-y-3">
                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                      <div>
                        <label htmlFor="fg-phone" className="block text-xs font-semibold text-[#102B3F]">
                          Registered Phone *
                        </label>
                        <input
                          id="fg-phone"
                          type="tel"
                          required
                          value={forgotPhone}
                          onChange={(e) => setForgotPhone(e.target.value)}
                          placeholder="0803 123 4567"
                          className="mt-1 min-h-[40px] w-full rounded-xl border border-slate-200 px-3 text-sm"
                        />
                      </div>
                      <div>
                        <label htmlFor="fg-name" className="block text-xs font-semibold text-[#102B3F]">
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
                          className="mt-1 min-h-[40px] w-full rounded-xl border border-slate-200 px-3 text-sm"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                      <div>
                        <label htmlFor="fg-lga" className="block text-xs font-semibold text-[#102B3F]">
                          LGA
                        </label>
                        <select
                          id="fg-lga"
                          value={forgotLgaId}
                          onChange={(e) => {
                            setForgotLgaId(e.target.value);
                            setForgotWardName('');
                            setForgotPuCode('');
                          }}
                          className="mt-1 min-h-[40px] w-full rounded-xl border border-slate-200 bg-white px-2.5 text-xs"
                        >
                          <option value="">Select LGA...</option>
                          {effectiveCatalog.map((l) => (
                            <option key={l.lgaId} value={l.lgaId}>
                              {l.lgaName}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label htmlFor="fg-ward" className="block text-xs font-semibold text-[#102B3F]">
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
                          className="mt-1 min-h-[40px] w-full rounded-xl border border-slate-200 bg-white px-2.5 text-xs disabled:bg-slate-100"
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
                        <label htmlFor="fg-pu" className="block text-xs font-semibold text-[#102B3F]">
                          Polling Unit
                        </label>
                        <select
                          id="fg-pu"
                          disabled={!forgotWardName}
                          value={forgotPuCode}
                          onChange={(e) => setForgotPuCode(e.target.value)}
                          className="mt-1 min-h-[40px] w-full rounded-xl border border-slate-200 bg-white px-2.5 text-xs disabled:bg-slate-100"
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
                      <label htmlFor="fg-rkey" className="block text-xs font-semibold text-[#102B3F]">
                        Personal Recovery Key (Optional)
                      </label>
                      <input
                        id="fg-rkey"
                        type="text"
                        value={forgotRecoveryKey}
                        onChange={(e) => setForgotRecoveryKey(e.target.value)}
                        placeholder="FDM-XXXX-XXXX-XXXX"
                        className="mt-1 min-h-[40px] w-full rounded-xl border border-slate-200 px-3 font-mono text-sm uppercase"
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={submitting || !isOnline}
                      className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-[#06452F] px-4 py-2 text-sm font-bold text-white hover:bg-[#043B29] disabled:opacity-60"
                    >
                      <span>{submitting ? 'Submitting Request...' : 'Submit Recovery Request'}</span>
                    </button>
                  </form>
                ) : (
                  <form onSubmit={handleCompleteResetSubmit} className="mt-3.5 space-y-3">
                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                      <div>
                        <label htmlFor="rst-phone" className="block text-xs font-semibold text-[#102B3F]">
                          Registered Phone *
                        </label>
                        <input
                          id="rst-phone"
                          type="tel"
                          required
                          value={forgotPhone}
                          onChange={(e) => setForgotPhone(e.target.value)}
                          placeholder="0803 123 4567"
                          className="mt-1 min-h-[40px] w-full rounded-xl border border-slate-200 px-3 text-sm"
                        />
                      </div>
                      <div>
                        <label htmlFor="rst-pin" className="block text-xs font-semibold text-[#102B3F]">
                          Admin-Issued Reset PIN *
                        </label>
                        <input
                          id="rst-pin"
                          type="text"
                          required
                          value={resetPinInput}
                          onChange={(e) => setResetPinInput(e.target.value)}
                          placeholder="RST-XXXXXX"
                          className="mt-1 min-h-[40px] w-full rounded-xl border border-slate-200 px-3 font-mono text-sm uppercase"
                        />
                      </div>
                    </div>

                    <div>
                      <label htmlFor="rst-name" className="block text-xs font-semibold text-[#102B3F]">
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
                        className="mt-1 min-h-[40px] w-full rounded-xl border border-slate-200 px-3 text-sm"
                      />
                    </div>

                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                      <div>
                        <label htmlFor="rst-pass" className="block text-xs font-semibold text-[#102B3F]">
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
                            placeholder="Min 8 chars"
                            className="min-h-[40px] w-full rounded-xl border border-slate-200 px-3 pr-10 text-sm"
                          />
                          <button
                            type="button"
                            onClick={() => setShowResetPassword((v) => !v)}
                            aria-label={showResetPassword ? 'Hide password' : 'Show password'}
                            className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-slate-500"
                          >
                            {showResetPassword ? (
                              <EyeOff className="h-4 w-4" aria-hidden="true" />
                            ) : (
                              <Eye className="h-4 w-4" aria-hidden="true" />
                            )}
                          </button>
                        </div>
                      </div>
                      <div>
                        <label htmlFor="rst-conf" className="block text-xs font-semibold text-[#102B3F]">
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
                          className="mt-1 min-h-[40px] w-full rounded-xl border border-slate-200 px-3 text-sm"
                        />
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={submitting || !isOnline}
                      className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-[#06452F] px-4 py-2 text-sm font-bold text-white hover:bg-[#043B29] disabled:opacity-60"
                    >
                      <span>{submitting ? 'Completing Reset...' : 'Set New Password'}</span>
                    </button>
                  </form>
                )}
              </div>
            ) : null}
          </main>

          {/* Architectural Skyline & Forest-Green Institutional Footer (Matches Reference Image 2) */}
          <footer className="mt-auto">
            <ConstituencySkylineFooter className="-mb-px block h-14 w-full" />
            <div className="bg-[#043B29] px-4 py-3 text-center">
              <p className="text-[11px] font-medium text-emerald-50/95">
                Funtua-Dandume Mandate Intelligence System
              </p>
              <p className="mt-0.5 text-[10px] text-emerald-200/80">Powered by FDMIS</p>
            </div>
          </footer>
        </div>
      </div>
    );
  }

  // 2. Initial Full Control Admin Bootstrap Setup (Verified Google Account Only)
  if (needsBootstrap) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F5F7FA] px-4 py-8">
        <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 shadow-sm">
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-3.5">
            <div className="flex items-center gap-2.5">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#06452F] text-white">
                <ShieldCheck className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <h1 className="font-display text-base font-bold text-[#102B3F]">
                  Initial Full Control Admin Setup
                </h1>
                <p className="text-xs text-slate-500">
                  One-time constituency command initialization
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void onSignOut()}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-[#102B3F] hover:bg-slate-50"
            >
              <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Sign Out</span>
            </button>
          </div>

          <div className="mt-3.5 rounded-xl border border-emerald-200 bg-emerald-50/70 p-3 text-xs leading-relaxed text-emerald-950">
            No Full Control Admin has been initialized yet. Completing this form atomically binds
            <span className="font-semibold"> {firebaseUser.email} </span>
            as the constituency Full Control Admin and locks the bootstrap document against future
            takeover.
          </div>

          {combinedError ? (
            <div className="mt-3 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#DC4C45]" aria-hidden="true" />
              <span>{combinedError}</span>
            </div>
          ) : null}

          <form onSubmit={handleBootstrap} className="mt-4 space-y-3.5">
            <div>
              <label htmlFor="bootstrap-email" className="block text-xs font-semibold text-[#102B3F]">
                Verified Google Account
              </label>
              <input
                id="bootstrap-email"
                type="text"
                disabled
                value={firebaseUser.email || ''}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600"
              />
            </div>

            <div>
              <label htmlFor="bootstrap-name" className="block text-xs font-semibold text-[#102B3F]">
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
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-[#102B3F] focus:border-[#06452F] focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="bootstrap-phone" className="block text-xs font-semibold text-[#102B3F]">
                Operational Contact Phone (Optional)
              </label>
              <input
                id="bootstrap-phone"
                type="tel"
                maxLength={25}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="e.g. +234 800 000 0000"
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-[#102B3F] focus:border-[#06452F] focus:outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-[#06452F] px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-[#043B29] disabled:opacity-60"
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

  // 3. New Google User Profile Registration
  if (needsRegistration) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F5F7FA] px-4 py-8">
        <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 shadow-sm">
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-3.5">
            <div className="flex items-center gap-2.5">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#06452F] text-white">
                <UserCheck className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <h1 className="font-display text-base font-bold text-[#102B3F]">
                  Complete Account Profile
                </h1>
                <p className="text-xs text-slate-500">
                  Select your assigned constituency Polling Unit
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void onSignOut()}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-[#102B3F] hover:bg-slate-50"
            >
              <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Sign Out</span>
            </button>
          </div>

          {combinedError ? (
            <div className="mt-3 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#DC4C45]" aria-hidden="true" />
              <span>{combinedError}</span>
            </div>
          ) : null}

          <form onSubmit={handleGoogleRegisterPending} className="mt-4 space-y-3.5">
            <div>
              <label htmlFor="reg-email" className="block text-xs font-semibold text-[#102B3F]">
                Authenticated Account
              </label>
              <input
                id="reg-email"
                type="text"
                disabled
                value={firebaseUser.email || ''}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600"
              />
            </div>

            <div>
              <label htmlFor="reg-name" className="block text-xs font-semibold text-[#102B3F]">
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
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-[#102B3F] focus:border-[#06452F] focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="reg-phone" className="block text-xs font-semibold text-[#102B3F]">
                Contact Phone (Optional)
              </label>
              <input
                id="reg-phone"
                type="tel"
                maxLength={25}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="e.g. 0803 123 4567"
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-[#102B3F] focus:border-[#06452F] focus:outline-none"
              />
            </div>

            {renderLocationSelectors(false)}

            <button
              type="submit"
              disabled={submitting}
              className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-[#06452F] px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-[#043B29] disabled:opacity-60"
            >
              <span>{submitting ? 'Activating Account...' : 'Complete Account Setup'}</span>
            </button>
          </form>
        </div>
      </div>
    );
  }

  // 4. Suspended or Revoked Session Gate
  if (account && (account.status === AccountStatus.SUSPENDED || account.sessionRevoked)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F5F7FA] px-4 py-8">
        <div className="w-full max-w-md rounded-2xl border border-red-200 bg-white p-5 sm:p-6 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-50 text-[#DC4C45]">
              <Lock className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h1 className="font-display text-base font-bold text-[#102B3F]">
                Access Revoked or Suspended
              </h1>
              <p className="text-xs text-slate-500">{formatAccountIdentifier(account)}</p>
            </div>
          </div>

          <div className="mt-3.5 flex flex-wrap items-center gap-2">
            <AccountStatusBadge status={AccountStatus.SUSPENDED} />
            <RoleBadge role={account.role} />
          </div>

          <p className="mt-3.5 text-xs leading-relaxed text-slate-700 sm:text-sm">
            Your operational access to the Funtua–Dandume Mandate Intelligence System has been
            revoked by an authorized administrator. No submissions or queries can be performed from
            this session.
          </p>

          {account.revokedReason ? (
            <div className="mt-3.5 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-900">
              <span className="font-semibold">Recorded Reason:</span> {account.revokedReason}
            </div>
          ) : null}

          <button
            type="button"
            onClick={() => void onSignOut()}
            className="mt-5 inline-flex min-h-[42px] w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-[#102B3F] hover:bg-slate-50"
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
    <div className="flex min-h-screen items-center justify-center bg-[#F5F7FA] px-4 py-8">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-[#D99A32]">
            <Clock className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h1 className="font-display text-base font-bold text-[#102B3F]">
              Pending Administrator Approval
            </h1>
            <p className="text-xs text-slate-500">{primaryIdLabel}</p>
          </div>
        </div>

        <div className="mt-3.5 flex flex-wrap items-center gap-2">
          <AccountStatusBadge status={account?.status || AccountStatus.PENDING_APPROVAL} />
          <RoleBadge role={account?.role || UserRole.PENDING} />
        </div>

        {issuedRecoveryKey ? (
          <div className="mt-3.5 rounded-xl border border-emerald-300 bg-emerald-50 p-3.5 text-xs text-emerald-950">
            <p className="font-bold text-[#06452F]">
              Save Your Personal Recovery Key (Shown Once)
            </p>
            <p className="mt-1 text-emerald-900">
              Keep this key in a safe place for faster password recovery if you forget your
              password.
            </p>
            <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-white px-3 py-2">
              <span className="font-mono text-sm font-bold tracking-wider text-[#102B3F]">
                {issuedRecoveryKey}
              </span>
              <button
                type="button"
                onClick={() => void handleCopyRecoveryKey(issuedRecoveryKey)}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-[#102B3F] hover:bg-slate-50"
              >
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{copiedKey ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
            <button
              type="button"
              onClick={() => setIssuedRecoveryKey(null)}
              className="mt-2 text-xs font-semibold text-[#06452F] underline"
            >
              I Have Saved My Recovery Key
            </button>
          </div>
        ) : null}

        <p className="mt-3.5 text-xs leading-relaxed text-slate-700 sm:text-sm">
          Your identity has been registered, but your operational role and geographical assignment
          (Funtua LGA, Dandume LGA, Ward, or Polling Unit) have not been activated yet.
        </p>

        {account?.requestedLgaId ? (
          <div className="mt-3 rounded-xl border border-slate-200 bg-[#F5F7FA] p-3 text-xs text-slate-700">
            <span className="font-semibold text-[#102B3F]">Requested Assignment:</span>{' '}
            {account.requestedLgaId.toUpperCase()}
            {account.requestedWardName ? ` · ${account.requestedWardName}` : ''}
            {account.requestedPollingUnitCode
              ? ` · ${account.requestedPollingUnitCode} (${account.requestedPollingUnitName || ''})`
              : ''}
          </div>
        ) : null}

        <div className="mt-3 rounded-xl border border-slate-200 bg-[#F5F7FA] p-3 text-xs text-slate-700">
          <span className="font-semibold text-[#102B3F]">Status:</span> Pending Administrator
          Approval — awaiting role &amp; area assignment.
        </div>

        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={() => void onRecheckProfile()}
            className="inline-flex min-h-[42px] flex-1 items-center justify-center rounded-xl bg-[#06452F] px-4 py-2 text-sm font-bold text-white hover:bg-[#043B29]"
          >
            Refresh Assignment
          </button>
          <button
            type="button"
            onClick={() => {
              setIssuedRecoveryKey(null);
              void onSignOut();
            }}
            className="inline-flex min-h-[42px] items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-[#102B3F] hover:bg-slate-50"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            <span>Sign Out</span>
          </button>
        </div>
      </div>
    </div>
  );
}
