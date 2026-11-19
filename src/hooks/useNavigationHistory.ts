import { useCallback, useEffect, useRef, useState } from 'react';
import { UserRole, type UserAccount } from '../types/fdmis';
import { NAV_ITEMS, type NavSectionId } from '../components/AppShell';

const NAV_STORAGE_PREFIX = 'fdmis_nav_history_v1_';
const MAX_HISTORY_ENTRIES = 60;

export interface PersistedNavHistory {
  stack: NavSectionId[];
  index: number;
}

export function getDefaultHomeSection(role: UserRole | undefined | null): NavSectionId {
  return role === UserRole.FULL_CONTROL_ADMIN ? 'admin_home' : 'overview';
}

export function isSectionAllowedForRole(section: string | null | undefined, role: UserRole): section is NavSectionId {
  if (!section) return false;
  const item = NAV_ITEMS.find((n) => n.id === section);
  return Boolean(item && item.visible(role));
}

export function parseSectionFromUrl(search: string, hash: string): string | null {
  try {
    const params = new URLSearchParams(search);
    const fromQuery = params.get('section');
    if (fromQuery) return fromQuery;
  } catch {
    // ignore malformed query
  }
  if (hash && hash.startsWith('#/')) {
    const seg = hash.slice(2).split('?')[0].trim();
    if (seg) return seg;
  }
  return null;
}

export function buildSectionUrl(section: NavSectionId, defaultHome: NavSectionId): string {
  if (section === defaultHome) {
    return '/';
  }
  return `/?section=${encodeURIComponent(section)}`;
}

/**
 * Pure state-transition helper for pushing a new section onto the navigation stack.
 * Prevents duplicate consecutive entries and trims forward stack cleanly.
 */
export function pushNavHistory(
  current: PersistedNavHistory,
  nextSection: NavSectionId
): { next: PersistedNavHistory; changed: boolean } {
  const safeIndex = Math.max(0, Math.min(current.index, current.stack.length - 1));
  const active = current.stack[safeIndex];
  if (active === nextSection) {
    return { next: current, changed: false };
  }

  const truncated = current.stack.slice(0, safeIndex + 1);
  truncated.push(nextSection);
  const trimmed =
    truncated.length > MAX_HISTORY_ENTRIES
      ? truncated.slice(truncated.length - MAX_HISTORY_ENTRIES)
      : truncated;

  return {
    next: {
      stack: trimmed,
      index: trimmed.length - 1,
    },
    changed: true,
  };
}

/**
 * Pure state-transition helper for stepping back in navigation history.
 * Returns the exact previous section, or falls back safely to defaultHome
 * if the user opened a deep link directly with no prior stack.
 */
export function stepBackNavHistory(
  current: PersistedNavHistory,
  defaultHome: NavSectionId
): { next: PersistedNavHistory; targetSection: NavSectionId; usedHistoryPop: boolean } {
  const safeIndex = Math.max(0, Math.min(current.index, current.stack.length - 1));
  if (safeIndex > 0) {
    const nextIndex = safeIndex - 1;
    return {
      next: { stack: current.stack, index: nextIndex },
      targetSection: current.stack[nextIndex],
      usedHistoryPop: true,
    };
  }

  const active = current.stack[safeIndex];
  if (active !== defaultHome) {
    return {
      next: { stack: [defaultHome], index: 0 },
      targetSection: defaultHome,
      usedHistoryPop: false,
    };
  }

  return {
    next: current,
    targetSection: defaultHome,
    usedHistoryPop: false,
  };
}

function readPersistedHistory(uid: string, role: UserRole): PersistedNavHistory | null {
  if (typeof window === 'undefined') return null;
  const key = `${NAV_STORAGE_PREFIX}${uid}`;
  try {
    const raw = sessionStorage.getItem(key) || localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedNavHistory>;
    if (!Array.isArray(parsed.stack) || parsed.stack.length === 0) return null;
    const validStack = parsed.stack.filter((s): s is NavSectionId =>
      isSectionAllowedForRole(s, role)
    );
    if (validStack.length === 0) return null;
    const clampedIdx =
      typeof parsed.index === 'number'
        ? Math.max(0, Math.min(parsed.index, validStack.length - 1))
        : validStack.length - 1;
    return { stack: validStack, index: clampedIdx };
  } catch {
    return null;
  }
}

function writePersistedHistory(uid: string, history: PersistedNavHistory): void {
  if (typeof window === 'undefined') return;
  const key = `${NAV_STORAGE_PREFIX}${uid}`;
  const serialized = JSON.stringify(history);
  try {
    sessionStorage.setItem(key, serialized);
  } catch {
    // ignore storage quota errors
  }
  try {
    localStorage.setItem(key, serialized);
  } catch {
    // ignore storage quota errors
  }
}

export function clearPersistedNavHistory(uid?: string): void {
  if (typeof window === 'undefined') return;
  try {
    if (uid) {
      sessionStorage.removeItem(`${NAV_STORAGE_PREFIX}${uid}`);
      localStorage.removeItem(`${NAV_STORAGE_PREFIX}${uid}`);
      return;
    }
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (k && k.startsWith(NAV_STORAGE_PREFIX)) keys.push(k);
    }
    keys.forEach((k) => {
      localStorage.removeItem(k);
      sessionStorage.removeItem(k);
    });
  } catch {
    // ignore
  }
}

interface HistoryBrowserState {
  fdmisAuthenticated?: boolean;
  fdmisLocked?: boolean;
  section?: NavSectionId;
  stackIndex?: number;
}

export interface UseNavigationHistoryResult {
  activeSection: NavSectionId;
  defaultHomeSection: NavSectionId;
  visitedSections: ReadonlySet<NavSectionId>;
  canGoBack: boolean;
  previousSection: NavSectionId | null;
  previousSectionLabel: string | null;
  navigateTo: (section: NavSectionId) => void;
  goBack: () => void;
  resetNavigation: () => void;
}

export function useNavigationHistory(
  account: UserAccount | null,
  activeAuthorized: boolean
): UseNavigationHistoryResult {
  const defaultHome = getDefaultHomeSection(account?.role);
  const [navState, setNavState] = useState<PersistedNavHistory>({
    stack: [defaultHome],
    index: 0,
  });
  const [visitedSections, setVisitedSections] = useState<Set<NavSectionId>>(
    () => new Set([defaultHome])
  );

  const navStateRef = useRef<PersistedNavHistory>(navState);
  navStateRef.current = navState;

  const initializedUidRef = useRef<string | null>(null);
  const scrollBySectionRef = useRef<Map<NavSectionId, number>>(new Map());
  const pendingScrollRestoreRef = useRef<NavSectionId | null>(null);

  const activeSection =
    navState.stack[Math.max(0, Math.min(navState.index, navState.stack.length - 1))] ||
    defaultHome;

  const saveCurrentScroll = useCallback((section: NavSectionId) => {
    if (typeof window === 'undefined') return;
    scrollBySectionRef.current.set(section, window.scrollY || 0);
  }, []);

  const scheduleScrollRestore = useCallback((section: NavSectionId, resetToTop = false) => {
    if (typeof window === 'undefined') return;
    pendingScrollRestoreRef.current = section;
    const savedY = resetToTop ? 0 : (scrollBySectionRef.current.get(section) ?? 0);
    window.requestAnimationFrame(() => {
      if (pendingScrollRestoreRef.current === section) {
        window.scrollTo({ top: savedY, behavior: 'auto' });
        pendingScrollRestoreRef.current = null;
      }
    });
  }, []);

  // Initialize navigation state & URL sync when an authorized user session becomes active
  useEffect(() => {
    if (!account || !activeAuthorized) {
      initializedUidRef.current = null;
      const fallbackHome: NavSectionId = 'overview';
      setNavState({ stack: [fallbackHome], index: 0 });
      setVisitedSections(new Set([fallbackHome]));
      scrollBySectionRef.current.clear();
      return;
    }

    const sessionKey = `${account.uid}:${account.role}`;
    if (initializedUidRef.current === sessionKey) {
      // Still ensure current active section remains permitted if role updated
      if (!isSectionAllowedForRole(navStateRef.current.stack[navStateRef.current.index], account.role)) {
        const home = getDefaultHomeSection(account.role);
        const reset: PersistedNavHistory = { stack: [home], index: 0 };
        setNavState(reset);
        setVisitedSections(new Set([home]));
        writePersistedHistory(account.uid, reset);
        window.history.replaceState(
          { fdmisAuthenticated: true, section: home, stackIndex: 0 } satisfies HistoryBrowserState,
          '',
          buildSectionUrl(home, home)
        );
      }
      return;
    }

    initializedUidRef.current = sessionKey;
    const home = getDefaultHomeSection(account.role);
    const urlSection = parseSectionFromUrl(window.location.search, window.location.hash);
    const persisted = readPersistedHistory(account.uid, account.role);

    let initialHistory: PersistedNavHistory;
    if (urlSection && isSectionAllowedForRole(urlSection, account.role)) {
      if (persisted && persisted.stack[persisted.index] === urlSection) {
        initialHistory = persisted;
      } else if (urlSection === home) {
        initialHistory = { stack: [home], index: 0 };
      } else {
        // Deep-linked directly to a module page: place home safely underneath as fallback
        initialHistory = { stack: [home, urlSection], index: 1 };
      }
    } else if (persisted) {
      initialHistory = persisted;
    } else {
      initialHistory = { stack: [home], index: 0 };
    }

    const initialSection = initialHistory.stack[initialHistory.index];
    setNavState(initialHistory);
    setVisitedSections(new Set([initialSection]));
    writePersistedHistory(account.uid, initialHistory);

    // Ensure browser history has a clean base state (and a home state beneath deep links so browser/Android Back works)
    if (initialHistory.index > 0 && initialHistory.stack.length >= 2) {
      const prevIdx = initialHistory.index - 1;
      const prevSec = initialHistory.stack[prevIdx];
      window.history.replaceState(
        {
          fdmisAuthenticated: true,
          section: prevSec,
          stackIndex: prevIdx,
        } satisfies HistoryBrowserState,
        '',
        buildSectionUrl(prevSec, home)
      );
      window.history.pushState(
        {
          fdmisAuthenticated: true,
          section: initialSection,
          stackIndex: initialHistory.index,
        } satisfies HistoryBrowserState,
        '',
        buildSectionUrl(initialSection, home)
      );
    } else {
      window.history.replaceState(
        {
          fdmisAuthenticated: true,
          section: initialSection,
          stackIndex: initialHistory.index,
        } satisfies HistoryBrowserState,
        '',
        buildSectionUrl(initialSection, home)
      );
    }
  }, [account, activeAuthorized]);

  // Listen to Browser Back / Forward and Android hardware Back button (popstate)
  useEffect(() => {
    if (!account || !activeAuthorized) return;
    const role = account.role;
    const uid = account.uid;
    const home = getDefaultHomeSection(role);

    const handlePopState = (event: PopStateEvent) => {
      const current = navStateRef.current;
      const currentActive = current.stack[current.index] || home;
      saveCurrentScroll(currentActive);

      const state = (event.state || null) as HistoryBrowserState | null;

      // Guard against popped locked/unauthenticated history state
      if (state?.fdmisLocked) {
        const reset: PersistedNavHistory = { stack: [home], index: 0 };
        setNavState(reset);
        setVisitedSections((prev) => new Set(prev).add(home));
        writePersistedHistory(uid, reset);
        window.history.replaceState(
          { fdmisAuthenticated: true, section: home, stackIndex: 0 } satisfies HistoryBrowserState,
          '',
          buildSectionUrl(home, home)
        );
        scheduleScrollRestore(home);
        return;
      }

      if (state?.section && isSectionAllowedForRole(state.section, role)) {
        let nextHistory: PersistedNavHistory;
        if (
          typeof state.stackIndex === 'number' &&
          state.stackIndex >= 0 &&
          state.stackIndex < current.stack.length &&
          current.stack[state.stackIndex] === state.section
        ) {
          nextHistory = { stack: current.stack, index: state.stackIndex };
        } else {
          // Reconcile if browser jumped forward/back across reload boundary
          const foundIdx = current.stack.lastIndexOf(state.section);
          if (foundIdx >= 0) {
            nextHistory = { stack: current.stack, index: foundIdx };
          } else {
            nextHistory = { stack: [home, state.section], index: state.section === home ? 0 : 1 };
          }
        }
        setNavState(nextHistory);
        setVisitedSections((prev) => new Set(prev).add(state.section!));
        writePersistedHistory(uid, nextHistory);
        scheduleScrollRestore(state.section);
        return;
      }

      // Fallback: inspect URL query/hash, else step back safely
      const fromUrl = parseSectionFromUrl(window.location.search, window.location.hash);
      if (fromUrl && isSectionAllowedForRole(fromUrl, role)) {
        const foundIdx = current.stack.lastIndexOf(fromUrl);
        const nextHistory: PersistedNavHistory =
          foundIdx >= 0
            ? { stack: current.stack, index: foundIdx }
            : { stack: [home, fromUrl], index: fromUrl === home ? 0 : 1 };
        setNavState(nextHistory);
        setVisitedSections((prev) => new Set(prev).add(fromUrl));
        writePersistedHistory(uid, nextHistory);
        scheduleScrollRestore(fromUrl);
        return;
      }

      const stepped = stepBackNavHistory(current, home);
      setNavState(stepped.next);
      setVisitedSections((prev) => new Set(prev).add(stepped.targetSection));
      writePersistedHistory(uid, stepped.next);
      scheduleScrollRestore(stepped.targetSection);
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [account, activeAuthorized, saveCurrentScroll, scheduleScrollRestore]);

  const navigateTo = useCallback(
    (section: NavSectionId) => {
      if (!account || !activeAuthorized) return;
      if (!isSectionAllowedForRole(section, account.role)) return;

      const home = getDefaultHomeSection(account.role);
      const current = navStateRef.current;
      const currentActive = current.stack[current.index] || home;

      if (section === currentActive) {
        return;
      }

      saveCurrentScroll(currentActive);
      const { next, changed } = pushNavHistory(current, section);
      if (!changed) return;

      setNavState(next);
      setVisitedSections((prev) => {
        if (prev.has(section)) return prev;
        const copy = new Set(prev);
        copy.add(section);
        return copy;
      });
      writePersistedHistory(account.uid, next);

      window.history.pushState(
        {
          fdmisAuthenticated: true,
          section,
          stackIndex: next.index,
        } satisfies HistoryBrowserState,
        '',
        buildSectionUrl(section, home)
      );

      scheduleScrollRestore(section, true);
    },
    [account, activeAuthorized, saveCurrentScroll, scheduleScrollRestore]
  );

  const goBack = useCallback(() => {
    if (!account || !activeAuthorized) return;
    const home = getDefaultHomeSection(account.role);
    const current = navStateRef.current;
    const currentActive = current.stack[current.index] || home;

    saveCurrentScroll(currentActive);

    const browserState = window.history.state as HistoryBrowserState | null;
    if (
      current.index > 0 &&
      browserState?.fdmisAuthenticated &&
      typeof browserState.stackIndex === 'number' &&
      browserState.stackIndex > 0
    ) {
      // Keep browser history, Android Back, and in-app stack in exact lockstep
      window.history.back();
      return;
    }

    const stepped = stepBackNavHistory(current, home);
    setNavState(stepped.next);
    setVisitedSections((prev) => new Set(prev).add(stepped.targetSection));
    writePersistedHistory(account.uid, stepped.next);

    window.history.replaceState(
      {
        fdmisAuthenticated: true,
        section: stepped.targetSection,
        stackIndex: stepped.next.index,
      } satisfies HistoryBrowserState,
      '',
      buildSectionUrl(stepped.targetSection, home)
    );
    scheduleScrollRestore(stepped.targetSection);
  }, [account, activeAuthorized, saveCurrentScroll, scheduleScrollRestore]);

  const resetNavigation = useCallback(() => {
    if (account?.uid) {
      clearPersistedNavHistory(account.uid);
    }
    initializedUidRef.current = null;
    scrollBySectionRef.current.clear();
    setNavState({ stack: ['overview'], index: 0 });
    setVisitedSections(new Set(['overview']));
  }, [account?.uid]);

  const previousSection: NavSectionId | null =
    navState.index > 0
      ? navState.stack[navState.index - 1]
      : activeSection !== defaultHome
        ? defaultHome
        : null;

  const canGoBack = previousSection !== null;

  const previousSectionLabel = previousSection
    ? NAV_ITEMS.find((n) => n.id === previousSection)?.label || 'Home'
    : null;

  return {
    activeSection,
    defaultHomeSection: defaultHome,
    visitedSections,
    canGoBack,
    previousSection,
    previousSectionLabel,
    navigateTo,
    goBack,
    resetNavigation,
  };
}
