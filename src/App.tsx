import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, type User as FirebaseUser } from 'firebase/auth';
import { AppShell, NAV_ITEMS, type NavSectionId } from './components/AppShell';
import { AuthGate } from './components/AuthGate';
import { OperationalNotesPanel } from './components/OperationalNotesPanel';
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
  completeApprovedPasswordReset,
  getEphemeralOfflinePassword,
  initializeFullControlAdmin,
  registerPendingAccount,
  registerWithPhoneAndPassword,
  signInWithGoogle,
  signInWithPhoneAndPassword,
  signOutSession,
  submitPasswordResetRequest,
  subscribeToGlobalSettings,
  subscribeToUserAccount,
  syncPendingOfflineRegistration,
  type RegistrationLocationSelection,
} from './services/authService';
import { observeReportAttachments } from './services/dataManagementService';
import {
  canManageDirectory,
  fetchPublicLocationCatalog,
  observeAuditLogs,
  observePasswordResetRequests,
  observePollingUnits,
  observePuAssignments,
  observeUsers,
  observeWards,
  subscribeToPublicLocationCatalog,
  syncLocationCatalogFromLiveDirectory,
} from './services/directoryService';
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
  type GlobalSettings,
  type IncidentReport,
  type LocationCatalogLga,
  type NotificationItem,
  type OfflineQueuedItem,
  type OperationalNote,
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
  const [queuedItems, setQueuedItems] = useState<OfflineQueuedItem[]>([]);

  const [locationCatalog, setLocationCatalog] = useState<LocationCatalogLga[]>([]);
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
  const [activeSection, setActiveSection] = useState<NavSectionId>('overview');
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [syncingNow, setSyncingNow] = useState(false);
  const [syncNonce, setSyncNonce] = useState(0);

  const isFlushingRef = useRef(false);
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

    const unsubCatalog = subscribeToPublicLocationCatalog(setLocationCatalog);

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
        setQueuedItems([]);
        setPasswordResetRequests([]);
        setLastUpdatedAt(null);
        setActiveSection('overview');
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

  // 4c. Attempt automatic sync of queued offline registrations when internet returns while signed out
  useEffect(() => {
    if (!isOnline || firebaseUser || pendingOfflineRegistrations.length === 0) return;
    const queued = pendingOfflineRegistrations.filter((r) => r.status === 'QUEUED_OFFLINE');
    if (queued.length === 0) return;

    let active = true;
    void (async () => {
      for (const reg of queued) {
        if (!active) break;
        const cachedPw = getEphemeralOfflinePassword(reg.id);
        if (!cachedPw) continue;
        try {
          await syncPendingOfflineRegistration(reg, cachedPw);
        } catch {
          // Recorded on the offline registration item cleanly
        }
      }
      if (active) {
        const refreshed = await getPendingOfflineRegistrations();
        setPendingOfflineRegistrations(refreshed);
      }
    })();

    return () => {
      active = false;
    };
  }, [isOnline, firebaseUser, pendingOfflineRegistrations]);

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
        const isNote = item.reportType === 'NOTE_UPSERT' || item.reportType === 'NOTE_DELETE';
        return isNote || pollingUnits.length > 0;
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
      const items = await fetchPublicLocationCatalog();
      setLocationCatalog(items);
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

  const handlePhoneSignIn = async (phoneNumber: string, password: string) => {
    setAuthError(null);
    await signInWithPhoneAndPassword(phoneNumber, password);
  };

  const handlePhoneRegister = async (input: {
    fullName: string;
    phone: string;
    password: string;
    confirmPassword: string;
    location: RegistrationLocationSelection;
  }) => {
    setAuthError(null);
    const res = await registerWithPhoneAndPassword(input);
    if (res.queuedOffline) {
      const regs = await getPendingOfflineRegistrations();
      setPendingOfflineRegistrations(regs);
    }
    return res;
  };

  const handleSyncPendingOfflineRegistration = async (
    reg: PendingOfflineRegistration,
    password?: string
  ) => {
    const rawPassword = password || getEphemeralOfflinePassword(reg.id) || '';
    if (!rawPassword) {
      throw new Error('Enter your chosen password to finalize offline registration sync.');
    }
    try {
      await syncPendingOfflineRegistration(reg, rawPassword);
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
        isOnline={isOnline}
        locationCatalog={locationCatalog}
        refreshingLocations={refreshingLocations}
        onRefreshLocations={handleRefreshLocations}
        pendingOfflineRegistrations={pendingOfflineRegistrations}
        hasEphemeralOfflinePassword={(regId) => Boolean(getEphemeralOfflinePassword(regId))}
        onPhoneSignIn={handlePhoneSignIn}
        onPhoneRegister={handlePhoneRegister}
        onGoogleSignIn={handleGoogleSignIn}
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

  return (
    <AppShell
      user={account}
      activeSection={activeSection}
      onSelectSection={setActiveSection}
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
          onRetryQueueItem={handleRetryQueueItem}
        />
      ) : null}

      {activeSection === 'notes' ? (
        <OperationalNotesPanel
          user={account}
          notes={mergedNotes}
          wards={wards}
          pollingUnits={pollingUnits}
          isOnline={isOnline}
          onRetrySync={() => void handleManualSync()}
          syncingNow={syncingNow}
        />
      ) : null}

      {activeSection === 'incidents' ? (
        <IncidentsPage
          user={account}
          pollingUnits={pollingUnits}
          incidents={incidents}
          queuedItems={queuedItems}
          isOnline={isOnline}
          onRetrySync={() => void handleManualSync()}
          syncingNow={syncingNow}
        />
      ) : null}

      {activeSection === 'results' ? (
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
          passwordResetRequests={passwordResetRequests}
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
          notes={mergedNotes}
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
