import { AlertTriangle, Check, Eye, Sparkles, X } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import type {
  Booking,
  ConflictResolutionResponse,
  Equipment,
  ProjectAccessRequest,
  ProjectRequestStatus,
  UserRole,
} from '../shared/types.js';
import { ApiClientError, resolveConflictApi, reviewProjectRequestApi } from '../client/api.js';
import { useModalFocusTrap } from '../client/useModalFocusTrap.js';

interface FacultyReviewViewProps {
  equipment: Equipment[];
  bookings: Booking[];
  projectRequests: ProjectAccessRequest[];
  today: string;
  role: UserRole;
  onStateMutated: (message: string) => void;
}

function daysBetween(startIso: string, endIso: string): number {
  const start = new Date(`${startIso}T12:00:00Z`).getTime();
  const end = new Date(`${endIso}T12:00:00Z`).getTime();
  return Math.round((end - start) / (1000 * 60 * 60 * 24));
}

function formatHour(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

function getStatusBadge(status: ProjectRequestStatus): { label: string; className: string } {
  if (status === 'approved') return { label: '● Approved', className: 'text-emerald-800' };
  if (status === 'rejected') return { label: '✖ Rejected', className: 'text-rose-800' };
  if (status === 'conflict') return { label: '▲ Conflict', className: 'text-amber-800' };
  if (status === 'cancelled') return { label: '✖ Cancelled', className: 'text-slate-600' };
  return { label: '▲ Pending Decision', className: 'text-amber-800' };
}

export function FacultyReviewView({
  equipment,
  bookings,
  projectRequests,
  today,
  role,
  onStateMutated,
}: FacultyReviewViewProps) {
  const [statusFilter, setStatusFilter] = useState<'all' | ProjectRequestStatus>('pending');
  const [reviewerName, setReviewerName] = useState('Dr. Aris Thorne');
  const [decisionNotes, setDecisionNotes] = useState<Record<string, string>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [inspectedRequestId, setInspectedRequestId] = useState<string | null>(null);
  const [adviceByRequestId, setAdviceByRequestId] = useState<
    Record<string, ConflictResolutionResponse>
  >({});
  const [adviceLoadingId, setAdviceLoadingId] = useState<string | null>(null);
  const [adviceError, setAdviceError] = useState<string | null>(null);

  const detailModalRef = useRef<HTMLDivElement | null>(null);

  const equipmentById = useMemo(() => new Map(equipment.map((e) => [e.id, e])), [equipment]);
  const bookingById = useMemo(() => new Map(bookings.map((b) => [b.id, b])), [bookings]);

  const inspectedRequest = useMemo(
    () => projectRequests.find((r) => r.id === inspectedRequestId) ?? null,
    [projectRequests, inspectedRequestId],
  );

  useModalFocusTrap(Boolean(inspectedRequest), detailModalRef, () => setInspectedRequestId(null));

  const counts = useMemo(() => {
    const pending = projectRequests.filter((r) => r.status === 'pending');
    const urgentPending = pending.filter((r) => daysBetween(today, r.projectDeadline) <= 3);
    const approved = projectRequests.filter((r) => r.status === 'approved');
    const rejected = projectRequests.filter((r) => r.status === 'rejected');
    const conflict = projectRequests.filter((r) => r.status === 'conflict');
    return {
      pending: pending.length,
      urgent: urgentPending.length,
      approved: approved.length,
      rejected: rejected.length,
      conflict: conflict.length,
    };
  }, [projectRequests, today]);

  const filteredRequests = useMemo(() => {
    return projectRequests
      .filter((r) => statusFilter === 'all' || r.status === statusFilter)
      .sort((a, b) => a.projectDeadline.localeCompare(b.projectDeadline));
  }, [projectRequests, statusFilter]);

  const handleDecision = async (requestId: string, decision: 'approved' | 'rejected') => {
    setActionError(null);
    const note = (decisionNotes[requestId] ?? '').trim();

    if (decision === 'rejected' && !note) {
      setFieldErrors((prev) => ({
        ...prev,
        [requestId]: 'Please enter a short rejection reason before rejecting.',
      }));
      const targetInputId =
        inspectedRequestId === requestId ? 'modal-decision-note' : `note-${requestId}`;
      document.getElementById(targetInputId)?.focus();
      return;
    }

    setFieldErrors((prev) => {
      const next = { ...prev };
      delete next[requestId];
      return next;
    });

    setProcessingId(requestId);
    try {
      const result = await reviewProjectRequestApi(requestId, decision, reviewerName, note, role);
      onStateMutated(
        decision === 'approved'
          ? `Approved ${result.request.projectTitle} and confirmed linked booking ${result.updatedBooking?.id ?? ''}.`
          : `Rejected ${result.request.projectTitle} and notified student with your reason.`,
      );
      if (inspectedRequestId === requestId) {
        setInspectedRequestId(null);
      }
    } catch (err: unknown) {
      if (err instanceof ApiClientError && err.code === 'SCHEDULE_CONFLICT') {
        setActionError(err.message);
        // Refresh parent snapshot so the request's updated 'conflict' status reflects in UI
        onStateMutated(`Approval blocked by scheduling conflict for request ${requestId}.`);
      } else {
        setActionError(err instanceof Error ? err.message : 'Unable to save faculty decision.');
      }
    } finally {
      setProcessingId(null);
    }
  };

  const handleLoadConflictAdvice = async (req: ProjectAccessRequest, eq?: Equipment) => {
    setAdviceError(null);
    setAdviceLoadingId(req.id);
    const startHour = req.preferredStartHour ?? eq?.openHour ?? 9;
    const rawEnd =
      req.preferredEndHour ?? Math.min(eq?.closeHour ?? 20, startHour + Math.min(4, req.requestedHours));
    const endHour = Math.min(rawEnd, startHour + 4);

    try {
      const result = await resolveConflictApi(
        {
          equipmentId: req.equipmentId,
          date: req.preferredDate,
          startHour,
          endHour,
          studentName: req.studentName,
          projectTitle: req.projectTitle,
          projectDescription: req.projectDescription,
          projectDeadline: req.projectDeadline,
          requirementsSummary: req.equipmentRequirements,
          requiredCapabilities: eq?.capabilities ?? [],
        },
        role,
      );
      setAdviceByRequestId((prev) => ({ ...prev, [req.id]: result }));
    } catch (err: unknown) {
      setAdviceError(
        err instanceof Error ? err.message : 'Unable to fetch conflict-resolution advice.',
      );
    } finally {
      setAdviceLoadingId(null);
    }
  };

  return (
    <section aria-labelledby="faculty-heading" className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 id="faculty-heading" className="text-2xl font-bold text-slate-900">
            Faculty Project Access Review Queue
          </h1>
          <p className="text-sm text-slate-600">
            Review student project requests, inspect equipment schedule availability, and approve or reject with deterministic conflict checks.
          </p>
        </div>

        <div className="space-y-1 shrink-0">
          <label htmlFor="faculty-reviewer-name" className="block text-xs font-medium text-slate-700">
            Reviewing Faculty Member
          </label>
          <input
            id="faculty-reviewer-name"
            type="text"
            value={reviewerName}
            onChange={(e) => setReviewerName(e.target.value)}
            className="px-3 py-2 text-sm bg-slate-50 border border-slate-300 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
        </div>
      </div>

      {/* KPI Summary Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {[
          { label: 'Pending Review', value: counts.pending, tone: 'text-amber-800' },
          { label: 'Urgent Deadlines (<=3d)', value: counts.urgent, tone: 'text-rose-800' },
          { label: 'Approved Requests', value: counts.approved, tone: 'text-emerald-800' },
          { label: 'Rejected Requests', value: counts.rejected, tone: 'text-slate-700' },
          { label: 'Conflicts', value: counts.conflict, tone: 'text-amber-800' },
        ].map((stat) => (
          <div key={stat.label} className="bg-white border border-slate-200 rounded-xl p-4 space-y-1">
            <p className="text-xs text-slate-600">{stat.label}</p>
            <p className={`text-2xl font-bold font-mono tabular-nums ${stat.tone}`}>{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Filter Tabs */}
      <div
        className="flex flex-wrap items-center gap-1 p-1 bg-slate-200/70 rounded-lg w-fit border border-slate-200"
        role="group"
        aria-label="Filter access requests by status"
      >
        {[
          { id: 'pending', label: `Pending (${counts.pending})` },
          { id: 'approved', label: `Approved (${counts.approved})` },
          { id: 'rejected', label: `Rejected (${counts.rejected})` },
          { id: 'conflict', label: `Conflict (${counts.conflict})` },
          { id: 'all', label: `All (${projectRequests.length})` },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            aria-pressed={statusFilter === tab.id}
            onClick={() => setStatusFilter(tab.id as 'all' | ProjectRequestStatus)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
              statusFilter === tab.id
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-700 hover:text-slate-900'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {actionError && (
        <div
          role="alert"
          className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-sm text-rose-800 flex items-start gap-2.5"
        >
          <AlertTriangle className="w-4 h-4 text-rose-700 shrink-0 mt-0.5" aria-hidden="true" />
          <span>{actionError}</span>
        </div>
      )}

      {filteredRequests.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-sm text-slate-600">
          No project access requests match the selected filter.
        </div>
      ) : (
        <div className="space-y-4">
          {filteredRequests.map((req) => {
            const eq = equipmentById.get(req.equipmentId);
            const linkedBooking = req.linkedBookingId ? bookingById.get(req.linkedBookingId) : undefined;
            const daysLeft = daysBetween(today, req.projectDeadline);
            const sameDayBookings = bookings.filter(
              (b) =>
                b.equipmentId === req.equipmentId &&
                b.date === req.preferredDate &&
                b.status !== 'cancelled' &&
                b.id !== req.linkedBookingId,
            );
            const canDecide = req.status === 'pending' || req.status === 'conflict';
            const statusBadge = getStatusBadge(req.status);
            const fieldError = fieldErrors[req.id];

            return (
              <article
                key={req.id}
                className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-4"
              >
                <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                  <div className="space-y-2 max-w-3xl">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-medium text-slate-700">
                        {req.studentName} · {req.department}
                      </span>
                      <span aria-hidden="true" className="text-slate-300">
                        ·
                      </span>
                      <span className="font-mono tabular-nums text-slate-600">
                        Deadline: {req.projectDeadline} ({daysLeft <= 0 ? 'Due Today' : `${daysLeft}d remaining`})
                      </span>
                      <span aria-hidden="true" className="text-slate-300">
                        ·
                      </span>
                      <span className={`font-semibold ${statusBadge.className}`}>
                        {statusBadge.label}
                      </span>
                      <span aria-hidden="true" className="text-slate-400">
                        ·
                      </span>
                      <span className="font-mono text-slate-600">{req.id}</span>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h2 className="text-lg font-bold text-slate-900">{req.projectTitle}</h2>
                      <button
                        type="button"
                        onClick={() => setInspectedRequestId(req.id)}
                        aria-label={`View full details for ${req.projectTitle}`}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-100 border border-slate-200 rounded-md hover:bg-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                      >
                        <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>View Full Details</span>
                      </button>
                    </div>

                    {req.projectDescription && (
                      <p className="text-sm text-slate-700 leading-relaxed">{req.projectDescription}</p>
                    )}

                    <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                      <span className="font-semibold text-slate-800">Purpose / Justification:</span>{' '}
                      {req.justification}
                    </p>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 text-xs text-slate-600">
                      <div>
                        <span className="font-semibold text-slate-800">Requested Equipment:</span>{' '}
                        {eq?.name ?? req.equipmentName ?? req.equipmentId} ({eq?.labLocation ?? req.labLocation ?? 'Campus Lab'})
                      </div>
                      <div>
                        <span className="font-semibold text-slate-800">Technical Scope:</span>{' '}
                        {req.equipmentRequirements}
                      </div>
                      <div className="font-mono tabular-nums">
                        <span className="font-sans font-semibold text-slate-800">Requested Date & Time:</span>{' '}
                        {linkedBooking
                          ? `${linkedBooking.date} ${formatHour(linkedBooking.startHour)}–${formatHour(linkedBooking.endHour)} (${linkedBooking.status})`
                          : req.preferredStartHour !== undefined && req.preferredEndHour !== undefined
                            ? `${req.preferredDate} ${formatHour(req.preferredStartHour)}–${formatHour(req.preferredEndHour)} (${req.requestedHours}h)`
                            : `${req.preferredDate} · ${req.requestedHours}h requested`}
                      </div>
                      <div>
                        <span className="font-semibold text-slate-800">Other Bookings That Day:</span>{' '}
                        {sameDayBookings.length === 0
                          ? 'None'
                          : sameDayBookings
                              .map((b) => `${formatHour(b.startHour)}–${formatHour(b.endHour)} (${b.studentName})`)
                              .join(', ')}
                      </div>
                    </div>
                  </div>

                  {canDecide ? (
                    <div className="w-full lg:w-76 space-y-2.5 shrink-0 border-t lg:border-t-0 lg:border-l border-slate-200 pt-4 lg:pt-0 lg:pl-5">
                      <label
                        htmlFor={`note-${req.id}`}
                        className="block text-xs font-medium text-slate-700"
                      >
                        Faculty Note / Rejection Reason
                      </label>
                      <input
                        id={`note-${req.id}`}
                        type="text"
                        maxLength={300}
                        placeholder="Optional for approve; required for reject"
                        value={decisionNotes[req.id] ?? ''}
                        aria-invalid={Boolean(fieldError)}
                        aria-describedby={fieldError ? `note-error-${req.id}` : undefined}
                        onChange={(e) => {
                          setDecisionNotes((prev) => ({ ...prev, [req.id]: e.target.value }));
                          if (fieldError) {
                            setFieldErrors((prev) => {
                              const next = { ...prev };
                              delete next[req.id];
                              return next;
                            });
                          }
                        }}
                        className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600 placeholder:text-slate-500"
                      />
                      {fieldError && (
                        <p id={`note-error-${req.id}`} role="alert" className="text-xs text-rose-800 font-medium">
                          {fieldError}
                        </p>
                      )}

                      <div className="flex items-center gap-2 pt-1">
                        <button
                          type="button"
                          disabled={processingId === req.id}
                          onClick={() => handleDecision(req.id, 'approved')}
                          aria-label={`Approve access request for ${req.projectTitle}`}
                          className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-emerald-700 rounded-lg hover:bg-emerald-800 transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
                        >
                          <Check className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>Approve</span>
                        </button>
                        <button
                          type="button"
                          disabled={processingId === req.id}
                          onClick={() => handleDecision(req.id, 'rejected')}
                          aria-label={`Reject access request for ${req.projectTitle}`}
                          className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-rose-800 bg-rose-50 border border-rose-200 rounded-lg hover:bg-rose-100 transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-600"
                        >
                          <X className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>Reject</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-slate-600 lg:w-64 lg:border-l border-slate-200 lg:pl-5 space-y-1 shrink-0">
                      <p className="font-semibold text-slate-800">
                        Reviewed by {req.facultyReviewer ?? 'Faculty'}
                      </p>
                      {req.facultyDecisionNote && <p>{req.facultyDecisionNote}</p>}
                      {linkedBooking && (
                        <p className="font-mono text-slate-600 pt-1">
                          Booking {linkedBooking.id}: {linkedBooking.status}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Individual Request Detail Modal */}
      {inspectedRequest && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-[1px] p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="faculty-detail-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setInspectedRequestId(null);
          }}
        >
          <div
            ref={detailModalRef}
            tabIndex={-1}
            className="bg-white border border-slate-200 rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto focus:outline-none"
          >
            <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-mono text-slate-600">
                  {inspectedRequest.id} · {getStatusBadge(inspectedRequest.status).label}
                </p>
                <h2 id="faculty-detail-title" className="text-lg font-bold text-slate-900 mt-0.5">
                  {inspectedRequest.projectTitle}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setInspectedRequestId(null)}
                aria-label="Close request details"
                className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
              >
                <X className="w-5 h-5" aria-hidden="true" />
              </button>
            </div>

            {(() => {
              const eq = equipmentById.get(inspectedRequest.equipmentId);
              const linked = inspectedRequest.linkedBookingId
                ? bookingById.get(inspectedRequest.linkedBookingId)
                : undefined;
              const sameDay = bookings.filter(
                (b) =>
                  b.equipmentId === inspectedRequest.equipmentId &&
                  b.date === inspectedRequest.preferredDate &&
                  b.status !== 'cancelled' &&
                  b.id !== inspectedRequest.linkedBookingId,
              );
              const canDecide =
                inspectedRequest.status === 'pending' || inspectedRequest.status === 'conflict';

              return (
                <div className="p-6 space-y-5 text-sm">
                  <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-50 border border-slate-200 rounded-lg p-4 text-xs">
                    <div>
                      <dt className="text-slate-600">Student & Department</dt>
                      <dd className="font-semibold text-slate-900 mt-0.5">
                        {inspectedRequest.studentName} · {inspectedRequest.department}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-600">Project Deadline</dt>
                      <dd className="font-mono font-semibold text-slate-900 mt-0.5">
                        {inspectedRequest.projectDeadline}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-600">Requested Equipment</dt>
                      <dd className="font-semibold text-slate-900 mt-0.5">
                        {eq?.name ?? inspectedRequest.equipmentName ?? inspectedRequest.equipmentId}
                      </dd>
                      <dd className="text-slate-600">
                        {eq?.labLocation ?? inspectedRequest.labLocation ?? 'Campus Lab'} · Status: {eq?.status ?? 'unknown'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-600">Requested Schedule</dt>
                      <dd className="font-mono font-semibold text-slate-900 mt-0.5">
                        {inspectedRequest.preferredDate}{' '}
                        {inspectedRequest.preferredStartHour !== undefined &&
                        inspectedRequest.preferredEndHour !== undefined
                          ? `${formatHour(inspectedRequest.preferredStartHour)}–${formatHour(inspectedRequest.preferredEndHour)}`
                          : `(${inspectedRequest.requestedHours}h)`}
                      </dd>
                      {eq && (
                        <dd className="text-slate-600 font-mono">
                          Lab hours: {formatHour(eq.openHour)}–{formatHour(eq.closeHour)}
                        </dd>
                      )}
                    </div>
                  </dl>

                  <div className="space-y-1">
                    <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wide">
                      Project Description
                    </h3>
                    <p className="text-slate-700 leading-relaxed">
                      {inspectedRequest.projectDescription}
                    </p>
                  </div>

                  <div className="space-y-1">
                    <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wide">
                      Purpose & Hardware Justification
                    </h3>
                    <p className="text-slate-700 leading-relaxed">{inspectedRequest.justification}</p>
                    <p className="text-xs text-slate-600">
                      Required Capabilities: {inspectedRequest.equipmentRequirements}
                    </p>
                  </div>

                  <div className="space-y-1.5 border-t border-slate-200 pt-4 text-xs">
                    <h3 className="font-semibold text-slate-800">
                      Availability & Booking Traceability
                    </h3>
                    <p className="text-slate-600">
                      Linked Booking:{' '}
                      <span className="font-mono text-slate-900">
                        {linked
                          ? `${linked.id} (${linked.status} · ${linked.date} ${formatHour(linked.startHour)}–${formatHour(linked.endHour)})`
                          : 'None yet (will create confirmed booking upon approval)'}
                      </span>
                    </p>
                    <p className="text-slate-600">
                      Other active bookings on {inspectedRequest.preferredDate}:{' '}
                      {sameDay.length === 0
                        ? 'None — slot window is clear.'
                        : sameDay
                            .map(
                              (b) =>
                                `${formatHour(b.startHour)}–${formatHour(b.endHour)} (${b.studentName})`,
                            )
                            .join(', ')}
                    </p>
                  </div>

                  {/* Advisory Conflict-Resolution Panel for Faculty */}
                  {(inspectedRequest.status === 'conflict' || sameDay.length > 0) && (
                    <div className="border border-slate-200 bg-slate-50 rounded-lg p-4 space-y-3 text-xs">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 font-semibold text-slate-900">
                          <Sparkles className="w-4 h-4 text-blue-600" aria-hidden="true" />
                          <span>Conflict Resolution Advice (Advisory Only)</span>
                        </div>
                        <button
                          type="button"
                          disabled={adviceLoadingId === inspectedRequest.id}
                          onClick={() => handleLoadConflictAdvice(inspectedRequest, eq)}
                          className="px-3 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                        >
                          {adviceLoadingId === inspectedRequest.id
                            ? 'Analyzing...'
                            : 'Check Conflict Resolution Advice'}
                        </button>
                      </div>

                      <p className="text-slate-600">
                        Deterministic scheduling checks still govern Faculty approval; AI suggestions never auto-approve requests.
                      </p>

                      {adviceError && (
                        <p role="alert" className="text-rose-700 font-medium">
                          {adviceError}
                        </p>
                      )}

                      {adviceByRequestId[inspectedRequest.id] && (() => {
                        const advice = adviceByRequestId[inspectedRequest.id];
                        if (!advice.conflict) {
                          return (
                            <p className="text-emerald-700 font-medium">
                              Requested window has no overlap with active bookings.
                            </p>
                          );
                        }
                        return (
                          <div className="space-y-2 pt-1">
                            {advice.recommendation ? (
                              <div className="bg-white border border-slate-200 rounded-md p-3 space-y-1.5">
                                <p className="font-semibold text-slate-900">
                                  Recommended Alternative: {advice.recommendation.slot.equipmentName} (
                                  {advice.recommendation.slot.date}{' '}
                                  {formatHour(advice.recommendation.slot.startHour)}–
                                  {formatHour(advice.recommendation.slot.endHour)}) · Confidence{' '}
                                  {Math.round(advice.recommendation.confidence * 100)}%
                                </p>
                                <p className="text-slate-700">{advice.recommendation.reason}</p>
                                <p className="text-slate-600">
                                  <span className="font-semibold text-slate-800">Fairness factors:</span>{' '}
                                  {advice.recommendation.fairnessExplanation}
                                </p>
                              </div>
                            ) : (
                              <p className="font-medium text-slate-800">
                                {advice.fallbackMessage ??
                                  'AI recommendation unavailable. Verified open alternatives are listed below.'}
                              </p>
                            )}
                            {advice.alternatives.length > 0 && (
                              <p className="text-slate-600">
                                Verified open options:{' '}
                                {advice.alternatives
                                  .slice(0, 3)
                                  .map(
                                    (alt) =>
                                      `${alt.equipmentName} ${alt.date} ${formatHour(alt.startHour)}–${formatHour(alt.endHour)}`,
                                  )
                                  .join(' | ')}
                              </p>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  )}

                  {canDecide && (
                    <div className="border-t border-slate-200 pt-4 space-y-3">
                      <div className="space-y-1.5">
                        <label
                          htmlFor="modal-decision-note"
                          className="block text-xs font-medium text-slate-700"
                        >
                          Faculty Note (optional for Approve) / Rejection Reason (required for Reject)
                        </label>
                        <input
                          id="modal-decision-note"
                          type="text"
                          maxLength={300}
                          value={decisionNotes[inspectedRequest.id] ?? ''}
                          aria-invalid={Boolean(fieldErrors[inspectedRequest.id])}
                          aria-describedby={
                            fieldErrors[inspectedRequest.id]
                              ? `modal-note-error-${inspectedRequest.id}`
                              : undefined
                          }
                          onChange={(e) => {
                            const nextVal = e.target.value;
                            setDecisionNotes((prev) => ({
                              ...prev,
                              [inspectedRequest.id]: nextVal,
                            }));
                            if (fieldErrors[inspectedRequest.id]) {
                              setFieldErrors((prev) => {
                                const next = { ...prev };
                                delete next[inspectedRequest.id];
                                return next;
                              });
                            }
                          }}
                          placeholder="Enter approval note or required rejection reason..."
                          className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 placeholder:text-slate-500"
                        />
                        {fieldErrors[inspectedRequest.id] && (
                          <p
                            id={`modal-note-error-${inspectedRequest.id}`}
                            role="alert"
                            className="text-xs text-rose-800 font-medium"
                          >
                            {fieldErrors[inspectedRequest.id]}
                          </p>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setInspectedRequestId(null)}
                          className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                        >
                          Close
                        </button>
                        <button
                          type="button"
                          disabled={processingId === inspectedRequest.id}
                          onClick={() => handleDecision(inspectedRequest.id, 'rejected')}
                          className="px-3.5 py-2 text-xs font-semibold text-rose-800 bg-rose-50 border border-rose-200 rounded-lg hover:bg-rose-100 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-600"
                        >
                          Reject with Reason
                        </button>
                        <button
                          type="button"
                          disabled={processingId === inspectedRequest.id}
                          onClick={() => handleDecision(inspectedRequest.id, 'approved')}
                          className="px-4 py-2 text-xs font-semibold text-white bg-emerald-700 rounded-lg hover:bg-emerald-800 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
                        >
                          Approve & Confirm Slot
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </section>
  );
}
