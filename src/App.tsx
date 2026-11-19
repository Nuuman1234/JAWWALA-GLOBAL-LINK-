import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, type User as FirebaseUser } from 'firebase/auth';
import './print.css';
import { AppShell } from './components/AppShell';
import { AuthGate } from './components/AuthGate';
import { OperationalNotesPanel } from './components/OperationalNotesPanel';
import { useNavigationHistory } from './hooks/useNavigationHistory';
import { AuditLogsPage } from './pages/AuditLogsPage';
import { DataManagementPage } from './pages/DataManagementPage';
import { EmergencyAssistancePage } from './pages/EmergencyAssistancePage';
import { EnhancedReportsPage } from './pages/EnhancedReportsPage';
import { FieldOpsPage } from './pages/FieldOpsPage';
import { FullAdminHomePage } from './pages/FullAdminHomePage';
import { IncidentsPage } from './pages/IncidentsPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { OperationsOfficersPage } from './pages/OperationsOfficersPage';
import { PartyManagementPage } from './pages/PartyManagementPage';
import { PollingUnitsDirectoryPage } from './pages/PollingUnitsDirectoryPage';
import { PublicPortalPage } from './pages/PublicPortalPage';
import { ResultsPage } from './pages/ResultsPage';
import { SettingsPage } from './pages/SettingsPage';
import { SituationRoomPage } from './pages/SituationRoomPage';
import { TaskAssignmentPage } from './pages/TaskAssignmentPage';
import { TimelinePage } from './pages/TimelinePage';
import { UserAccessControlPage } from './pages/UserAccessControlPage';
import { VerificationCenterPage } from './pages/VerificationCenterPage';
import { WardsDirectoryPage } from './pages/WardsDirectoryPage';
import { auth, testFirestoreConnection, type ConnectionCheckStatus } from './lib/firebase';
import {
  checkUserAndBootstrapState,
  completeApprovedPasswordReset,
  hasStoredOfflineRegistrationKey,
  initializeFullControlAdmin,
  registerPendingAccount,
  registerWithEmailAndPhone,
  resolvePendingOfflinePassword,
  sendEmailPasswordReset,
  signInWithGoogle,
  signInWithIdentifierAndPassword,
  signOutSession,
  submitPasswordResetRequest,
  subscribeToGlobalSettings,
  subscribeToUserAccount,
  syncPendingOfflineRegistration,
  updateUserBatteryStatus,
  type RegistrationLocationSelection,
} from './services/authService';
import { observeReportAttachments } from './services/dataManagementService';
import {
  canManageDirectory,
  fetchPublicLocationCatalogWithStatus,
  observeAuditLogs,
  observePasswordResetRequests,
  observePollingUnits,
  observePuAssignments,
  observeUsers,
  observeWards,
  subscribeToPublicLocationCatalog,
  syncLocationCatalogFromLiveDirectory,
} from './services/directoryService';
import { buildBundledLocationCatalog } from './services/officialDirectory';
import { observeEmergencyContacts } from './services/emergencyService';
import {
  buildMergedOperationalNotes,
  observeOperationalNotes,
} from './services/notesService';
import {
  deletePendingOfflineRegistration,
  getDeletedTombstones,
  getPendingOfflineRegistrations,
  getQueuedItems,
  loadCollectionSnapshot,
  pruneOfflineStorageOnStartup,
  saveCollectionSnapshot,
  subscribeLocalNotes,
  subscribeOfflineQueue,
} from './services/offlineQueue';
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
  syncSingleQueuedItem,
} from './services/operationsService';
import { observePartyConfigs } from './services/partyService';
import { observeGeneratedReports } from './services/reportArchiveService';
import { observeOperationalTasks } from './services/taskService';
import {
  IncidentUrgency,
  UserRole,
  isAuthorizedActive,
  isIncidentActive,
  type AgentCheckIn,
  type AggregatedResult,
  type ApprovedPuResult,
  type AuditLog,
  type EmergencyContact,
  type GeneratedReportRecord,
  type GlobalSettings,
  type IncidentReport,
  type LocationCatalogLga,
  type NotificationItem,
  type OfflineQueuedItem,
  type OperationalNote,
  type OperationalTask,
  type PartyCode,
  type PartyConfig,
  type PasswordResetRequest,
  type PendingOfflineRegistration,
  type PollingUnit,
  type PuAssignment,
  type PublicVerifiedResult,
  type ReportAttachment,
  type ResultSubmission,
  type TimelineEvent,
  type UserAccount,
  type Ward,
} from './types/fdmis';

function filterOutTombstones<
  T extends { id?: string; clientNoteId?: string; puId?: string; sourceSubmissionId?: string },
>(items: T[], tombstones: Set<string>, checkPuId = false): T[] {
  if (tombstones.size === 0) return items;
  return items.filter((item) => {
    if (item.id && tombstones.has(item.id)) return false;
    if (item.clientNoteId && tombstones.has(item.clientNoteId)) return false;
    if (item.sourceSubmissionId && tombstones.has(item.sourceSubmissionId)) return false;
    if (checkPuId && item.puId && tombstones.has(item.puId)) return false;
    return true;
  });
}

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
  const [serverNotes, setServerNotes] = useState<OperationalNote[]>([]);
  const [mergedNotes, setMergedNotes] = useState<OperationalNote[]>([]);
  const [operationalTasks, setOperationalTasks] = useState<OperationalTask[]>([]);
  const [generatedReports, setGeneratedReports] = useState<GeneratedReportRecord[]>([]);
  const [queuedItems, setQueuedItems] = useState<OfflineQueuedItem[]>([]);

  const [locationCatalog, setLocationCatalog] = useState<LocationCatalogLga[]>(() =>
    buildBundledLocationCatalog()
  );
  const [directoryStatus, setDirectoryStatus] = useState<'offline' | 'updated'>('offline');
  const [refreshingLocations, setRefreshingLocations] = useState(false);
  const [pendingOfflineRegistrations, setPendingOfflineRegistrations] = useState<
    PendingOfflineRegistration[]
  >([]);
  const [passwordResetRequests, setPasswordResetRequests] = useState<PasswordResetRequest[]>([]);

  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [loadingData, setLoadingData] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [syncingNow, setSyncingNow] = useState(false);
  const [syncNonce, setSyncNonce] = useState(0);

  const isFlushingRef = useRef(false);
  const syncingOfflineRegsRef = useRef(false);
  const wasOfflineRef = useRef(!isOnline);
  const startupPrunedRef = useRef(false);
  const lastCatalogSignatureRef = useRef('');

  // 1. Boot-time Firestore connectivity, offline storage pruning, location catalog sync & online/offline listeners
  useEffect(() => {
    void testFirestoreConnection().then(setConnectionStatus);

    if (!startupPrunedRef.current) {
      startupPrunedRef.current = true;
      void pruneOfflineStorageOnStartup().then(() => {
        void getPendingOfflineRegistrations().then(setPendingOfflineRegistrations);
      });
    }

    const unsubCatalog = subscribeToPublicLocationCatalog(
      setLocationCatalog,
      undefined,
      (source) => {
        if (source === 'live') {
          setDirectoryStatus('updated');
        }
      }
    );

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      unsubCatalog();
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
        setServerNotes([]);
        setMergedNotes([]);
        setOperationalTasks([]);
        setGeneratedReports([]);
        setQueuedItems([]);
        setPasswordResetRequests([]);
        setLastUpdatedAt(null);
        void getPendingOfflineRegistrations().then(setPendingOfflineRegistrations);
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

  const {
    activeSection,
    visitedSections,
    canGoBack,
    previousSectionLabel,
    navigateTo,
    goBack,
    resetNavigation,
  } = useNavigationHistory(account, activeAuthorized);

  // Guard browser history navigation after logout or revocation so Back cannot restore protected routes
  useEffect(() => {
    if (firebaseUser && activeAuthorized) {
      return;
    }

    window.history.replaceState({ fdmisLocked: true }, '', '/');
    const handlePopState = () => {
      window.history.replaceState({ fdmisLocked: true }, '', '/');
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [firebaseUser, activeAuthorized]);

  // 4. Scoped real-time listeners + offline snapshot hydration & tombstone filtering
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
      setServerNotes([]);
      setOperationalTasks([]);
      setGeneratedReports([]);
      setPasswordResetRequests([]);
      return;
    }

    let cancelled = false;
    const liveLoaded = new Set<string>();
    setLoadingData(true);
    setDataError(null);

    const markSynced = () => setLastUpdatedAt(new Date());

    const handleSubError = (err: Error) => {
      if (!navigator.onLine) {
        setLoadingData(false);
        return;
      }
      setDataError(err.message);
      setLoadingData(false);
    };

    // Hydrate downloaded records immediately for seamless offline access
    void (async () => {
      const uid = account.uid;
      const [
        tombstones,
        cParty,
        cWards,
        cPus,
        cAssign,
        cUsers,
        cAudit,
        cCheckIns,
        cIncidents,
        cResults,
        cApproved,
        cAggregated,
        cPublic,
        cTimeline,
        cNotifs,
        cContacts,
        cAttach,
        cNotes,
        cResetReqs,
        cTasks,
        cReports,
      ] = await Promise.all([
        getDeletedTombstones(),
        loadCollectionSnapshot<Record<PartyCode, PartyConfig | null>>(uid, 'partyConfigs'),
        loadCollectionSnapshot<Ward[]>(uid, 'wards'),
        loadCollectionSnapshot<PollingUnit[]>(uid, 'pollingUnits'),
        loadCollectionSnapshot<PuAssignment[]>(uid, 'puAssignments'),
        loadCollectionSnapshot<UserAccount[]>(uid, 'users'),
        loadCollectionSnapshot<AuditLog[]>(uid, 'auditLogs'),
        loadCollectionSnapshot<AgentCheckIn[]>(uid, 'checkIns'),
        loadCollectionSnapshot<IncidentReport[]>(uid, 'incidents'),
        loadCollectionSnapshot<ResultSubmission[]>(uid, 'results'),
        loadCollectionSnapshot<ApprovedPuResult[]>(uid, 'approvedPuResults'),
        loadCollectionSnapshot<AggregatedResult[]>(uid, 'aggregatedResults'),
        loadCollectionSnapshot<PublicVerifiedResult[]>(uid, 'publicResults'),
        loadCollectionSnapshot<TimelineEvent[]>(uid, 'timelineEvents'),
        loadCollectionSnapshot<NotificationItem[]>(uid, 'notifications'),
        loadCollectionSnapshot<EmergencyContact[]>(uid, 'emergencyContacts'),
        loadCollectionSnapshot<ReportAttachment[]>(uid, 'reportAttachments'),
        loadCollectionSnapshot<OperationalNote[]>(uid, 'operationalNotes'),
        loadCollectionSnapshot<PasswordResetRequest[]>(uid, 'passwordResetRequests'),
        loadCollectionSnapshot<OperationalTask[]>(uid, 'operationalTasks'),
        loadCollectionSnapshot<GeneratedReportRecord[]>(uid, 'generatedReports'),
      ]);

      if (cancelled) return;
      if (!liveLoaded.has('partyConfigs') && cParty) setPartyConfigs(cParty);
      if (!liveLoaded.has('wards') && cWards) setWards(cWards);
      if (!liveLoaded.has('pollingUnits') && cPus) setPollingUnits(cPus);
      if (!liveLoaded.has('puAssignments') && cAssign) setPuAssignments(cAssign);
      if (!liveLoaded.has('users') && cUsers) setUsers(cUsers);
      if (!liveLoaded.has('auditLogs') && cAudit) setAuditLogs(cAudit);
      if (!liveLoaded.has('checkIns') && cCheckIns) {
        setCheckIns(filterOutTombstones(cCheckIns, tombstones));
      }
      if (!liveLoaded.has('incidents') && cIncidents) {
        setIncidents(filterOutTombstones(cIncidents, tombstones));
      }
      if (!liveLoaded.has('results') && cResults) {
        setResults(filterOutTombstones(cResults, tombstones));
      }
      if (!liveLoaded.has('approvedPuResults') && cApproved) {
        setApprovedPuResults(filterOutTombstones(cApproved, tombstones, true));
      }
      if (!liveLoaded.has('aggregatedResults') && cAggregated) {
        setAggregatedResults(filterOutTombstones(cAggregated, tombstones));
      }
      if (!liveLoaded.has('publicResults') && cPublic) {
        setPublicResults(filterOutTombstones(cPublic, tombstones, true));
      }
      if (!liveLoaded.has('timelineEvents') && cTimeline) {
        setTimelineEvents(filterOutTombstones(cTimeline, tombstones));
      }
      if (!liveLoaded.has('notifications') && cNotifs) {
        setNotifications(filterOutTombstones(cNotifs, tombstones));
      }
      if (!liveLoaded.has('emergencyContacts') && cContacts) {
        setEmergencyContacts(cContacts);
      }
      if (!liveLoaded.has('reportAttachments') && cAttach) {
        setReportAttachments(filterOutTombstones(cAttach, tombstones));
      }
      if (!liveLoaded.has('operationalNotes') && cNotes) {
        setServerNotes(filterOutTombstones(cNotes, tombstones));
      }
      if (!liveLoaded.has('passwordResetRequests') && cResetReqs) {
        setPasswordResetRequests(cResetReqs);
      }
      if (!liveLoaded.has('operationalTasks') && cTasks) {
        setOperationalTasks(filterOutTombstones(cTasks, tombstones));
      }
      if (!liveLoaded.has('generatedReports') && cReports) {
        setGeneratedReports(filterOutTombstones(cReports, tombstones));
      }
      if (!navigator.onLine) {
        setLoadingData(false);
      }
    })();

    const unsubPartyConfigs = observePartyConfigs(
      (configs) => {
        liveLoaded.add('partyConfigs');
        setPartyConfigs(configs);
        void saveCollectionSnapshot(account.uid, 'partyConfigs', configs);
        markSynced();
      },
      handleSubError
    );

    const unsubWards = observeWards(
      account,
      (items) => {
        liveLoaded.add('wards');
        setWards(items);
        void saveCollectionSnapshot(account.uid, 'wards', items);
        setLoadingData(false);
        markSynced();
      },
      handleSubError
    );

    const unsubPus = observePollingUnits(
      account,
      (items) => {
        liveLoaded.add('pollingUnits');
        setPollingUnits(items);
        void saveCollectionSnapshot(account.uid, 'pollingUnits', items);
        setLoadingData(false);
        markSynced();
      },
      handleSubError
    );

    const unsubPuAssignments = observePuAssignments(
      account,
      (items) => {
        liveLoaded.add('puAssignments');
        setPuAssignments(items);
        void saveCollectionSnapshot(account.uid, 'puAssignments', items);
        markSynced();
      },
      handleSubError
    );

    const unsubUsers = observeUsers(
      account,
      (items) => {
        liveLoaded.add('users');
        setUsers(items);
        void saveCollectionSnapshot(account.uid, 'users', items);
        markSynced();
      },
      handleSubError
    );
    const unsubAudit = observeAuditLogs(
      account,
      (items) => {
        liveLoaded.add('auditLogs');
        setAuditLogs(items);
        void saveCollectionSnapshot(account.uid, 'auditLogs', items);
        markSynced();
      },
      handleSubError
    );
    const unsubCheckIns = observeCheckIns(
      account,
      (items) => {
        liveLoaded.add('checkIns');
        void getDeletedTombstones().then((tombstones) => {
          if (cancelled) return;
          const clean = filterOutTombstones(items, tombstones);
          setCheckIns(clean);
          void saveCollectionSnapshot(account.uid, 'checkIns', clean);
          markSynced();
        });
      },
      handleSubError
    );
    const unsubIncidents = observeIncidents(
      account,
      (items) => {
        liveLoaded.add('incidents');
        void getDeletedTombstones().then((tombstones) => {
          if (cancelled) return;
          const clean = filterOutTombstones(items, tombstones);
          setIncidents(clean);
          void saveCollectionSnapshot(account.uid, 'incidents', clean);
          markSynced();
        });
      },
      handleSubError
    );
    const unsubResults = observeResultSubmissions(
      account,
      (items) => {
        liveLoaded.add('results');
        void getDeletedTombstones().then((tombstones) => {
          if (cancelled) return;
          const clean = filterOutTombstones(items, tombstones);
          setResults(clean);
          void saveCollectionSnapshot(account.uid, 'results', clean);
          markSynced();
        });
      },
      handleSubError
    );
    const unsubApproved = observeApprovedPuResults(
      account,
      (items) => {
        liveLoaded.add('approvedPuResults');
        void getDeletedTombstones().then((tombstones) => {
          if (cancelled) return;
          const clean = filterOutTombstones(items, tombstones, true);
          setApprovedPuResults(clean);
          void saveCollectionSnapshot(account.uid, 'approvedPuResults', clean);
          markSynced();
        });
      },
      handleSubError
    );
    const unsubAggregated = observeAggregatedResults(
      account,
      (items) => {
        liveLoaded.add('aggregatedResults');
        void getDeletedTombstones().then((tombstones) => {
          if (cancelled) return;
          const clean = filterOutTombstones(items, tombstones);
          setAggregatedResults(clean);
          void saveCollectionSnapshot(account.uid, 'aggregatedResults', clean);
          markSynced();
        });
      },
      handleSubError
    );
    const unsubPublic = observePublicResults(
      (items) => {
        liveLoaded.add('publicResults');
        void getDeletedTombstones().then((tombstones) => {
          if (cancelled) return;
          const clean = filterOutTombstones(items, tombstones, true);
          setPublicResults(clean);
          void saveCollectionSnapshot(account.uid, 'publicResults', clean);
          markSynced();
        });
      },
      handleSubError
    );
    const unsubTimeline = observeTimelineEvents(
      account,
      (items) => {
        liveLoaded.add('timelineEvents');
        void getDeletedTombstones().then((tombstones) => {
          if (cancelled) return;
          const clean = filterOutTombstones(items, tombstones);
          setTimelineEvents(clean);
          void saveCollectionSnapshot(account.uid, 'timelineEvents', clean);
          markSynced();
        });
      },
      handleSubError
    );
    const unsubNotifs = observeNotifications(
      account,
      (items) => {
        liveLoaded.add('notifications');
        void getDeletedTombstones().then((tombstones) => {
          if (cancelled) return;
          const clean = filterOutTombstones(items, tombstones);
          setNotifications(clean);
          void saveCollectionSnapshot(account.uid, 'notifications', clean);
          markSynced();
        });
      },
      handleSubError
    );
    const unsubEmergency = observeEmergencyContacts(
      account,
      (items) => {
        liveLoaded.add('emergencyContacts');
        setEmergencyContacts(items);
        void saveCollectionSnapshot(account.uid, 'emergencyContacts', items);
        markSynced();
      },
      handleSubError
    );
    const unsubAttachments = observeReportAttachments(
      account,
      (items) => {
        liveLoaded.add('reportAttachments');
        void getDeletedTombstones().then((tombstones) => {
          if (cancelled) return;
          const clean = filterOutTombstones(items, tombstones);
          setReportAttachments(clean);
          void saveCollectionSnapshot(account.uid, 'reportAttachments', clean);
          markSynced();
        });
      },
      handleSubError
    );
    const unsubNotes = observeOperationalNotes(
      account,
      (items) => {
        liveLoaded.add('operationalNotes');
        void getDeletedTombstones().then((tombstones) => {
          if (cancelled) return;
          const clean = filterOutTombstones(items, tombstones);
          setServerNotes(clean);
          void saveCollectionSnapshot(account.uid, 'operationalNotes', clean);
          markSynced();
        });
      },
      handleSubError
    );
    const unsubResetReqs = observePasswordResetRequests(
      account,
      (items) => {
        liveLoaded.add('passwordResetRequests');
        setPasswordResetRequests(items);
        void saveCollectionSnapshot(account.uid, 'passwordResetRequests', items);
        markSynced();
      },
      handleSubError
    );
    const unsubTasks = observeOperationalTasks(
      account,
      (items) => {
        liveLoaded.add('operationalTasks');
        void getDeletedTombstones().then((tombstones) => {
          if (cancelled) return;
          const clean = filterOutTombstones(items, tombstones);
          setOperationalTasks(clean);
          void saveCollectionSnapshot(account.uid, 'operationalTasks', clean);
          markSynced();
        });
      },
      handleSubError
    );
    const unsubGeneratedReports = observeGeneratedReports(
      account,
      (items) => {
        liveLoaded.add('generatedReports');
        void getDeletedTombstones().then((tombstones) => {
          if (cancelled) return;
          const clean = filterOutTombstones(items, tombstones);
          setGeneratedReports(clean);
          void saveCollectionSnapshot(account.uid, 'generatedReports', clean);
          markSynced();
        });
      },
      handleSubError
    );

    return () => {
      cancelled = true;
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
      unsubNotes();
      unsubResetReqs();
      unsubTasks();
      unsubGeneratedReports();
    };
  }, [authReady, firebaseUser, account, activeAuthorized, syncNonce]);

  // 4a. Keep public location_catalog synchronized whenever an authorized directory admin opens FDMIS
  useEffect(() => {
    if (
      !account ||
      !activeAuthorized ||
      !isOnline ||
      !canManageDirectory(account.role) ||
      (wards.length === 0 && pollingUnits.length === 0)
    ) {
      return;
    }

    const isFull = account.role === UserRole.FULL_CONTROL_ADMIN;
    const scopedWardsCount = isFull
      ? wards.length
      : wards.filter((w) => w.lgaId === account.assignedLgaId).length;
    const scopedPusCount = isFull
      ? pollingUnits.length
      : pollingUnits.filter((p) => p.lgaId === account.assignedLgaId).length;

    const catWardsCount = locationCatalog.reduce((sum, l) => sum + l.wardCount, 0);
    const catPusCount = locationCatalog.reduce((sum, l) => sum + l.puCount, 0);
    const myEntry = isFull
      ? null
      : locationCatalog.find((l) => l.lgaId === account.assignedLgaId);

    const catalogDiffers = isFull
      ? locationCatalog.length === 0 ||
        catWardsCount !== scopedWardsCount ||
        catPusCount !== scopedPusCount
      : !myEntry || myEntry.wardCount !== scopedWardsCount || myEntry.puCount !== scopedPusCount;

    const liveSignature = `${account.role}:${scopedWardsCount}:${scopedPusCount}`;
    if (!catalogDiffers || lastCatalogSignatureRef.current === liveSignature) return;

    lastCatalogSignatureRef.current = liveSignature;
    void syncLocationCatalogFromLiveDirectory(account, wards, pollingUnits);
  }, [account, activeAuthorized, isOnline, wards, pollingUnits, locationCatalog]);

  // 4c. Automatic background sync for pending offline registrations + directory updates on reconnect/focus/startup
  const runPendingOfflineRegistrationSync = useCallback(async () => {
    if (!isOnline || firebaseUser || syncingOfflineRegsRef.current) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;

    syncingOfflineRegsRef.current = true;
    try {
      const currentList = await getPendingOfflineRegistrations();
      const candidates = currentList.filter((r) => r.status === 'QUEUED_OFFLINE');
      if (candidates.length === 0) return;

      for (const reg of candidates) {
        const storedPw = await resolvePendingOfflinePassword(reg);
        if (!storedPw) continue;
        try {
          await syncPendingOfflineRegistration(reg, storedPw);
          // Once synced, Firebase signs the new Ordinary User account directly into ACTIVE status scoped to their selected location.
          break;
        } catch {
          // Recorded cleanly on the pending offline registration record; retry on next trigger if transient
        }
      }

      const refreshed = await getPendingOfflineRegistrations();
      setPendingOfflineRegistrations(refreshed);
    } finally {
      syncingOfflineRegsRef.current = false;
    }
  }, [isOnline, firebaseUser]);

  useEffect(() => {
    if (!isOnline) {
      setDirectoryStatus('offline');
      return;
    }
    void fetchPublicLocationCatalogWithStatus().then((res) => {
      setLocationCatalog(res.catalog);
      if (res.updatedFromServer) {
        setDirectoryStatus('updated');
      }
    });
  }, [isOnline]);

  useEffect(() => {
    if (!isOnline || firebaseUser) return;
    if (pendingOfflineRegistrations.some((r) => r.status === 'QUEUED_OFFLINE')) {
      void runPendingOfflineRegistrationSync();
    }

    const handleResumeSync = () => {
      if (document.visibilityState === 'visible') {
        void runPendingOfflineRegistrationSync();
      }
    };
    const handleFocusSync = () => {
      void runPendingOfflineRegistrationSync();
    };
    window.addEventListener('focus', handleFocusSync);
    document.addEventListener('visibilitychange', handleResumeSync);
    return () => {
      window.removeEventListener('focus', handleFocusSync);
      document.removeEventListener('visibilitychange', handleResumeSync);
    };
  }, [isOnline, firebaseUser, pendingOfflineRegistrations, runPendingOfflineRegistrationSync]);

  // 4b. Merge local offline notes with synced server notes cleanly
  useEffect(() => {
    if (!account || !activeAuthorized) {
      setMergedNotes([]);
      return;
    }

    let cancelled = false;
    const refreshMergedNotes = () => {
      void buildMergedOperationalNotes(account.uid, serverNotes).then((combined) => {
        if (!cancelled) setMergedNotes(combined);
      });
    };

    refreshMergedNotes();
    const unsubLocal = subscribeLocalNotes(refreshMergedNotes);
    return () => {
      cancelled = true;
      unsubLocal();
    };
  }, [account, activeAuthorized, serverNotes, queuedItems]);

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

  const executeQueueSync = useCallback(
    async (includeFailed: boolean) => {
      if (!isOnline || !account || !activeAuthorized || isFlushingRef.current) return;

      const eligible = queuedItems.filter((item) => {
        const isPendingStatus =
          item.status === 'PENDING_SYNC' ||
          item.status === 'SAVED_LOCALLY' ||
          (includeFailed && item.status === 'SYNC_FAILED');
        if (!isPendingStatus) return false;
        const isIndependent =
          item.reportType === 'NOTE_UPSERT' ||
          item.reportType === 'NOTE_DELETE' ||
          item.reportType === 'NOTIFICATION_BROADCAST' ||
          item.reportType === 'TASK_CREATE' ||
          item.reportType === 'TASK_OFFICER_UPDATE' ||
          item.reportType === 'REPORT_ARCHIVE';
        return isIndependent || pollingUnits.length > 0;
      });

      if (eligible.length === 0) return;

      isFlushingRef.current = true;
      try {
        if (pollingUnits.length > 0) {
          await flushOfflineQueue(account, pollingUnits, results);
        } else {
          for (const item of eligible) {
            await syncSingleQueuedItem(account, item, pollingUnits, results);
          }
        }
      } finally {
        isFlushingRef.current = false;
      }
    },
    [isOnline, account, activeAuthorized, queuedItems, pollingUnits, results]
  );

  // Trigger full retry once when connectivity returns from offline -> online
  useEffect(() => {
    if (!isOnline) {
      wasOfflineRef.current = true;
      return;
    }
    if (wasOfflineRef.current) {
      wasOfflineRef.current = false;
      void executeQueueSync(true);
    }
  }, [isOnline, executeQueueSync]);

  // Auto-flush newly queued PENDING_SYNC / SAVED_LOCALLY items whenever online
  useEffect(() => {
    const hasFreshPending = queuedItems.some(
      (i) => i.status === 'PENDING_SYNC' || i.status === 'SAVED_LOCALLY'
    );
    if (!hasFreshPending) return;
    void executeQueueSync(false);
  }, [queuedItems, executeQueueSync]);

  // 6. Navigation role validation is enforced inside useNavigationHistory

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
      queuedItems.filter(
        (i) =>
          i.status === 'PENDING_SYNC' ||
          i.status === 'SAVED_LOCALLY' ||
          i.status === 'SYNC_FAILED'
      ).length,
    [queuedItems]
  );

  const syncingCount = useMemo(
    () => queuedItems.filter((i) => i.status === 'SYNCING').length,
    [queuedItems]
  );

  const failedSyncCount = useMemo(
    () => queuedItems.filter((i) => i.status === 'SYNC_FAILED').length,
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
      if (account && isOnline && pendingSyncCount > 0) {
        await executeQueueSync(true);
      }
      setSyncNonce((prev) => prev + 1);
      setLastUpdatedAt(new Date());
    } finally {
      setSyncingNow(false);
    }
  }, [syncingNow, account, isOnline, pendingSyncCount, executeQueueSync]);

  const handleRetryQueueItem = useCallback(
    async (item: OfflineQueuedItem) => {
      if (!account || !isOnline || syncingNow) return;
      setSyncingNow(true);
      try {
        await syncSingleQueuedItem(account, item, pollingUnits, results);
        setLastUpdatedAt(new Date());
      } finally {
        setSyncingNow(false);
      }
    },
    [account, isOnline, syncingNow, pollingUnits, results]
  );

  const handleRefreshLocations = useCallback(async () => {
    setRefreshingLocations(true);
    try {
      const res = await fetchPublicLocationCatalogWithStatus();
      setLocationCatalog(res.catalog);
      if (res.updatedFromServer) {
        setDirectoryStatus('updated');
      }
    } finally {
      setRefreshingLocations(false);
    }
  }, []);

  const handleGoogleSignIn = async () => {
    setAuthError(null);
    try {
      await signInWithGoogle();
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Google sign-in failed.');
    }
  };

  const handleIdentifierSignIn = async (identifier: string, password: string) => {
    setAuthError(null);
    await signInWithIdentifierAndPassword(identifier, password);
  };

  const handleEmailPhoneRegister = async (input: {
    fullName: string;
    email: string;
    phone: string;
    password: string;
    confirmPassword: string;
    location: RegistrationLocationSelection;
  }) => {
    setAuthError(null);
    const res = await registerWithEmailAndPhone(input);
    if (res.queuedOffline) {
      const regs = await getPendingOfflineRegistrations();
      setPendingOfflineRegistrations(regs);
    }
    return res;
  };

  const handleBatteryUpdate = useCallback(
    (levelPercent: number | null, charging: boolean | null) => {
      if (!account || !activeAuthorized) return;
      void updateUserBatteryStatus(account, levelPercent, charging);
    },
    [account, activeAuthorized]
  );

  const handleSyncPendingOfflineRegistration = async (
    reg: PendingOfflineRegistration,
    password?: string
  ) => {
    const resolved = password || (await resolvePendingOfflinePassword(reg)) || '';
    if (!resolved) {
      throw new Error('Enter your chosen password to finalize offline registration sync.');
    }
    try {
      await syncPendingOfflineRegistration(reg, resolved);
    } finally {
      const refreshed = await getPendingOfflineRegistrations();
      setPendingOfflineRegistrations(refreshed);
    }
  };

  const handleDiscardPendingOfflineRegistration = async (regId: string) => {
    await deletePendingOfflineRegistration(regId);
    const refreshed = await getPendingOfflineRegistrations();
    setPendingOfflineRegistrations(refreshed);
  };

  const handleBootstrap = async (displayName: string, phone: string) => {
    const created = await initializeFullControlAdmin(displayName, phone);
    setAccount(created);
    setNeedsBootstrap(false);
    setNeedsRegistration(false);
  };

  const handleRegisterPending = async (
    displayName: string,
    phone: string,
    location?: RegistrationLocationSelection | null
  ) => {
    const created = await registerPendingAccount(displayName, phone, location);
    setAccount(created);
    setNeedsRegistration(false);
  };

  const handleSignOut = async () => {
    resetNavigation();
    await signOutSession(account);
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
        isOnline={isOnline}
        locationCatalog={locationCatalog}
        directoryStatus={directoryStatus}
        refreshingLocations={refreshingLocations}
        onRefreshLocations={handleRefreshLocations}
        pendingOfflineRegistrations={pendingOfflineRegistrations}
        hasStoredSyncKey={(reg) => hasStoredOfflineRegistrationKey(reg)}
        onIdentifierSignIn={handleIdentifierSignIn}
        onEmailPhoneRegister={handleEmailPhoneRegister}
        onGoogleSignIn={handleGoogleSignIn}
        onSendEmailPasswordReset={sendEmailPasswordReset}
        onSubmitPasswordResetRequest={submitPasswordResetRequest}
        onCompleteApprovedPasswordReset={completeApprovedPasswordReset}
        onSyncPendingOfflineRegistration={handleSyncPendingOfflineRegistration}
        onDiscardPendingOfflineRegistration={handleDiscardPendingOfflineRegistration}
        onBootstrapSubmit={handleBootstrap}
        onRegisterPending={handleRegisterPending}
        onSignOut={handleSignOut}
        onRecheckProfile={handleRecheckProfile}
      />
    );
  }

  const isSectionMounted = (id: Parameters<typeof navigateTo>[0]) =>
    activeSection === id || visitedSections.has(id);

  return (
    <AppShell
      user={account}
      activeSection={activeSection}
      onSelectSection={navigateTo}
      canGoBack={canGoBack}
      previousSectionLabel={previousSectionLabel}
      onGoBack={goBack}
      onSignOut={handleSignOut}
      inactivityMinutes={inactivityMinutes}
      isOnline={isOnline}
      pendingSyncCount={pendingSyncCount}
      syncingCount={syncingCount}
      failedSyncCount={failedSyncCount}
      criticalAlertCount={criticalAlertCount}
      lastUpdatedAt={lastUpdatedAt}
      onManualSync={handleManualSync}
      syncingNow={syncingNow}
      onBatteryUpdate={handleBatteryUpdate}
    >
      {dataError ? (
        <div className="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-900 print:hidden">
          {dataError}
        </div>
      ) : null}

      {account.role === UserRole.FULL_CONTROL_ADMIN && isSectionMounted('admin_home') ? (
        <div className={activeSection === 'admin_home' ? 'block' : 'hidden print:hidden'}>
          <FullAdminHomePage
            user={account}
            wards={wards}
            pollingUnits={pollingUnits}
            users={users}
            checkIns={checkIns}
            incidents={incidents}
            results={results}
            approvedPuResults={approvedPuResults}
            publicResults={publicResults}
            partyConfigs={partyConfigs}
            tasks={operationalTasks}
            notes={mergedNotes}
            timelineEvents={timelineEvents}
            notifications={notifications}
            emergencyContacts={emergencyContacts}
            generatedReports={generatedReports}
            reportAttachments={reportAttachments}
            auditLogs={auditLogs}
            isOnline={isOnline}
            lastUpdatedAt={lastUpdatedAt}
            pendingSyncCount={pendingSyncCount}
            syncingCount={syncingCount}
            failedSyncCount={failedSyncCount}
            syncingNow={syncingNow}
            onManualSync={() => void handleManualSync()}
            onNavigate={navigateTo}
          />
        </div>
      ) : null}

      {isSectionMounted('overview') ? (
        <div
          data-print-board="true"
          className={activeSection === 'overview' ? 'block' : 'hidden print:hidden'}
        >
          <SituationRoomPage
            user={account}
            wards={wards}
            pollingUnits={pollingUnits}
            users={users}
            checkIns={checkIns}
            incidents={incidents}
            results={results}
            approvedPuResults={approvedPuResults}
            aggregatedResults={aggregatedResults}
            partyConfigs={partyConfigs}
            emergencyContacts={emergencyContacts}
            settings={settings}
            loadingData={loadingData}
            onNavigate={navigateTo}
          />
        </div>
      ) : null}

      {isSectionMounted('field_ops') ? (
        <div className={activeSection === 'field_ops' ? 'block' : 'hidden print:hidden'}>
          <FieldOpsPage
            user={account}
            pollingUnits={pollingUnits}
            checkIns={checkIns}
            results={results}
            queuedItems={queuedItems}
            isOnline={isOnline}
            onRetryQueueItem={handleRetryQueueItem}
          />
        </div>
      ) : null}

      {isSectionMounted('notes') ? (
        <div className={activeSection === 'notes' ? 'block' : 'hidden print:hidden'}>
          <OperationalNotesPanel
            user={account}
            notes={mergedNotes}
            wards={wards}
            pollingUnits={pollingUnits}
            isOnline={isOnline}
            onRetrySync={() => void handleManualSync()}
            syncingNow={syncingNow}
          />
        </div>
      ) : null}

      {isSectionMounted('incidents') ? (
        <div className={activeSection === 'incidents' ? 'block' : 'hidden print:hidden'}>
          <IncidentsPage
            user={account}
            pollingUnits={pollingUnits}
            incidents={incidents}
            queuedItems={queuedItems}
            isOnline={isOnline}
            onRetrySync={() => void handleManualSync()}
            syncingNow={syncingNow}
          />
        </div>
      ) : null}

      {isSectionMounted('results') ? (
        <div className={activeSection === 'results' ? 'block' : 'hidden print:hidden'}>
          <ResultsPage
            user={account}
            pollingUnits={pollingUnits}
            results={results}
            approvedPuResults={approvedPuResults}
            partyConfigs={partyConfigs}
            queuedItems={queuedItems}
            isOnline={isOnline}
            onRetrySync={() => void handleManualSync()}
            syncingNow={syncingNow}
          />
        </div>
      ) : null}

      {isSectionMounted('verification') ? (
        <div className={activeSection === 'verification' ? 'block' : 'hidden print:hidden'}>
          <VerificationCenterPage
            user={account}
            results={results}
            partyConfigs={partyConfigs}
          />
        </div>
      ) : null}

      {isSectionMounted('task_ops') ? (
        <div className={activeSection === 'task_ops' ? 'block' : 'hidden print:hidden'}>
          <TaskAssignmentPage
            currentUser={account}
            users={users}
            wards={wards}
            tasks={operationalTasks}
            queuedItems={queuedItems}
            isOnline={isOnline}
            syncingNow={syncingNow}
            onRetrySync={() => void handleManualSync()}
            onNavigate={navigateTo}
          />
        </div>
      ) : null}

      {isSectionMounted('timeline') ? (
        <div className={activeSection === 'timeline' ? 'block' : 'hidden print:hidden'}>
          <TimelinePage
            user={account}
            wards={wards}
            pollingUnits={pollingUnits}
            events={timelineEvents}
          />
        </div>
      ) : null}

      {isSectionMounted('wards') ? (
        <div className={activeSection === 'wards' ? 'block' : 'hidden print:hidden'}>
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
        </div>
      ) : null}

      {isSectionMounted('polling_units') ? (
        <div className={activeSection === 'polling_units' ? 'block' : 'hidden print:hidden'}>
          <PollingUnitsDirectoryPage
            user={account}
            wards={wards}
            pollingUnits={pollingUnits}
            users={users}
            puAssignments={puAssignments}
            loading={loadingData}
          />
        </div>
      ) : null}

      {isSectionMounted('party_management') ? (
        <div className={activeSection === 'party_management' ? 'block' : 'hidden print:hidden'}>
          <PartyManagementPage user={account} partyConfigs={partyConfigs} />
        </div>
      ) : null}

      {isSectionMounted('reports') ? (
        <div className={activeSection === 'reports' ? 'block' : 'hidden print:hidden'}>
          <EnhancedReportsPage
            user={account}
            users={users}
            wards={wards}
            pollingUnits={pollingUnits}
            checkIns={checkIns}
            incidents={incidents}
            results={results}
            approvedPuResults={approvedPuResults}
            partyConfigs={partyConfigs}
            tasks={operationalTasks}
            notes={mergedNotes}
            generatedReports={generatedReports}
            queuedItems={queuedItems}
            isOnline={isOnline}
            lastUpdatedAt={lastUpdatedAt}
            syncingNow={syncingNow}
            onRetrySync={() => void handleManualSync()}
          />
        </div>
      ) : null}

      {isSectionMounted('notifications') ? (
        <div className={activeSection === 'notifications' ? 'block' : 'hidden print:hidden'}>
          <NotificationsPage
            user={account}
            wards={wards}
            notifications={notifications}
            settings={settings}
            isOnline={isOnline}
            queuedItems={queuedItems}
            onRetrySync={() => void handleManualSync()}
            syncingNow={syncingNow}
          />
        </div>
      ) : null}

      {isSectionMounted('emergency_assistance') ? (
        <div className={activeSection === 'emergency_assistance' ? 'block' : 'hidden print:hidden'}>
          <EmergencyAssistancePage user={account} contacts={emergencyContacts} />
        </div>
      ) : null}

      {isSectionMounted('public_portal') ? (
        <div className={activeSection === 'public_portal' ? 'block' : 'hidden print:hidden'}>
          <PublicPortalPage
            publicResults={publicResults}
            settings={settings}
            partyConfigs={partyConfigs}
          />
        </div>
      ) : null}

      {isSectionMounted('users') ? (
        <div className={activeSection === 'users' ? 'block' : 'hidden print:hidden'}>
          <UserAccessControlPage
            currentUser={account}
            users={users}
            wards={wards}
            pollingUnits={pollingUnits}
            puAssignments={puAssignments}
            passwordResetRequests={passwordResetRequests}
            loading={loadingData}
          />
        </div>
      ) : null}

      {isSectionMounted('operations_officers') ? (
        <div className={activeSection === 'operations_officers' ? 'block' : 'hidden print:hidden'}>
          <OperationsOfficersPage
            currentUser={account}
            users={users}
            wards={wards}
            checkIns={checkIns}
            incidents={incidents}
            notes={mergedNotes}
            isOnline={isOnline}
            loading={loadingData}
          />
        </div>
      ) : null}

      {isSectionMounted('data_management') ? (
        <div className={activeSection === 'data_management' ? 'block' : 'hidden print:hidden'}>
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
            notes={mergedNotes}
          />
        </div>
      ) : null}

      {isSectionMounted('audit_logs') ? (
        <div className={activeSection === 'audit_logs' ? 'block' : 'hidden print:hidden'}>
          <AuditLogsPage logs={auditLogs} loading={loadingData} />
        </div>
      ) : null}

      {isSectionMounted('settings') ? (
        <div className={activeSection === 'settings' ? 'block' : 'hidden print:hidden'}>
          <SettingsPage user={account} settings={settings} onSignOut={handleSignOut} />
        </div>
      ) : null}
    </AppShell>
  );
}
