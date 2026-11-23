import { CheckCircle2, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { Equipment, LabLinkStateSnapshot, UserRole } from './shared/types.js';
import { fetchLabLinkState, resetDemoState } from './client/api.js';
import { AdminConsoleView } from './components/AdminConsoleView.js';
import { BookingDrawer } from './components/BookingDrawer.js';
import { EquipmentCatalog } from './components/EquipmentCatalog.js';
import { FacultyReviewView } from './components/FacultyReviewView.js';
import { StudentScheduleView } from './components/StudentScheduleView.js';
import { TopBar } from './components/TopBar.js';

export default function App() {
  const [role, setRole] = useState<UserRole>('student');
  const [studentTab, setStudentTab] = useState<'catalog' | 'schedule'>('catalog');
  const [state, setState] = useState<LabLinkStateSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isResetting, setIsResetting] = useState(false);

  const [selectedEquipment, setSelectedEquipment] = useState<Equipment | null>(null);
  const [presetConflictDemo, setPresetConflictDemo] = useState(false);
  const [requestPreselectId, setRequestPreselectId] = useState<string | null>(null);
  const [autoOpenRequestForm, setAutoOpenRequestForm] = useState(false);
  const [bannerMessage, setBannerMessage] = useState<string | null>(null);

  const loadState = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const snapshot = await fetchLabLinkState();
      setState(snapshot);
    } catch (err: unknown) {
      setLoadError(err instanceof Error ? err.message : 'Unable to load LabLink workspace.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadState();
  }, [loadState]);

  const handleStateMutated = async (message: string) => {
    setBannerMessage(message);
    try {
      const snapshot = await fetchLabLinkState();
      setState(snapshot);
    } catch {
      // Keep current state if background refresh fails
    }
  };

  const handleResetDemo = async () => {
    setIsResetting(true);
    try {
      const fresh = await resetDemoState();
      setState(fresh);
      setSelectedEquipment(null);
      setPresetConflictDemo(false);
      setBannerMessage('Demo dataset restored to initial campus state.');
    } catch (err: unknown) {
      setBannerMessage(err instanceof Error ? err.message : 'Failed to reset demo data.');
    } finally {
      setIsResetting(false);
    }
  };

  const handleSimulateConflictDemo = () => {
    if (!state) return;
    const flagship =
      state.equipment.find((eq) => eq.id === 'eq-ur5e-arm') ??
      state.equipment.find((eq) => eq.status !== 'maintenance') ??
      state.equipment[0];
    if (!flagship) return;
    setPresetConflictDemo(true);
    setSelectedEquipment(flagship);
  };

  const pendingFacultyCount =
    state?.projectRequests.filter((r) => r.status === 'pending').length ?? 0;

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      <TopBar
        role={role}
        onRoleChange={(nextRole) => {
          setRole(nextRole);
          setSelectedEquipment(null);
          const roleLabel =
            nextRole === 'admin' ? 'Lab Admin' : nextRole === 'faculty' ? 'Faculty' : 'Student';
          setBannerMessage(`Switched active demo view to ${roleLabel}.`);
        }}
        onResetDemo={handleResetDemo}
        isResetting={isResetting}
        pendingFacultyCount={pendingFacultyCount}
      />

      <main
        id="main-content"
        tabIndex={-1}
        className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6 focus:outline-none"
      >
        {bannerMessage && (
          <div
            role="status"
            aria-live="polite"
            className="bg-white border border-slate-300 rounded-xl px-4 py-3 flex items-center justify-between gap-3 text-sm text-slate-900"
          >
            <div className="flex items-center gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-800 shrink-0" aria-hidden="true" />
              <span>{bannerMessage}</span>
            </div>
            <button
              type="button"
              onClick={() => setBannerMessage(null)}
              aria-label="Dismiss status notification"
              className="p-1.5 text-slate-600 hover:text-slate-900 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        )}

        {loading && (
          <div
            role="status"
            aria-live="polite"
            aria-label="Loading LabLink data"
            className="space-y-4 animate-pulse"
          >
            <p className="sr-only">Loading campus laboratory catalog and schedule...</p>
            <div className="h-36 bg-white border border-slate-200 rounded-xl" />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="h-80 bg-white border border-slate-200 rounded-xl" />
              <div className="h-80 bg-white border border-slate-200 rounded-xl" />
              <div className="h-80 bg-white border border-slate-200 rounded-xl" />
            </div>
          </div>
        )}

        {loadError && !loading && (
          <div role="alert" className="bg-white border border-rose-300 rounded-xl p-6 space-y-3">
            <h1 className="text-base font-semibold text-rose-900">Unable to load LabLink data</h1>
            <p className="text-sm text-rose-800">{loadError}</p>
            <button
              type="button"
              onClick={loadState}
              className="px-4 py-2 text-sm font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
            >
              Retry loading workspace
            </button>
          </div>
        )}

        {state && !loading && (
          <>
            {role === 'student' && (
              <div className="space-y-6">
                <div
                  className="flex flex-wrap items-center gap-1 p-1 bg-slate-200/70 rounded-lg border border-slate-300 w-fit"
                  role="tablist"
                  aria-label="Student workspace sections"
                >
                  <button
                    id="student-tab-catalog"
                    type="button"
                    role="tab"
                    aria-selected={studentTab === 'catalog'}
                    aria-controls="student-tabpanel"
                    onClick={() => setStudentTab('catalog')}
                    className={`px-3.5 py-1.5 text-xs sm:text-sm rounded-md transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                      studentTab === 'catalog'
                        ? 'bg-white text-slate-900 font-semibold shadow-xs border border-slate-300'
                        : 'text-slate-700 font-medium hover:text-slate-900'
                    }`}
                  >
                    Equipment Catalog
                  </button>
                  <button
                    id="student-tab-schedule"
                    type="button"
                    role="tab"
                    aria-selected={studentTab === 'schedule'}
                    aria-controls="student-tabpanel"
                    onClick={() => setStudentTab('schedule')}
                    className={`px-3.5 py-1.5 text-xs sm:text-sm rounded-md transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                      studentTab === 'schedule'
                        ? 'bg-white text-slate-900 font-semibold shadow-xs border border-slate-300'
                        : 'text-slate-700 font-medium hover:text-slate-900'
                    }`}
                  >
                    Bookings & Requests ({state.bookings.filter((b) => b.status !== 'cancelled').length})
                  </button>
                </div>

                <div
                  id="student-tabpanel"
                  role="tabpanel"
                  aria-labelledby={
                    studentTab === 'catalog' ? 'student-tab-catalog' : 'student-tab-schedule'
                  }
                >
                  {studentTab === 'catalog' ? (
                    <EquipmentCatalog
                      equipment={state.equipment}
                      bookings={state.bookings}
                      today={state.today}
                      onSelectEquipment={(eq) => {
                        setPresetConflictDemo(false);
                        setSelectedEquipment(eq);
                      }}
                      onSimulateConflictDemo={handleSimulateConflictDemo}
                    />
                  ) : (
                    <StudentScheduleView
                      equipment={state.equipment}
                      bookings={state.bookings}
                      projectRequests={state.projectRequests}
                      today={state.today}
                      tomorrow={state.tomorrow}
                      role={role}
                      preselectedEquipmentId={requestPreselectId}
                      autoOpenRequestForm={autoOpenRequestForm}
                      onClearPreselectedRequest={() => {
                        setRequestPreselectId(null);
                        setAutoOpenRequestForm(false);
                      }}
                      onStateMutated={handleStateMutated}
                      onOpenEquipment={(eq) => {
                        setPresetConflictDemo(false);
                        setSelectedEquipment(eq);
                      }}
                    />
                  )}
                </div>
              </div>
            )}

            {role === 'faculty' && (
              <FacultyReviewView
                equipment={state.equipment}
                bookings={state.bookings}
                projectRequests={state.projectRequests}
                today={state.today}
                role={role}
                onStateMutated={handleStateMutated}
              />
            )}

            {role === 'admin' && (
              <AdminConsoleView
                equipment={state.equipment}
                bookings={state.bookings}
                projectRequests={state.projectRequests}
                utilization={state.utilization}
                role={role}
                onStateMutated={handleStateMutated}
              />
            )}
          </>
        )}
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-600">
          <span>LabLink — Campus Laboratory Resource Sharing</span>
          <span>Demo session uses ephemeral server memory · Reset anytime from top bar</span>
        </div>
      </footer>

      {state && (
        <BookingDrawer
          equipment={selectedEquipment}
          allEquipment={state.equipment}
          bookings={state.bookings}
          today={state.today}
          tomorrow={state.tomorrow}
          role={role}
          presetConflictDemo={presetConflictDemo}
          onClose={() => {
            setSelectedEquipment(null);
            setPresetConflictDemo(false);
          }}
          onSwitchEquipment={(eq) => {
            setPresetConflictDemo(false);
            setSelectedEquipment(eq);
          }}
          onBookingCreated={handleStateMutated}
          onRequestProjectAccess={(eq) => {
            setSelectedEquipment(null);
            setPresetConflictDemo(false);
            setRequestPreselectId(eq.id);
            setAutoOpenRequestForm(true);
            setStudentTab('schedule');
          }}
        />
      )}
    </div>
  );
}
