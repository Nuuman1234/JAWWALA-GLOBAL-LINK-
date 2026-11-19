import { useState } from 'react';
import { BarChart3, FileBarChart2 } from 'lucide-react';
import { AnalyticsReportsPage } from './AnalyticsReportsPage';
import { ReportsCenterPage } from './ReportsCenterPage';
import type {
  AgentCheckIn,
  ApprovedPuResult,
  GeneratedReportRecord,
  IncidentReport,
  OfflineQueuedItem,
  OperationalNote,
  OperationalTask,
  PartyCode,
  PartyConfig,
  PollingUnit,
  ResultSubmission,
  UserAccount,
  Ward,
} from '../types/fdmis';

interface EnhancedReportsPageProps {
  user: UserAccount;
  users: UserAccount[];
  wards: Ward[];
  pollingUnits: PollingUnit[];
  checkIns: AgentCheckIn[];
  incidents: IncidentReport[];
  results: ResultSubmission[];
  approvedPuResults: ApprovedPuResult[];
  partyConfigs: Record<PartyCode, PartyConfig | null>;
  tasks: OperationalTask[];
  notes: OperationalNote[];
  generatedReports: GeneratedReportRecord[];
  queuedItems: OfflineQueuedItem[];
  isOnline: boolean;
  lastUpdatedAt: Date | null;
  syncingNow: boolean;
  onRetrySync: () => void;
}

export function EnhancedReportsPage(props: EnhancedReportsPageProps) {
  const [activeTab, setActiveTab] = useState<'analytics' | 'standard'>('analytics');

  return (
    <div className="space-y-5">
      {/* Mode switcher (hidden when printing) */}
      <div className="no-print flex flex-col gap-3 border-b border-slate-200 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
            FDMIS Intelligence & Documentation
          </p>
          <h2 className="mt-0.5 font-display text-2xl font-bold tracking-tight text-slate-900">
            Reports & Exports
          </h2>
        </div>

        <div
          role="tablist"
          aria-label="Report Workspace Mode"
          className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-1"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'analytics'}
            onClick={() => setActiveTab('analytics')}
            className={`inline-flex min-h-[38px] items-center gap-2 rounded-md px-3.5 py-1.5 text-xs font-semibold transition-colors ${
              activeTab === 'analytics'
                ? 'bg-white text-[#0b3b24] shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <BarChart3 className="h-4 w-4" aria-hidden="true" />
            <span>Automatic Reports & Analytics</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'standard'}
            onClick={() => setActiveTab('standard')}
            className={`inline-flex min-h-[38px] items-center gap-2 rounded-md px-3.5 py-1.5 text-xs font-semibold transition-colors ${
              activeTab === 'standard'
                ? 'bg-white text-[#0b3b24] shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <FileBarChart2 className="h-4 w-4" aria-hidden="true" />
            <span>Situation CSV & Exports</span>
          </button>
        </div>
      </div>

      {/* Keep both sub-tabs mounted once toggled? Simple conditional is fine since parent stays mounted in AppShell */}
      <div className={activeTab === 'analytics' ? 'block' : 'hidden print:hidden'}>
        <AnalyticsReportsPage
          user={props.user}
          users={props.users}
          wards={props.wards}
          pollingUnits={props.pollingUnits}
          checkIns={props.checkIns}
          incidents={props.incidents}
          results={props.results}
          approvedPuResults={props.approvedPuResults}
          tasks={props.tasks}
          notes={props.notes}
          generatedReports={props.generatedReports}
          queuedItems={props.queuedItems}
          isOnline={props.isOnline}
          lastUpdatedAt={props.lastUpdatedAt}
          syncingNow={props.syncingNow}
          onRetrySync={props.onRetrySync}
        />
      </div>

      <div className={activeTab === 'standard' ? 'block' : 'hidden print:hidden'}>
        <ReportsCenterPage
          user={props.user}
          wards={props.wards}
          pollingUnits={props.pollingUnits}
          checkIns={props.checkIns}
          incidents={props.incidents}
          results={props.results}
          approvedPuResults={props.approvedPuResults}
          partyConfigs={props.partyConfigs}
        />
      </div>
    </div>
  );
}
