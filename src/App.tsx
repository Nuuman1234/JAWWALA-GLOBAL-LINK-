import { useCallback, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, type User as FirebaseUser } from 'firebase/auth';
import { AppShell, NAV_ITEMS, type NavSectionId } from './components/AppShell';
import { AuthGate } from './components/AuthGate';
import { AuditLogsPage } from './pages/AuditLogsPage';
import { DataManagementPage } from './pages/DataManagementPage';
import { EmergencyAssistancePage } from './pages/EmergencyAssistancePage';
import { FieldOpsPage } from './pages/FieldOpsPage';
import { IncidentsPage } from './pages/IncidentsPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { PartyManagementPage } from './pages/PartyManagementPage';
import { PollingUnitsDirectoryPage } from './pages/PollingUnitsDirectoryPage';
import { PublicPortalPage } from './pages/PublicPortalPage';
import { ReportsCenterPage } from './pages/ReportsCenterPage';
import { ResultsPage } from './pages/ResultsPage';
import { SettingsPage } from './pages/SettingsPage';
import { SituationRoomPage } from './pages/SituationRoomPage';
import { TimelinePage } from './pages/TimelinePage';
import { UserAccessControlPage } from './pages/UserAccessControlPage';
import { VerificationCenterPage } from './pages/VerificationCenterPage';
import { WardsDirectoryPage } from './pages/WardsDirectoryPage';
import { auth, testFirestoreConnection, type ConnectionCheckStatus } from './lib/firebase';
import {
  checkUserAndBootstrapState,
  initializeFullControlAdmin,
  registerPendingAccount,
  signInWithGoogle,
  signOutSession,
  subscribeToGlobalSettings,
  subscribeToUserAccount,
} from './services/authService';
import { observeReportAttachments } from './services/dataManagementService';
import {
  observeAuditLogs,
  observePollingUnits,
  observePuAssignments,
  observeUsers,
  observeWards,
} from './services/directoryService';
import { observeEmergencyContacts } from './services/emergencyService';
import { getQueuedItems, subscribeOfflineQueue } from './services/offlineQueue';
import {
  flushOfflineQueue,
  observeAggregatedResults,
  observeApprovedPuResults,
  observeCheckIns,
  observeIncidents,
  observeNotifications,
  observePublicResults,
  observeResultSubmissions,
  observeTimelineEvents,
} from './services/operationsService';
import { observePartyConfigs } from './services/partyService';
import {
  IncidentUrgency,
  isAuthorizedActive,
  isIncidentActive,
  type AgentCheckIn,
  type AggregatedResult,
  type ApprovedPuResult,
  type AuditLog,
  type EmergencyContact,
  type GlobalSettings,
  type IncidentReport,
  type NotificationItem,
  type OfflineQueuedItem,
  type PartyCode,
  type PartyConfig,
  type PollingUnit,
  type PuAssignment,
  type PublicVerifiedResult,
  type ReportAttachment,
  type ResultSubmission,
  type TimelineEvent,
  type UserAccount,
  type Ward,
} from './types/fdmis';

const EMPTY_PARTY_CONFIGS: Record<PartyCode, PartyConfig | null> = {
  APC: null,
  PDP: null,
  ADC: null,
  OTHERS: null,
};

export default function App() {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionCheckStatus>('checking');
  const [authReady, setAuthReady] = useState(false);
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [account, setAccount] = useState<UserAccount | null>(null);
  const [needsBootstrap, setNeedsBootstrap] = useState(false);
  const [needsRegistration, setNeedsRegistration] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [checkingProfile, setCheckingProfile] = useState(false);

  const [settings, setSettings] = useState<GlobalSettings | null>(null);
  const [partyConfigs, setPartyConfigs] =
    useState<Record<PartyCode, PartyConfig | null>>(EMPTY_PARTY_CONFIGS);
  const [wards, setWards] = useState<Ward[]>([]);
  const [pollingUnits, setPollingUnits] = useState<PollingUnit[]>([]);
  const [puAssignments, setPuAssignments] = useState<PuAssignment[]>([]);
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [checkIns, setCheckIns] = useState<AgentCheckIn[]>([]);
  const [incidents, setIncidents] = useState<IncidentReport[]>([]);
  const [results, setResults] = useState<ResultSubmission[]>([]);
  const [approvedPuResults, setApprovedPuResults] = useState<ApprovedPuResult[]>([]);
  const [aggregatedResults, setAggregatedResults] = useState<AggregatedResult[]>([]);
  const [publicResults, setPublicResults] = useState<PublicVerifiedResult[]>([]);
  const [timelineEvents, setTimelineEvents] = useState<TimelineEvent[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [emergencyContacts, setEmergencyContacts] = useState<EmergencyContact[]>([]);
  const [reportAttachments, setReportAttachments] = useState<ReportAttachment[]>([]);
  const [queuedItems, setQueuedItems] = useState<OfflineQueuedItem[]>([]);

  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [loadingData, setLoadingData] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<NavSectionId>('overview');
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [syncingNow, setSyncingNow] = useState(false);
  const [syncNonce, setSyncNonce] = useState(0);

  // 1. Boot-time Firestore connectivity check + online/offline network listeners
  useEffect(() => {
    void testFirestoreConnection().then(setConnectionStatus);

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // 2. Load or check user profile after Firebase Auth state resolves
  const evaluateProfile = useCallback(async (fbUser: FirebaseUser) => {
    setCheckingProfile(true);
    setAuthError(null);
    try {
      const result = await checkUserAndBootstrapState(fbUser);
      setAccount(result.account);
      setNeedsBootstrap(result.needsBootstrap);
      setNeedsRegistration(result.needsRegistration);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Unable to verify operator profile.');
    } finally {
      setCheckingProfile(false);
    }
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (fbUser) => {
      setFirebaseUser(fbUser);
      setAuthReady(true);
      if (fbUser) {
        void evaluateProfile(fbUser);
      } else {
        setAccount(null);
        setNeedsBootstrap(false);
        setNeedsRegistration(false);
        setPartyConfigs(EMPTY_PARTY_CONFIGS);
        setWards([]);
        setPollingUnits([]);
        setPuAssignments([]);
        setUsers([]);
        setAuditLogs([]);
        setCheckIns([]);
        setIncidents([]);
        setResults([]);
        setApprovedPuResults([]);
        setAggregatedResults([]);
        setPublicResults([]);
        setTimelineEvents([]);
        setNotifications([]);
        setEmergencyContacts([]);
        setReportAttachments([]);
        setQueuedItems([]);
        setLastUpdatedAt(null);
        setActiveSection('overview');
        window.history.replaceState({ fdmisLocked: true }, '', '/');
      }
    });
    return () => unsub();
  }, [evaluateProfile]);

  // 3. Real-time profile & revocation watcher + global settings watcher
  useEffect(() => {
    if (!firebaseUser || needsBootstrap || needsRegistration) return;

    const unsubUser = subscribeToUserAccount(
      firebaseUser.uid,
      (updated) => {
        if (updated) setAccount(updated);
      },
      (err) => setAuthError(err.message)
    );

    const unsubSettings = subscribeToGlobalSettings(
      (s) => setSettings(s),
      () => {
        // Ignore if global settings haven't been created yet
      }
    );

    return () => {
      unsubUser();
      unsubSettings();
    };
  }, [firebaseUser, needsBootstrap, needsRegistration]);

  const activeAuthorized = isAuthorizedActive(account);

  // Guard browser history navigation after logout or revocation so Back cannot restore protected routes
  useEffect(() => {
    if (firebaseUser && activeAuthorized) {
      window.history.replaceState({ fdmisAuthenticated: true }, '', window.location.pathname || '/');
      return;
    }

    window.history.replaceState({ fdmisLocked: true }, '', '/');
    const handlePopState = () => {
      window.history.replaceState({ fdmisLocked: true }, '', '/');
      setActiveSection('overview');
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [firebaseUser, activeAuthorized]);

  // 4. Scoped real-time Firestore listeners (only attached when authenticated & authorized active)
  useEffect(() => {
    if (!authReady || !firebaseUser || !account || !activeAuthorized) {
      setPartyConfigs(EMPTY_PARTY_CONFIGS);
      setWards([]);
      setPollingUnits([]);
      setPuAssignments([]);
      setUsers([]);
      setAuditLogs([]);
      setCheckIns([]);
      setIncidents([]);
      setResults([]);
      setApprovedPuResults([]);
      setAggregatedResults([]);
      setPublicResults([]);
      setTimelineEvents([]);
      setNotifications([]);
      setEmergencyContacts([]);
      setReportAttachments([]);
      return;
    }

    setLoadingData(true);
    setDataError(null);

    const markSynced = () => setLastUpdatedAt(new Date());

    const handleSubError = (err: Error) => {
      setDataError(err.message);
      setLoadingData(false);
    };

    const unsubPartyConfigs = observePartyConfigs(
      (configs) => {
        setPartyConfigs(configs);
        markSynced();
      },
      handleSubError
    );

    const unsubWards = observeWards(
      account,
      (items) => {
        setWards(items);
        setLoadingData(false);
        markSynced();
      },
      handleSubError
    );

    const unsubPus = observePollingUnits(
      account,
      (items) => {
        setPollingUnits(items);
        setLoadingData(false);
        markSynced();
      },
      handleSubError
    );

    const unsubPuAssignments = observePuAssignments(
      account,
      (items) => {
        setPuAssignments(items);
        markSynced();
      },
      handleSubError
    );

    const unsubUsers = observeUsers(
      account,
      (items) => {
        setUsers(items);
        markSynced();
      },
      handleSubError
    );
    const unsubAudit = observeAuditLogs(
      account,
      (items) => {
        setAuditLogs(items);
        markSynced();
      },
      handleSubError
    );
    const unsubCheckIns = observeCheckIns(
      account,
      (items) => {
        setCheckIns(items);
        markSynced();
      },
      handleSubError
    );
    const unsubIncidents = observeIncidents(
      account,
      (items) => {
        setIncidents(items);
        markSynced();
      },
      handleSubError
    );
    const unsubResults = observeResultSubmissions(
      account,
      (items) => {
        setResults(items);
        markSynced();
      },
      handleSubError
    );
    const unsubApproved = observeApprovedPuResults(
      account,
      (items) => {
        setApprovedPuResults(items);
        markSynced();
      },
      handleSubError
    );
    const unsubAggregated = observeAggregatedResults(
      account,
      (items) => {
        setAggregatedResults(items);
        markSynced();
      },
      handleSubError
    );
    const unsubPublic = observePublicResults(
      (items) => {
        setPublicResults(items);
        markSynced();
      },
      handleSubError
    );
    const unsubTimeline = observeTimelineEvents(
      account,
      (items) => {
        setTimelineEvents(items);
        markSynced();
      },
      handleSubError
    );
    const unsubNotifs = observeNotifications(
      account,
      (items) => {
        setNotifications(items);
        markSynced();
      },
      handleSubError
    );
    const unsubEmergency = observeEmergencyContacts(
      account,
      (items) => {
        setEmergencyContacts(items);
        markSynced();
      },
      handleSubError
    );
    const unsubAttachments = observeReportAttachments(
      account,
      (items) => {
        setReportAttachments(items);
        markSynced();
      },
      handleSubError
    );

    return () => {
      unsubPartyConfigs();
      unsubWards();
      unsubPus();
      unsubPuAssignments();
      unsubUsers();
      unsubAudit();
      unsubCheckIns();
      unsubIncidents();
      unsubResults();
      unsubApproved();
      unsubAggregated();
      unsubPublic();
      unsubTimeline();
      unsubNotifs();
      unsubEmergency();
      unsubAttachments();
    };
  }, [authReady, firebaseUser, account, activeAuthorized, syncNonce]);

  // 5. Offline queue subscription & automatic background sync on reconnect
  useEffect(() => {
    if (!account || !activeAuthorized) {
      setQueuedItems([]);
      return;
    }

    const refreshQueue = () => {
      void getQueuedItems(account.uid).then(setQueuedItems);
    };
    refreshQueue();
    const unsubQueue = subscribeOfflineQueue(refreshQueue);
    return () => unsubQueue();
  }, [account, activeAuthorized]);

  useEffect(() => {
    if (!isOnline || !account || !activeAuthorized || pollingUnits.length === 0) return;
    const hasPending = queuedItems.some(
      (i) => i.status === 'PENDING_SYNC' || i.status === 'SYNC_FAILED'
    );
    if (!hasPending) return;
    void flushOfflineQueue(account, pollingUnits, results);
  }, [isOnline, account, activeAuthorized, pollingUnits, results, queuedItems]);

  // 6. Ensure activeSection remains valid for current user's role
  useEffect(() => {
    if (!account) return;
    const item = NAV_ITEMS.find((n) => n.id === activeSection);
    if (!item || !item.visible(account.role)) {
      setActiveSection('overview');
    }
  }, [account, activeSection]);

  // 7. Configurable inactivity auto-logout timer
  const inactivityMinutes = settings?.inactivityTimeoutMinutes ?? 30;
  useEffect(() => {
    if (!activeAuthorized || !account) return;

    const timeoutMs = inactivityMinutes * 60 * 1000;
    let timerId = window.setTimeout(() => {
      void signOutSession(account, 'INACTIVITY_AUTO_LOGOUT');
    }, timeoutMs);

    const resetTimer = () => {
      window.clearTimeout(timerId);
      timerId = window.setTimeout(() => {
        void signOutSession(account, 'INACTIVITY_AUTO_LOGOUT');
      }, timeoutMs);
    };

    const events: (keyof WindowEventMap)[] = ['mousedown', 'keydown', 'touchstart', 'scroll'];
    events.forEach((evt) => window.addEventListener(evt, resetTimer, { passive: true }));

    return () => {
      window.clearTimeout(timerId);
      events.forEach((evt) => window.removeEventListener(evt, resetTimer));
    };
  }, [activeAuthorized, account, inactivityMinutes]);

  const pendingSyncCount = useMemo(
    () =>
      queuedItems.filter((i) => i.status === 'PENDING_SYNC' || i.status === 'SYNC_FAILED')
        .length,
    [queuedItems]
  );

  const criticalAlertCount = useMemo(
    () =>
      incidents.filter(
        (i) => i.urgency === IncidentUrgency.CRITICAL && isIncidentActive(i.status)
      ).length,
    [incidents]
  );

  const handleManualSync = useCallback(async () => {
    if (syncingNow) return;
    setSyncingNow(true);
    try {
      const status = await testFirestoreConnection();
      setConnectionStatus(status);
      if (account && isOnline && pollingUnits.length > 0 && pendingSyncCount > 0) {
        await flushOfflineQueue(account, pollingUnits, results);
      }
      setSyncNonce((prev) => prev + 1);
      setLastUpdatedAt(new Date());
    } finally {
      setSyncingNow(false);
    }
  }, [syncingNow, account, isOnline, pollingUnits, pendingSyncCount, results]);

  const handleGoogleSignIn = async () => {
    setAuthError(null);
    try {
      await signInWithGoogle();
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Google sign-in failed.');
    }
  };

  const handleBootstrap = async (displayName: string, phone: string) => {
    const created = await initializeFullControlAdmin(displayName, phone);
    setAccount(created);
    setNeedsBootstrap(false);
    setNeedsRegistration(false);
  };

  const handleRegisterPending = async (displayName: string, phone: string) => {
    const created = await registerPendingAccount(displayName, phone);
    setAccount(created);
    setNeedsRegistration(false);
  };

  const handleSignOut = async () => {
    await signOutSession(account);
    setActiveSection('overview');
  };

  const handleRecheckProfile = async () => {
    if (firebaseUser) {
      await evaluateProfile(firebaseUser);
    }
  };

  if (!authReady || checkingProfile || !firebaseUser || !activeAuthorized || !account) {
    return (
      <AuthGate
        firebaseUser={firebaseUser}
        account={account}
        needsBootstrap={needsBootstrap}
        needsRegistration={needsRegistration}
        loading={!authReady || checkingProfile}
        authError={authError}
        connectionStatus={connectionStatus}
        onGoogleSignIn={handleGoogleSignIn}
        onBootstrapSubmit={handleBootstrap}
        onRegisterPending={handleRegisterPending}
        onSignOut={handleSignOut}
        onRecheckProfile={handleRecheckProfile}
      />
    );
  }

  return (
    <AppShell
      user={account}
      activeSection={activeSection}
      onSelectSection={setActiveSection}
      onSignOut={handleSignOut}
      inactivityMinutes={inactivityMinutes}
      isOnline={isOnline}
      pendingSyncCount={pendingSyncCount}
      criticalAlertCount={criticalAlertCount}
      lastUpdatedAt={lastUpdatedAt}
      onManualSync={handleManualSync}
      syncingNow={syncingNow}
    >
      {dataError ? (
        <div className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-900 print:hidden">
          {dataError}
        </div>
      ) : null}

      {activeSection === 'overview' ? (
        <SituationRoomPage
          user={account}
          wards={wards}
          pollingUnits={pollingUnits}
          checkIns={checkIns}
          incidents={incidents}
          results={results}
          approvedPuResults={approvedPuResults}
          aggregatedResults={aggregatedResults}
          partyConfigs={partyConfigs}
          emergencyContacts={emergencyContacts}
          settings={settings}
          loadingData={loadingData}
          onNavigate={setActiveSection}
        />
      ) : null}

      {activeSection === 'field_ops' ? (
        <FieldOpsPage
          user={account}
          pollingUnits={pollingUnits}
          checkIns={checkIns}
          results={results}
          queuedItems={queuedItems}
          isOnline={isOnline}
        />
      ) : null}

      {activeSection === 'incidents' ? (
        <IncidentsPage
          user={account}
          pollingUnits={pollingUnits}
          incidents={incidents}
          isOnline={isOnline}
        />
      ) : null}

      {activeSection === 'results' ? (
        <ResultsPage
          user={account}
          pollingUnits={pollingUnits}
          results={results}
          approvedPuResults={approvedPuResults}
          partyConfigs={partyConfigs}
          isOnline={isOnline}
        />
      ) : null}

      {activeSection === 'verification' ? (
        <VerificationCenterPage
          user={account}
          results={results}
          partyConfigs={partyConfigs}
        />
      ) : null}

      {activeSection === 'timeline' ? (
        <TimelinePage
          user={account}
          wards={wards}
          pollingUnits={pollingUnits}
          events={timelineEvents}
        />
      ) : null}

      {activeSection === 'wards' ? (
        <WardsDirectoryPage
          user={account}
          wards={wards}
          pollingUnits={pollingUnits}
          users={users}
          incidents={incidents}
          results={results}
          approvedPuResults={approvedPuResults}
          partyConfigs={partyConfigs}
          loading={loadingData}
        />
      ) : null}

      {activeSection === 'polling_units' ? (
        <PollingUnitsDirectoryPage
          user={account}
          wards={wards}
          pollingUnits={pollingUnits}
          users={users}
          puAssignments={puAssignments}
          loading={loadingData}
        />
      ) : null}

      {activeSection === 'party_management' ? (
        <PartyManagementPage user={account} partyConfigs={partyConfigs} />
      ) : null}

      {activeSection === 'reports' ? (
        <ReportsCenterPage
          user={account}
          wards={wards}
          pollingUnits={pollingUnits}
          checkIns={checkIns}
          incidents={incidents}
          results={results}
          approvedPuResults={approvedPuResults}
          partyConfigs={partyConfigs}
        />
      ) : null}

      {activeSection === 'notifications' ? (
        <NotificationsPage
          user={account}
          wards={wards}
          notifications={notifications}
          settings={settings}
        />
      ) : null}

      {activeSection === 'emergency_assistance' ? (
        <EmergencyAssistancePage user={account} contacts={emergencyContacts} />
      ) : null}

      {activeSection === 'public_portal' ? (
        <PublicPortalPage
          publicResults={publicResults}
          settings={settings}
          partyConfigs={partyConfigs}
        />
      ) : null}

      {activeSection === 'users' ? (
        <UserAccessControlPage
          currentUser={account}
          users={users}
          wards={wards}
          pollingUnits={pollingUnits}
          puAssignments={puAssignments}
          loading={loadingData}
        />
      ) : null}

      {activeSection === 'data_management' ? (
        <DataManagementPage
          user={account}
          pollingUnits={pollingUnits}
          results={results}
          approvedPuResults={approvedPuResults}
          incidents={incidents}
          checkIns={checkIns}
          notifications={notifications}
          timelineEvents={timelineEvents}
          reportAttachments={reportAttachments}
        />
      ) : null}

      {activeSection === 'audit_logs' ? (
        <AuditLogsPage logs={auditLogs} loading={loadingData} />
      ) : null}

      {activeSection === 'settings' ? (
        <SettingsPage user={account} settings={settings} onSignOut={handleSignOut} />
      ) : null}
    </AppShell>
  );
}
