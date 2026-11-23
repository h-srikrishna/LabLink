import { CheckCircle2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type {
  Booking,
  Equipment,
  ProjectAccessRequest,
  UserRole,
} from '../shared/types.js';
import { cancelBookingApi, createProjectRequestApi } from '../client/api.js';

interface StudentScheduleViewProps {
  equipment: Equipment[];
  bookings: Booking[];
  projectRequests: ProjectAccessRequest[];
  today: string;
  tomorrow: string;
  role: UserRole;
  preselectedEquipmentId?: string | null;
  autoOpenRequestForm?: boolean;
  onClearPreselectedRequest?: () => void;
  onStateMutated: (message: string) => void;
  onOpenEquipment: (equipment: Equipment) => void;
}

function formatHour(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

function renderBookingStatus(status: Booking['status']): { label: string; className: string } {
  if (status === 'confirmed') return { label: '● Confirmed', className: 'text-emerald-800' };
  if (status === 'pending_faculty') return { label: '▲ Pending Faculty', className: 'text-amber-800' };
  return { label: '✖ Cancelled', className: 'text-slate-600' };
}

function renderRequestStatus(status: ProjectAccessRequest['status']): { label: string; className: string } {
  if (status === 'approved') return { label: '● Approved', className: 'text-emerald-800' };
  if (status === 'rejected') return { label: '✖ Rejected', className: 'text-rose-800' };
  if (status === 'conflict') return { label: '▲ Scheduling Conflict', className: 'text-amber-800' };
  if (status === 'cancelled') return { label: '✖ Cancelled', className: 'text-slate-600' };
  return { label: '▲ Pending Faculty Review', className: 'text-amber-800' };
}

export function StudentScheduleView({
  equipment,
  bookings,
  projectRequests,
  today,
  tomorrow,
  role,
  preselectedEquipmentId,
  autoOpenRequestForm = false,
  onClearPreselectedRequest,
  onStateMutated,
  onOpenEquipment,
}: StudentScheduleViewProps) {
  const [showRequestForm, setShowRequestForm] = useState(autoOpenRequestForm);
  const [reqEquipmentId, setReqEquipmentId] = useState(preselectedEquipmentId || (equipment[0]?.id ?? ''));
  const [studentName, setStudentName] = useState('Jordan Rivera');
  const [department, setDepartment] = useState('Robotics & Mechatronics');
  const [projectTitle, setProjectTitle] = useState('');
  const [projectDescription, setProjectDescription] = useState('');
  const [projectDeadline, setProjectDeadline] = useState(tomorrow);
  const [preferredDate, setPreferredDate] = useState(today);
  const [preferredStartHour, setPreferredStartHour] = useState(10);
  const [preferredEndHour, setPreferredEndHour] = useState(12);
  const [equipmentRequirements, setEquipmentRequirements] = useState('');
  const [justification, setJustification] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [createdBanner, setCreatedBanner] = useState<{
    id: string;
    title: string;
    status: ProjectAccessRequest['status'];
    linkedBookingId?: string;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const clearFieldError = (fieldKey: string) => {
    setFieldErrors((prev) => {
      if (!prev[fieldKey]) return prev;
      const next = { ...prev };
      delete next[fieldKey];
      return next;
    });
  };

  const equipmentById = useMemo(
    () => new Map(equipment.map((eq) => [eq.id, eq])),
    [equipment],
  );

  const selectedEquipment = equipmentById.get(reqEquipmentId) ?? equipment[0];

  useEffect(() => {
    if (preselectedEquipmentId && equipmentById.has(preselectedEquipmentId)) {
      setReqEquipmentId(preselectedEquipmentId);
    }
    if (autoOpenRequestForm) {
      setShowRequestForm(true);
    }
    if (preselectedEquipmentId || autoOpenRequestForm) {
      onClearPreselectedRequest?.();
    }
  }, [preselectedEquipmentId, autoOpenRequestForm, equipmentById, onClearPreselectedRequest]);

  // Keep preferred start/end times synchronized within the selected equipment's operating hours
  useEffect(() => {
    if (!selectedEquipment) return;
    if (preferredStartHour < selectedEquipment.openHour || preferredStartHour >= selectedEquipment.closeHour) {
      const nextStart = selectedEquipment.openHour;
      setPreferredStartHour(nextStart);
      setPreferredEndHour(Math.min(selectedEquipment.closeHour, nextStart + 2));
    } else if (preferredEndHour <= preferredStartHour || preferredEndHour > selectedEquipment.closeHour) {
      setPreferredEndHour(Math.min(selectedEquipment.closeHour, preferredStartHour + 2));
    }
  }, [selectedEquipment?.id, selectedEquipment?.openHour, selectedEquipment?.closeHour]);

  const startHoursList = useMemo(() => {
    if (!selectedEquipment) return [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
    const hours: number[] = [];
    for (let h = selectedEquipment.openHour; h < selectedEquipment.closeHour; h += 1) {
      hours.push(h);
    }
    return hours;
  }, [selectedEquipment]);

  const endHoursList = useMemo(() => {
    const closeHour = selectedEquipment?.closeHour ?? 20;
    const maxEnd = Math.min(closeHour, preferredStartHour + 8);
    const hours: number[] = [];
    for (let h = preferredStartHour + 1; h <= maxEnd; h += 1) {
      hours.push(h);
    }
    return hours;
  }, [selectedEquipment, preferredStartHour]);

  const handleCancelBooking = async (bookingId: string) => {
    setCancellingId(bookingId);
    try {
      await cancelBookingApi(bookingId, role);
      onStateMutated('Booking cancelled and slot released back to the catalog.');
    } catch (err: unknown) {
      onStateMutated(err instanceof Error ? err.message : 'Unable to cancel booking.');
    } finally {
      setCancellingId(null);
    }
  };

  const handleSubmitRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setCreatedBanner(null);

    const nextErrors: Record<string, string> = {};
    if (!studentName.trim()) {
      nextErrors.studentName = 'Enter a student or project reference.';
    }
    if (!projectTitle.trim()) {
      nextErrors.projectTitle = 'Enter a project title.';
    }
    if (!projectDescription.trim()) {
      nextErrors.projectDescription = 'Enter a concise project description.';
    }
    if (!preferredDate) {
      nextErrors.preferredDate = 'Select a preferred date.';
    }
    if (preferredEndHour <= preferredStartHour) {
      nextErrors.preferredEndHour = 'Preferred end time must be after preferred start time.';
    }
    if (!projectDeadline) {
      nextErrors.projectDeadline = 'Select a project deadline.';
    }
    if (!justification.trim()) {
      nextErrors.justification = 'Explain why this hardware is required and note lab safety readiness.';
    }

    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors(nextErrors);
      setFormError('Please review and complete the highlighted required fields.');
      const fieldIdMap: Array<[string, string]> = [
        ['studentName', 'req-student'],
        ['projectTitle', 'req-project-title'],
        ['projectDescription', 'req-project-description'],
        ['preferredDate', 'req-preferred-date'],
        ['preferredEndHour', 'req-end-hour'],
        ['projectDeadline', 'req-deadline'],
        ['justification', 'req-justification'],
      ];
      const firstInvalid = fieldIdMap.find(([key]) => Boolean(nextErrors[key]));
      if (firstInvalid) {
        document.getElementById(firstInvalid[1])?.focus();
      }
      return;
    }

    setFieldErrors({});
    setSubmitting(true);
    const effectiveEquipmentId = selectedEquipment?.id ?? reqEquipmentId;
    try {
      const result = await createProjectRequestApi(
        {
          equipmentId: effectiveEquipmentId,
          studentName: studentName.trim(),
          department,
          projectTitle: projectTitle.trim(),
          projectDescription: projectDescription.trim(),
          projectDeadline,
          equipmentRequirements: equipmentRequirements.trim() || undefined,
          justification: justification.trim(),
          requestedHours: preferredEndHour - preferredStartHour,
          preferredDate,
          preferredStartHour,
          preferredEndHour,
        },
        role,
      );
      setCreatedBanner({
        id: result.request.id,
        title: result.request.projectTitle,
        status: result.request.status,
        linkedBookingId: result.linkedBooking?.id,
      });
      setProjectTitle('');
      setProjectDescription('');
      setEquipmentRequirements('');
      setJustification('');
      setShowRequestForm(false);
      onStateMutated(
        `Project access request ${result.request.id} submitted with status "${result.request.status}".`,
      );
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Could not submit project request.');
    } finally {
      setSubmitting(false);
    }
  };

  const sortedBookings = [...bookings].sort((a, b) =>
    `${b.date}-${String(b.startHour).padStart(2, '0')}`.localeCompare(
      `${a.date}-${String(a.startHour).padStart(2, '0')}`,
    ),
  );

  const sortedRequests = [...projectRequests].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );

  return (
    <section aria-labelledby="student-schedule-heading" className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 id="student-schedule-heading" className="text-2xl font-bold text-slate-900">
            Bookings & Project Access Requests
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Track hardware bookings and submit project-based access requests linked to lab equipment and project deadlines.
          </p>
        </div>

        <button
          type="button"
          aria-expanded={showRequestForm}
          aria-controls="project-request-form"
          onClick={() => {
            setFormError(null);
            setFieldErrors({});
            setShowRequestForm((prev) => !prev);
          }}
          className="px-4 py-2.5 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
        >
          {showRequestForm ? 'Close Request Form' : 'New Project Access Request'}
        </button>
      </div>

      {createdBanner && (
        <div
          role="status"
          aria-live="polite"
          className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-start gap-3 text-sm text-emerald-950"
        >
          <CheckCircle2 className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5" aria-hidden="true" />
          <div className="space-y-0.5">
            <p className="font-semibold">
              Project Access Request Created ({createdBanner.id})
            </p>
            <p className="text-xs sm:text-sm text-emerald-900">
              <span className="font-medium">{createdBanner.title}</span> is recorded as{' '}
              <span className="font-semibold uppercase">{createdBanner.status}</span>
              {createdBanner.linkedBookingId
                ? ` and linked to provisional slot ${createdBanner.linkedBookingId}.`
                : ' for faculty review and schedule coordination.'}
            </p>
          </div>
        </div>
      )}

      {showRequestForm && (
        <form
          id="project-request-form"
          noValidate
          onSubmit={handleSubmitRequest}
          aria-labelledby="project-request-form-heading"
          className="bg-white border border-slate-200 rounded-xl p-6 space-y-4"
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 id="project-request-form-heading" className="text-base font-semibold text-slate-900">
                Submit Project-Based Equipment Access Request
              </h2>
              <p className="text-xs text-slate-600 mt-0.5">
                Request extended or project-justified access to campus hardware. Clear requests are saved with Pending status for faculty review. Fields marked with{' '}
                <span aria-hidden="true" className="text-rose-700 font-semibold">*</span>
                <span className="sr-only">an asterisk</span> are required.
              </p>
            </div>
            {selectedEquipment && (
              <span className="text-xs font-mono tabular-nums text-slate-600">
                Lab hours: {formatHour(selectedEquipment.openHour)}–{formatHour(selectedEquipment.closeHour)}
              </span>
            )}
          </div>

          <fieldset className="space-y-4">
            <legend className="sr-only">Resource and student identification</legend>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <label htmlFor="req-equipment" className="block text-xs font-medium text-slate-700">
                  Equipment / Lab Resource
                  <span aria-hidden="true" className="text-rose-700"> *</span>
                  <span className="sr-only"> (required)</span>
                </label>
                <select
                  id="req-equipment"
                  value={reqEquipmentId}
                  onChange={(e) => setReqEquipmentId(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  {equipment.map((eq) => (
                    <option key={eq.id} value={eq.id}>
                      {eq.name} ({eq.department})
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="req-student" className="block text-xs font-medium text-slate-700">
                  Student / Project Reference
                  <span aria-hidden="true" className="text-rose-700"> *</span>
                  <span className="sr-only"> (required)</span>
                </label>
                <input
                  id="req-student"
                  type="text"
                  required
                  maxLength={80}
                  value={studentName}
                  aria-invalid={Boolean(fieldErrors.studentName)}
                  aria-describedby={fieldErrors.studentName ? 'req-student-error' : undefined}
                  onChange={(e) => {
                    setStudentName(e.target.value);
                    clearFieldError('studentName');
                  }}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
                {fieldErrors.studentName && (
                  <p id="req-student-error" role="alert" className="text-xs text-rose-800 font-medium">
                    {fieldErrors.studentName}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <label htmlFor="req-dept" className="block text-xs font-medium text-slate-700">
                  Home Department
                  <span aria-hidden="true" className="text-rose-700"> *</span>
                  <span className="sr-only"> (required)</span>
                </label>
                <select
                  id="req-dept"
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  {Array.from(
                    new Set([
                      'Chemistry',
                      'Robotics & Mechatronics',
                      'Computer Science',
                      'Electrical Engineering',
                      'Mechanical Engineering',
                      'Bioengineering',
                      'Embedded Systems',
                      ...equipment.map((eq) => eq.department),
                    ]),
                  ).map((deptOption) => (
                    <option key={deptOption} value={deptOption}>
                      {deptOption}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </fieldset>

          <fieldset className="space-y-4">
            <legend className="sr-only">Project scope and requested schedule</legend>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label htmlFor="req-project-title" className="block text-xs font-medium text-slate-700">
                  Project Title
                  <span aria-hidden="true" className="text-rose-700"> *</span>
                  <span className="sr-only"> (required)</span>
                </label>
                <input
                  id="req-project-title"
                  type="text"
                  required
                  maxLength={120}
                  placeholder="e.g. Autonomous End-Effector Force Validation"
                  value={projectTitle}
                  aria-invalid={Boolean(fieldErrors.projectTitle)}
                  aria-describedby={fieldErrors.projectTitle ? 'req-project-title-error' : undefined}
                  onChange={(e) => {
                    setProjectTitle(e.target.value);
                    clearFieldError('projectTitle');
                  }}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 placeholder:text-slate-500"
                />
                {fieldErrors.projectTitle && (
                  <p id="req-project-title-error" role="alert" className="text-xs text-rose-800 font-medium">
                    {fieldErrors.projectTitle}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <label htmlFor="req-capabilities" className="block text-xs font-medium text-slate-700">
                  Required Hardware Capabilities (Optional)
                </label>
                <input
                  id="req-capabilities"
                  type="text"
                  maxLength={300}
                  placeholder="e.g. ROS2 Control, Force-Torque Sensing"
                  value={equipmentRequirements}
                  onChange={(e) => setEquipmentRequirements(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 placeholder:text-slate-500"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="req-project-description" className="block text-xs font-medium text-slate-700">
                Project Description
                <span aria-hidden="true" className="text-rose-700"> *</span>
                <span className="sr-only"> (required)</span>
              </label>
              <textarea
                id="req-project-description"
                rows={2}
                required
                maxLength={600}
                placeholder="Summarize the experiment, prototype milestone, or research workflow."
                value={projectDescription}
                aria-invalid={Boolean(fieldErrors.projectDescription)}
                aria-describedby={
                  fieldErrors.projectDescription ? 'req-project-description-error' : undefined
                }
                onChange={(e) => {
                  setProjectDescription(e.target.value);
                  clearFieldError('projectDescription');
                }}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 placeholder:text-slate-500"
              />
              {fieldErrors.projectDescription && (
                <p
                  id="req-project-description-error"
                  role="alert"
                  className="text-xs text-rose-800 font-medium"
                >
                  {fieldErrors.projectDescription}
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
              <div className="space-y-1.5">
                <label htmlFor="req-preferred-date" className="block text-xs font-medium text-slate-700">
                  Preferred Date
                  <span aria-hidden="true" className="text-rose-700"> *</span>
                  <span className="sr-only"> (required)</span>
                </label>
                <input
                  id="req-preferred-date"
                  type="date"
                  required
                  min={today}
                  value={preferredDate}
                  aria-invalid={Boolean(fieldErrors.preferredDate)}
                  aria-describedby={fieldErrors.preferredDate ? 'req-preferred-date-error' : undefined}
                  onChange={(e) => {
                    setPreferredDate(e.target.value);
                    clearFieldError('preferredDate');
                  }}
                  className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
                {fieldErrors.preferredDate && (
                  <p id="req-preferred-date-error" role="alert" className="text-xs text-rose-800 font-medium">
                    {fieldErrors.preferredDate}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <label htmlFor="req-start-hour" className="block text-xs font-medium text-slate-700">
                  Preferred Start Time
                </label>
                <select
                  id="req-start-hour"
                  value={preferredStartHour}
                  onChange={(e) => {
                    const nextStart = Number(e.target.value);
                    const currentSpan = Math.max(1, Math.min(8, preferredEndHour - preferredStartHour));
                    const closeHour = selectedEquipment?.closeHour ?? 20;
                    setPreferredStartHour(nextStart);
                    setPreferredEndHour(Math.min(closeHour, nextStart + currentSpan));
                    clearFieldError('preferredEndHour');
                  }}
                  className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  {startHoursList.map((h) => (
                    <option key={h} value={h}>
                      {formatHour(h)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="req-end-hour" className="block text-xs font-medium text-slate-700">
                  Preferred End Time
                </label>
                <select
                  id="req-end-hour"
                  value={preferredEndHour}
                  aria-invalid={Boolean(fieldErrors.preferredEndHour)}
                  aria-describedby={fieldErrors.preferredEndHour ? 'req-end-hour-error' : undefined}
                  onChange={(e) => {
                    setPreferredEndHour(Number(e.target.value));
                    clearFieldError('preferredEndHour');
                  }}
                  className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  {endHoursList.map((h) => (
                    <option key={h} value={h}>
                      {formatHour(h)} ({h - preferredStartHour}h)
                    </option>
                  ))}
                </select>
                {fieldErrors.preferredEndHour && (
                  <p id="req-end-hour-error" role="alert" className="text-xs text-rose-800 font-medium">
                    {fieldErrors.preferredEndHour}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <label htmlFor="req-deadline" className="block text-xs font-medium text-slate-700">
                  Project Deadline
                  <span aria-hidden="true" className="text-rose-700"> *</span>
                  <span className="sr-only"> (required)</span>
                </label>
                <input
                  id="req-deadline"
                  type="date"
                  required
                  min={today}
                  value={projectDeadline}
                  aria-invalid={Boolean(fieldErrors.projectDeadline)}
                  aria-describedby={fieldErrors.projectDeadline ? 'req-deadline-error' : undefined}
                  onChange={(e) => {
                    setProjectDeadline(e.target.value);
                    clearFieldError('projectDeadline');
                  }}
                  className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
                {fieldErrors.projectDeadline && (
                  <p id="req-deadline-error" role="alert" className="text-xs text-rose-800 font-medium">
                    {fieldErrors.projectDeadline}
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="req-justification" className="block text-xs font-medium text-slate-700">
                Why This Resource Is Required (Justification & Safety Readiness)
                <span aria-hidden="true" className="text-rose-700"> *</span>
                <span className="sr-only"> (required)</span>
              </label>
              <textarea
                id="req-justification"
                rows={2}
                required
                maxLength={500}
                placeholder="Explain why this hardware is necessary, project urgency, and any safety/lab induction completed."
                value={justification}
                aria-invalid={Boolean(fieldErrors.justification)}
                aria-describedby={fieldErrors.justification ? 'req-justification-error' : undefined}
                onChange={(e) => {
                  setJustification(e.target.value);
                  clearFieldError('justification');
                }}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 placeholder:text-slate-500"
              />
              {fieldErrors.justification && (
                <p id="req-justification-error" role="alert" className="text-xs text-rose-800 font-medium">
                  {fieldErrors.justification}
                </p>
              )}
            </div>
          </fieldset>

          {formError && (
            <div role="alert" className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs sm:text-sm text-rose-800">
              {formError}
            </div>
          )}

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setShowRequestForm(false)}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 text-sm font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
            >
              {submitting ? 'Submitting...' : 'Submit Access Request'}
            </button>
          </div>
        </form>
      )}

      {/* Bookings Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 id="student-bookings-heading" className="text-base font-semibold text-slate-900">
            Campus Slot Bookings
          </h2>
          <span className="text-xs font-mono tabular-nums text-slate-600">
            {sortedBookings.length} total
          </span>
        </div>

        <div
          tabIndex={0}
          role="region"
          aria-labelledby="student-bookings-heading"
          className="overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600"
        >
          <table className="w-full text-left border-collapse text-sm">
            <caption className="sr-only">
              Campus equipment slot bookings showing equipment location, student project, scheduled window, status, and cancel controls
            </caption>
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-700">
                <th scope="col" className="py-3 px-4">Equipment</th>
                <th scope="col" className="py-3 px-4">Student & Project</th>
                <th scope="col" className="py-3 px-4">Slot Window</th>
                <th scope="col" className="py-3 px-4">Status</th>
                <th scope="col" className="py-3 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sortedBookings.map((booking) => {
                const eq = equipmentById.get(booking.equipmentId);
                const statusInfo = renderBookingStatus(booking.status);
                const equipmentDisplayName = eq?.name ?? booking.equipmentId;
                return (
                  <tr key={booking.id} className="hover:bg-slate-50/70">
                    <td className="py-3.5 px-4 align-top">
                      <button
                        type="button"
                        onClick={() => eq && onOpenEquipment(eq)}
                        aria-label={`Inspect schedule and book ${equipmentDisplayName}`}
                        className="font-medium text-slate-900 hover:text-blue-700 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 rounded"
                      >
                        {equipmentDisplayName}
                      </button>
                      <p className="text-xs text-slate-600">{eq?.labLocation}</p>
                    </td>
                    <td className="py-3.5 px-4 align-top">
                      <p className="font-medium text-slate-900">{booking.projectTitle}</p>
                      <p className="text-xs text-slate-600">
                        {booking.studentName} · Deadline {booking.projectDeadline}
                        {booking.resolvedViaAi ? ' · AI-Resolved Slot' : ''}
                      </p>
                    </td>
                    <td className="py-3.5 px-4 align-top font-mono tabular-nums text-xs text-slate-700 whitespace-nowrap">
                      {booking.date} · {formatHour(booking.startHour)}–{formatHour(booking.endHour)}
                    </td>
                    <td className={`py-3.5 px-4 align-top text-xs font-medium whitespace-nowrap ${statusInfo.className}`}>
                      {statusInfo.label}
                    </td>
                    <td className="py-3.5 px-4 align-top text-right">
                      {booking.status !== 'cancelled' && (
                        <button
                          type="button"
                          onClick={() => handleCancelBooking(booking.id)}
                          disabled={cancellingId === booking.id}
                          aria-label={`Cancel booking for ${booking.projectTitle} on ${booking.date}`}
                          className="px-2.5 py-1 text-xs font-medium text-slate-700 border border-slate-300 rounded-md hover:bg-slate-100 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                        >
                          {cancellingId === booking.id ? 'Cancelling...' : 'Cancel'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Project Requests List */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">Project Access Requests</h2>
          <span className="text-xs font-mono tabular-nums text-slate-600">
            {sortedRequests.length} requests
          </span>
        </div>

        <div className="divide-y divide-slate-100">
          {sortedRequests.map((req) => {
            const eq = equipmentById.get(req.equipmentId);
            const linkedBooking = req.linkedBookingId
              ? bookings.find((b) => b.id === req.linkedBookingId)
              : undefined;
            const statusInfo = renderRequestStatus(req.status);
            const isHighlighted = createdBanner?.id === req.id;
            return (
              <article
                key={req.id}
                className={`p-5 flex flex-col sm:flex-row sm:items-start justify-between gap-4 ${
                  isHighlighted ? 'bg-blue-50/40' : ''
                }`}
              >
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-slate-600">
                      {eq?.name ?? req.equipmentName ?? req.equipmentId} · {req.department}
                    </span>
                    <span aria-hidden="true" className="text-slate-400">
                      ·
                    </span>
                    <span className={`font-medium ${statusInfo.className}`}>{statusInfo.label}</span>
                    <span aria-hidden="true" className="text-slate-400">
                      ·
                    </span>
                    <span className="font-mono text-slate-600">{req.id}</span>
                  </div>
                  <h3 className="text-base font-semibold text-slate-900">{req.projectTitle}</h3>
                  {req.projectDescription && (
                    <p className="text-xs sm:text-sm text-slate-700 leading-relaxed">
                      {req.projectDescription}
                    </p>
                  )}
                  <p className="text-xs text-slate-600">
                    <span className="font-semibold text-slate-700">Reason:</span> {req.justification}
                  </p>
                  {linkedBooking && (
                    <p className="text-xs font-mono text-slate-600">
                      Linked Booking ({linkedBooking.id}): {linkedBooking.status} · {linkedBooking.date}{' '}
                      {formatHour(linkedBooking.startHour)}–{formatHour(linkedBooking.endHour)}
                    </p>
                  )}
                  {req.status === 'conflict' && (
                    <p className="text-xs text-amber-800 font-medium">
                      Scheduling Conflict: Requested slot overlaps an active booking on {req.preferredDate}.
                    </p>
                  )}
                  {req.facultyDecisionNote && (
                    <p className={`text-xs pt-1 ${req.status === 'rejected' ? 'text-rose-800' : 'text-slate-700'}`}>
                      <span className="font-semibold">
                        {req.status === 'rejected'
                          ? `Rejection Reason (${req.facultyReviewer ?? 'Faculty'}):`
                          : `Faculty Note (${req.facultyReviewer ?? 'Faculty'}):`}
                      </span>{' '}
                      {req.facultyDecisionNote}
                    </p>
                  )}
                </div>

                <div className="text-xs font-mono tabular-nums text-slate-600 shrink-0 sm:text-right space-y-0.5">
                  <div>
                    Preferred: {req.preferredDate}
                    {req.preferredStartHour !== undefined && req.preferredEndHour !== undefined
                      ? ` (${formatHour(req.preferredStartHour)}–${formatHour(req.preferredEndHour)})`
                      : ''}
                  </div>
                  <div>Duration: {req.requestedHours}h</div>
                  <div>Deadline: {req.projectDeadline}</div>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
