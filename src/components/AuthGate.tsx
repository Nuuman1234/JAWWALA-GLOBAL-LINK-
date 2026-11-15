import { useState, type FormEvent } from 'react';
import type { User as FirebaseUser } from 'firebase/auth';
import {
  AlertTriangle,
  Clock,
  Lock,
  LogOut,
  Shield,
  ShieldCheck,
  UserCheck,
} from 'lucide-react';
import { AccountStatus, UserRole, type UserAccount } from '../types/fdmis';
import { AccountStatusBadge, RoleBadge } from './StatusBadge';

interface AuthGateProps {
  firebaseUser: FirebaseUser | null;
  account: UserAccount | null;
  needsBootstrap: boolean;
  needsRegistration: boolean;
  loading: boolean;
  authError: string | null;
  connectionStatus: 'checking' | 'connected' | 'offline';
  onGoogleSignIn: () => Promise<void>;
  onBootstrapSubmit: (displayName: string, phone: string) => Promise<void>;
  onRegisterPending: (displayName: string, phone: string) => Promise<void>;
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
  onGoogleSignIn,
  onBootstrapSubmit,
  onRegisterPending,
  onSignOut,
  onRecheckProfile,
}: AuthGateProps) {
  const [displayName, setDisplayName] = useState(firebaseUser?.displayName || '');
  const [phone, setPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const combinedError = localError || authError;

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

  const handleRegister = async (e: FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    setSubmitting(true);
    try {
      await onRegisterPending(displayName, phone);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Failed to register operator profile.');
    } finally {
      setSubmitting(false);
    }
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
            Checking authentication credentials, role permissions, and Firestore connectivity.
          </p>
        </div>
      </div>
    );
  }

  // 1. Unauthenticated Sign-In Portal
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
            <span className="text-xs font-medium text-slate-600">
              2027 Election Cycle · Katsina State
            </span>
          </div>
        </header>

        <main className="mx-auto flex w-full max-w-5xl flex-1 items-center px-4 py-10 sm:px-6">
          <div className="grid w-full grid-cols-1 gap-8 lg:grid-cols-12 lg:items-stretch">
            <div className="flex flex-col justify-between rounded-xl border border-slate-200 bg-[#0b3b24] p-7 text-white lg:col-span-7">
              <div>
                <p className="text-xs font-medium tracking-wide text-emerald-200">
                  Funtua–Dandume Federal Constituency
                </p>
                <h1 className="mt-2 font-display text-2xl font-bold leading-tight text-balance sm:text-3xl">
                  Funtua–Dandume Mandate Intelligence System
                </h1>
                <p className="mt-3 max-w-xl text-sm leading-relaxed text-emerald-50/90">
                  Authorized election-day coordination, polling-unit monitoring, field agent verification,
                  incident escalation, and audited result management across Funtua and Dandume LGAs.
                </p>
              </div>

              <div className="mt-8 grid grid-cols-1 gap-4 border-t border-white/15 pt-6 sm:grid-cols-2">
                <div>
                  <p className="text-xs font-medium text-emerald-200">Funtua LGA (Code 20-14)</p>
                  <p className="mt-1 font-mono text-lg font-semibold tabular-nums">
                    11 Wards · 298 Polling Units
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-emerald-200">Dandume LGA (Code 20/07)</p>
                  <p className="mt-1 font-mono text-lg font-semibold tabular-nums">
                    11 Wards · 177 Polling Units
                  </p>
                </div>
              </div>
            </div>

            <div className="flex flex-col justify-center rounded-xl border border-slate-200 bg-white p-7 lg:col-span-5">
              <h2 className="font-display text-xl font-semibold text-slate-900">
                Authorized Operator Sign-In
              </h2>
              <p className="mt-1.5 text-sm text-slate-600">
                Sign in with your verified Google account. Access is governed by strict role-based
                and geographic authorization.
              </p>

              {connectionStatus === 'offline' ? (
                <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
                  <span>
                    Network connectivity to Firestore could not be verified. Check your internet connection before signing in.
                  </span>
                </div>
              ) : null}

              {combinedError ? (
                <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-900">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-700" aria-hidden="true" />
                  <span>{combinedError}</span>
                </div>
              ) : null}

              <button
                type="button"
                onClick={() => void onGoogleSignIn()}
                className="mt-6 inline-flex min-h-[48px] w-full items-center justify-center gap-2.5 rounded-lg bg-[#0b3b24] px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#115233] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0b3b24]"
              >
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                <span>Sign In with Google</span>
              </button>

              <div className="mt-6 space-y-2 border-t border-slate-100 pt-5 text-xs text-slate-500">
                <p>1. First sign-in initializes the Full Control Admin if unconfigured.</p>
                <p>2. Subsequent operators start as Pending Approval until assigned by an admin.</p>
                <p>3. All logins, role assignments, and revocations are recorded in the audit log.</p>
              </div>
            </div>
          </div>
        </main>

        <footer className="border-t border-slate-200 bg-white px-4 py-4 text-center text-xs text-slate-500">
          Funtua–Dandume Mandate Intelligence System · Protected Constituency Operations
        </footer>
      </div>
    );
  }

  // 2. Initial Full Control Admin Bootstrap Setup
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
            as the constituency Full Control Admin and locks the bootstrap document against future takeover.
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
              <span>{submitting ? 'Initializing Command Account...' : 'Initialize Full Control Admin'}</span>
            </button>
          </form>
        </div>
      </div>
    );
  }

  // 3. New User Registration (Bootstrap already exists -> registers as PENDING_APPROVAL)
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

          <form onSubmit={handleRegister} className="mt-5 space-y-4">
            <div>
              <label htmlFor="reg-email" className="block text-xs font-medium text-slate-700">
                Authenticated Google Account
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
                placeholder="e.g. +234 800 000 0000"
                className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-[#0b3b24] focus:outline-none"
              />
            </div>

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
              <p className="text-xs text-slate-600">{account.email}</p>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <AccountStatusBadge status={AccountStatus.SUSPENDED} />
            <RoleBadge role={account.role} />
          </div>

          <p className="mt-4 text-sm leading-relaxed text-slate-700">
            Your operational access to the Funtua–Dandume Mandate Intelligence System has been
            revoked by an authorized administrator. No submissions or queries can be performed from this session.
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
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-7">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-50 text-amber-700">
            <Clock className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h1 className="font-display text-lg font-bold text-slate-900">
              Pending Administrator Approval
            </h1>
            <p className="text-xs text-slate-600">{account?.email || firebaseUser.email}</p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <AccountStatusBadge status={account?.status || AccountStatus.PENDING_APPROVAL} />
          <RoleBadge role={account?.role || UserRole.PENDING} />
        </div>

        <p className="mt-4 text-sm leading-relaxed text-slate-700">
          Your identity has been authenticated, but your operational role and geographical assignment
          (Funtua LGA, Dandume LGA, Ward, or Polling Unit) have not been activated yet.
        </p>

        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-xs text-slate-600">
          Operator UID: {firebaseUser.uid}
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
            onClick={() => void onSignOut()}
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
