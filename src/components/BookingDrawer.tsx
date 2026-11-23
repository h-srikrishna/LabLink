import { AlertTriangle, Calendar, CheckCircle2, Clock, Sparkles, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  Booking,
  BookingConflictDetails,
  CandidateSlot,
  ConflictResolutionResponse,
  CreateBookingInput,
  Equipment,
  SlotAvailabilityResponse,
  UserRole,
} from '../shared/types.js';
import {
  ApiClientError,
  checkSlotAvailabilityApi,
  createBookingApi,
  resolveConflictApi,
} from '../client/api.js';
import { useModalFocusTrap } from '../client/useModalFocusTrap.js';

interface BookingDrawerProps {
  equipment: Equipment | null;
  allEquipment: Equipment[];
  bookings: Booking[];
  today: string;
  tomorrow: string;
  role: UserRole;
  presetConflictDemo?: boolean;
  onClose: () => void;
  onSwitchEquipment: (eq: Equipment) => void;
  onBookingCreated: (message: string) => void;
  onRequestProjectAccess?: (eq: Equipment) => void;
}

function addDaysIso(isoDate: string, days: number): string {
  const parsed = new Date(`${isoDate}T12:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function formatHour(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

export function BookingDrawer({
  equipment,
  allEquipment,
  bookings,
  today,
  tomorrow,
  role,
  presetConflictDemo = false,
  onClose,
  onSwitchEquipment,
  onBookingCreated,
  onRequestProjectAccess,
}: BookingDrawerProps) {
  const dayAfter = useMemo(() => addDaysIso(today, 2), [today]);

  const [studentName, setStudentName] = useState('Jordan Rivera');
  const [studentEmail, setStudentEmail] = useState('jrivera@campus.edu');
  const [projectTitle, setProjectTitle] = useState('Autonomous Assistive Gripper Demo');
  const [projectDeadline, setProjectDeadline] = useState(dayAfter);
  const [requirementsSummary, setRequirementsSummary] = useState(
    '6-DOF Manipulation, Force-Torque Sensing, ROS2 Control',
  );
  const [selectedDate, setSelectedDate] = useState(today);
  const [startHour, setStartHour] = useState(14);
  const [endHour, setEndHour] = useState(16);

  const [resolvedViaAi, setResolvedViaAi] = useState(false);
  const [aiFairnessNote, setAiFairnessNote] = useState<string | undefined>(undefined);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiRecommendation, setAiRecommendation] = useState<ConflictResolutionResponse | null>(null);

  const [submitLoading, setSubmitLoading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [availabilityCheck, setAvailabilityCheck] = useState<SlotAvailabilityResponse | null>(null);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [serverConflictDetails, setServerConflictDetails] = useState<BookingConflictDetails | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const drawerPanelRef = useRef<HTMLDivElement>(null);
  const lastAiKeyRef = useRef<string>('');
  const pendingAiSlotRef = useRef<{
    equipmentId: string;
    date: string;
    startHour: number;
    endHour: number;
    viaAi: boolean;
    fairnessSummary?: string;
  } | null>(null);

  useModalFocusTrap(Boolean(equipment), drawerPanelRef, onClose);

  // Reset form defaults when opening or triggering the conflict demo preset
  useEffect(() => {
    if (!equipment) return;
    setSubmitError(null);
    setAiError(null);
    setAiRecommendation(null);
    setAvailabilityCheck(null);
    setServerConflictDetails(null);
    setFieldErrors({});
    lastAiKeyRef.current = '';

    const pendingSlot = pendingAiSlotRef.current;
    if (pendingSlot && pendingSlot.equipmentId === equipment.id) {
      pendingAiSlotRef.current = null;
      setSelectedDate(pendingSlot.date);
      setStartHour(pendingSlot.startHour);
      setEndHour(pendingSlot.endHour);
      setResolvedViaAi(pendingSlot.viaAi);
      setAiFairnessNote(pendingSlot.fairnessSummary);
      return;
    }

    setResolvedViaAi(false);
    setAiFairnessNote(undefined);

    if (presetConflictDemo) {
      setStudentName('Jordan Rivera');
      setStudentEmail('jrivera@campus.edu');
      setProjectTitle('Senior Robotics Capstone — Urgent Gripper Demo');
      setProjectDeadline(dayAfter);
      setRequirementsSummary('6-DOF Manipulation, Force-Torque Sensing, ROS2 Control');
      setSelectedDate(today);
      setStartHour(14);
      setEndHour(16);
    } else {
      setSelectedDate(today);
      const dayBookings = bookings.filter(
        (b) => b.equipmentId === equipment.id && b.date === today && b.status !== 'cancelled',
      );
      let defaultStart = equipment.openHour;
      for (let h = equipment.openHour; h + 2 <= equipment.closeHour; h += 1) {
        const busy = dayBookings.some((b) => h < b.endHour && b.startHour < h + 2);
        if (!busy) {
          defaultStart = h;
          break;
        }
      }
      setStartHour(defaultStart);
      setEndHour(Math.min(equipment.closeHour, defaultStart + 2));
    }
  }, [equipment?.id, presetConflictDemo, today, dayAfter]);

  const dayBookings = useMemo(() => {
    if (!equipment) return [];
    return bookings
      .filter((b) => b.equipmentId === equipment.id && b.date === selectedDate && b.status !== 'cancelled')
      .sort((a, b) => a.startHour - b.startHour);
  }, [equipment, bookings, selectedDate]);

  const activeConflicts = useMemo(() => {
    if (!equipment) return [];
    return dayBookings.filter((b) => startHour < b.endHour && b.startHour < endHour);
  }, [equipment, dayBookings, startHour, endHour]);

  const hoursList = useMemo(() => {
    if (!equipment) return [];
    const list: number[] = [];
    for (let h = equipment.openHour; h < equipment.closeHour; h += 1) {
      list.push(h);
    }
    return list;
  }, [equipment]);

  const latestFormRef = useRef({ studentName, projectTitle, requirementsSummary });
  latestFormRef.current = { studentName, projectTitle, requirementsSummary };

  // Deterministic availability & alternative slot check via backend scheduling engine
  useEffect(() => {
    if (!equipment || !/^\d{4}-\d{2}-\d{2}$/.test(selectedDate) || endHour <= startHour) {
      setAvailabilityCheck(null);
      return;
    }

    let cancelled = false;
    setAvailabilityLoading(true);

    checkSlotAvailabilityApi({
      equipmentId: equipment.id,
      date: selectedDate,
      startHour,
      endHour,
    })
      .then((res) => {
        if (!cancelled) {
          setAvailabilityCheck(res);
          setAvailabilityLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAvailabilityLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [equipment?.id, selectedDate, startHour, endHour, bookings]);

  // Auto-trigger GenAI conflict resolution when an overlap is detected
  useEffect(() => {
    if (!equipment || activeConflicts.length === 0 || equipment.status === 'maintenance') {
      setAiRecommendation(null);
      setAiError(null);
      return;
    }

    const requestKey = `${equipment.id}|${selectedDate}|${startHour}|${endHour}|${projectDeadline}`;
    if (lastAiKeyRef.current === requestKey) return;
    lastAiKeyRef.current = requestKey;

    let cancelled = false;
    setAiLoading(true);
    setAiError(null);

    const { studentName: curName, projectTitle: curTitle, requirementsSummary: curReq } =
      latestFormRef.current;

    resolveConflictApi(
      {
        equipmentId: equipment.id,
        date: selectedDate,
        startHour,
        endHour,
        studentName: curName,
        projectTitle: curTitle,
        projectDeadline,
        requirementsSummary: curReq,
        requiredCapabilities: equipment.capabilities,
      },
      role,
    )
      .then((res) => {
        if (!cancelled) {
          setAiRecommendation(res);
          setAiLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          const message =
            err instanceof Error
              ? err.message
              : 'AI recommendation unavailable. These alternatives are verified as available.';
          setAiError(message);
          setAiLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    equipment,
    activeConflicts.length,
    selectedDate,
    startHour,
    endHour,
    projectDeadline,
    role,
  ]);

  if (!equipment) return null;

  const isMaintenance = equipment.status === 'maintenance';
  const effectiveConflicts =
    activeConflicts.length > 0
      ? activeConflicts
      : availabilityCheck && !availabilityCheck.available
        ? availabilityCheck.conflicts
        : serverConflictDetails?.conflicts ?? [];
  const hasConflict = effectiveConflicts.length > 0;
  const deterministicAlternatives: CandidateSlot[] =
    aiRecommendation?.alternatives && aiRecommendation.alternatives.length > 0
      ? aiRecommendation.alternatives
      : serverConflictDetails?.alternatives ?? availabilityCheck?.alternatives ?? [];
  const selectedDuration = Math.max(1, Math.min(4, endHour - startHour));

  const verifiedRecommendation =
    aiRecommendation?.aiStatus === 'available' &&
    aiRecommendation.recommendation &&
    aiRecommendation.alternatives.some(
      (alt) => alt.alternativeId === aiRecommendation.recommendation?.alternativeId,
    )
      ? aiRecommendation.recommendation
      : null;

  const handleRetryAi = () => {
    lastAiKeyRef.current = '';
    setAiLoading(true);
    setAiError(null);
    resolveConflictApi(
      {
        equipmentId: equipment.id,
        date: selectedDate,
        startHour,
        endHour,
        studentName,
        projectTitle,
        projectDeadline,
        requirementsSummary,
        requiredCapabilities: equipment.capabilities,
      },
      role,
    )
      .then((res) => {
        setAiRecommendation(res);
        setAiLoading(false);
      })
      .catch((err: unknown) => {
        setAiError(
          err instanceof Error
            ? err.message
            : 'AI recommendation unavailable. These alternatives are verified as available.',
        );
        setAiLoading(false);
      });
  };

  const handleApplySlot = (
    targetEquipmentId: string,
    targetDate: string,
    targetStart: number,
    targetEnd: number,
    options?: { viaAi?: boolean; fairnessSummary?: string },
  ) => {
    const viaAi = Boolean(options?.viaAi);
    const fairnessSummary = options?.fairnessSummary;
    const targetEq = allEquipment.find((eq) => eq.id === targetEquipmentId);
    if (targetEq && targetEq.id !== equipment.id) {
      pendingAiSlotRef.current = {
        equipmentId: targetEq.id,
        date: targetDate,
        startHour: targetStart,
        endHour: targetEnd,
        viaAi,
        fairnessSummary,
      };
      onSwitchEquipment(targetEq);
      return;
    }
    setSelectedDate(targetDate);
    setStartHour(targetStart);
    setEndHour(targetEnd);
    setResolvedViaAi(viaAi);
    setAiFairnessNote(fairnessSummary);
    setServerConflictDetails(null);
    setSubmitError(null);
  };

  const handleSubmitBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    if (isMaintenance) {
      setSubmitError('This resource is currently under maintenance and cannot be booked.');
      return;
    }

    const nextFieldErrors: Record<string, string> = {};
    const trimmedEmail = studentEmail.trim();
    if (!studentName.trim()) {
      nextFieldErrors['booking-student-name'] = 'Enter a student or team reference.';
    }
    if (trimmedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      nextFieldErrors['booking-student-email'] = 'Enter a valid campus email address or leave blank.';
    }
    if (!projectTitle.trim()) {
      nextFieldErrors['booking-project-title'] = 'Enter a project or purpose title.';
    }
    if (!projectDeadline) {
      nextFieldErrors['booking-deadline'] = 'Select a valid project deadline date.';
    }
    if (!requirementsSummary.trim()) {
      nextFieldErrors['booking-requirements'] = 'Describe your purpose or technical requirements.';
    }
    if (endHour <= startHour) {
      nextFieldErrors['booking-end-hour'] = 'End time must be later than start time.';
    }

    if (Object.keys(nextFieldErrors).length > 0) {
      setFieldErrors(nextFieldErrors);
      setSubmitError('Please fix the highlighted booking fields before submitting.');
      const firstInvalidId = Object.keys(nextFieldErrors)[0];
      window.document.getElementById(firstInvalidId)?.focus();
      return;
    }
    setFieldErrors({});
    const payload: CreateBookingInput = {
      equipmentId: equipment.id,
      studentName: studentName.trim(),
      ...(trimmedEmail ? { studentEmail: trimmedEmail } : {}),
      projectTitle: projectTitle.trim(),
      projectDeadline,
      requirementsSummary: requirementsSummary.trim(),
      date: selectedDate,
      startHour,
      endHour,
      resolvedViaAi,
      aiFairnessNote,
    };

    setSubmitLoading(true);
    try {
      const result = await createBookingApi(payload, role);
      const statusLabel =
        result.booking.status === 'pending_faculty'
          ? 'Submitted for Faculty approval and added to the Faculty Review Queue.'
          : 'Slot confirmed.';
      onBookingCreated(
        `${equipment.name} booked for ${selectedDate} (${formatHour(startHour)}–${formatHour(endHour)}). ${statusLabel}`,
      );
      onClose();
    } catch (err: unknown) {
      if (err instanceof ApiClientError && err.code === 'BOOKING_CONFLICT') {
        setSubmitError(err.message);
        if (err.details && typeof err.details === 'object') {
          setServerConflictDetails(err.details as BookingConflictDetails);
        }
        handleRetryAi();
      } else {
        setSubmitError(err instanceof Error ? err.message : 'Could not complete booking.');
      }
    } finally {
      setSubmitLoading(false);
    }
  };

  const dateTabs = [
    { label: 'Today', value: today },
    { label: 'Tomorrow', value: tomorrow },
    { label: 'In 2 Days', value: dayAfter },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-900/40 backdrop-blur-[1px]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={drawerPanelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-equipment-title"
        className="w-full max-w-2xl bg-white h-full overflow-y-auto border-l border-slate-200 shadow-xl flex flex-col focus:outline-none"
      >
        <div className="sticky top-0 z-10 bg-white border-b border-slate-200 px-6 py-4 flex items-start justify-between gap-4">
          <div className="space-y-1">
            <p className="text-xs text-slate-600">
              {equipment.department} · {equipment.labLocation}
            </p>
            <h2 id="drawer-equipment-title" className="text-xl font-bold text-slate-900">
              {equipment.name}
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label={`Close booking panel for ${equipment.name}`}
            className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        <div className="p-6 space-y-6 flex-1">
          {/* Explicit 4-step booking progression + Project Request link */}
          <div className="flex flex-wrap items-center justify-between gap-2 border border-slate-200 bg-slate-50 rounded-lg px-3.5 py-2.5">
            <nav aria-label="Booking workflow steps">
              <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                <li className="font-semibold text-slate-900">1. Equipment</li>
                <li aria-hidden="true" className="text-slate-500">→</li>
                <li className="font-semibold text-slate-900">2. Availability ({selectedDate})</li>
                <li aria-hidden="true" className="text-slate-500">→</li>
                <li className={hasConflict ? 'font-semibold text-amber-800' : 'font-semibold text-blue-700'}>
                  3. Select Slot ({formatHour(startHour)}–{formatHour(endHour)})
                </li>
                <li aria-hidden="true" className="text-slate-500">→</li>
                <li className="text-slate-700 font-medium">4. Submit Booking</li>
              </ol>
            </nav>

            {onRequestProjectAccess && (
              <button
                type="button"
                onClick={() => onRequestProjectAccess(equipment)}
                className="text-xs font-semibold text-blue-700 hover:text-blue-800 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 rounded"
              >
                Project Access Request →
              </button>
            )}
          </div>

          {/* Resource Details & Specifications */}
          <section
            aria-labelledby="resource-details-heading"
            className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 id="resource-details-heading" className="text-xs font-semibold text-slate-800">
                Resource Specifications · {equipment.category}
              </h3>
              <span
                className={`text-xs font-semibold ${
                  isMaintenance
                    ? 'text-rose-800'
                    : equipment.requiresFacultyApproval || equipment.status === 'restricted'
                      ? 'text-amber-800'
                      : 'text-emerald-800'
                }`}
              >
                {isMaintenance
                  ? '✖ Under Maintenance'
                  : equipment.requiresFacultyApproval || equipment.status === 'restricted'
                    ? '▲ Faculty Approval Required'
                    : '● Available for Instant Booking'}
              </span>
            </div>

            <p className="text-sm text-slate-800 leading-relaxed">{equipment.description}</p>

            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs pt-1">
              <div>
                <dt className="text-slate-600">Department & Lab Location</dt>
                <dd className="font-medium text-slate-900">
                  {equipment.department} · {equipment.labLocation}
                </dd>
              </div>
              <div>
                <dt className="text-slate-600">Units & Operating Hours</dt>
                <dd className="font-mono tabular-nums font-medium text-slate-900">
                  {equipment.availableUnits}/{equipment.totalUnits} units free ·{' '}
                  {formatHour(equipment.openHour)}–{formatHour(equipment.closeHour)}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-slate-600">Capabilities</dt>
                <dd className="font-medium text-slate-900">
                  {equipment.capabilities.join(' · ')}
                </dd>
              </div>
            </dl>
          </section>

          {isMaintenance && (
            <div
              role="alert"
              className="p-4 bg-rose-50 border border-rose-200 rounded-lg text-sm text-rose-900 space-y-2"
            >
              <p className="font-semibold">Under Maintenance</p>
              <p className="text-rose-800">
                Lab Admin has paused bookings on this hardware for calibration. Select another resource from the catalog.
              </p>
            </div>
          )}

          {equipment.requiresFacultyApproval && !isMaintenance && (
            <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-lg text-xs sm:text-sm text-amber-900">
              <span className="font-semibold">Faculty Clearance Required:</span> Submitting this slot
              holds your time window as <span className="font-mono">Pending Faculty</span> and sends a
              project access request to the Faculty Review Queue.
            </div>
          )}

          {/* Date & Hourly Availability Timeline */}
          <section aria-labelledby="timeline-heading" className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 id="timeline-heading" className="text-sm font-semibold text-slate-900">
                Slot Availability ({selectedDate})
              </h3>

              <div className="flex flex-wrap items-center gap-2">
                <div
                  role="group"
                  aria-label="Quick date selector"
                  className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg border border-slate-200"
                >
                  {dateTabs.map((tab) => (
                    <button
                      key={tab.value}
                      type="button"
                      aria-pressed={selectedDate === tab.value}
                      onClick={() => {
                        setSelectedDate(tab.value);
                        setResolvedViaAi(false);
                        setServerConflictDetails(null);
                      }}
                      className={`px-2.5 py-1 text-xs rounded-md transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                        selectedDate === tab.value
                          ? 'bg-white text-slate-900 font-semibold shadow-xs border border-slate-300'
                          : 'text-slate-700 font-medium hover:text-slate-900'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                <label htmlFor="booking-custom-date" className="sr-only">
                  Booking date
                </label>
                <div className="relative flex items-center">
                  <Calendar className="w-3.5 h-3.5 text-slate-600 absolute left-2.5 pointer-events-none" aria-hidden="true" />
                  <input
                    id="booking-custom-date"
                    type="date"
                    min={today}
                    value={selectedDate}
                    onChange={(e) => {
                      if (!e.target.value) return;
                      setSelectedDate(e.target.value);
                      setResolvedViaAi(false);
                      setServerConflictDetails(null);
                    }}
                    className="pl-7 pr-2.5 py-1 text-xs font-mono text-slate-900 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
              </div>
            </div>

            <div
              role="group"
              aria-label={`Hourly slots for ${selectedDate}`}
              className="grid grid-cols-4 sm:grid-cols-6 gap-1.5"
            >
              {hoursList.map((hour) => {
                const occupyingBooking = dayBookings.find(
                  (b) => hour >= b.startHour && hour < b.endHour,
                );
                const isSelected = hour >= startHour && hour < endHour;
                const isBooked = Boolean(occupyingBooking);
                const slotStatusLabel = occupyingBooking
                  ? occupyingBooking.status === 'pending_faculty'
                    ? `Pending approval by ${occupyingBooking.studentName}`
                    : `Booked by ${occupyingBooking.studentName} for ${occupyingBooking.projectTitle}`
                  : 'Open';

                return (
                  <button
                    key={hour}
                    type="button"
                    aria-pressed={isSelected}
                    aria-label={`${formatHour(hour)}, ${slotStatusLabel}. Select ${selectedDuration} hour window starting ${formatHour(hour)}`}
                    onClick={() => {
                      const nextEnd = Math.min(equipment.closeHour, hour + selectedDuration);
                      setStartHour(hour);
                      setEndHour(Math.max(hour + 1, nextEnd));
                      setResolvedViaAi(false);
                      setAiFairnessNote(undefined);
                      setServerConflictDetails(null);
                    }}
                    title={
                      occupyingBooking
                        ? `Booked by ${occupyingBooking.studentName} (${occupyingBooking.projectTitle})`
                        : `Open at ${formatHour(hour)}`
                    }
                    className={`px-2 py-2 rounded-md border text-xs font-mono tabular-nums text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                      isSelected && isBooked
                        ? 'bg-amber-100 border-amber-500 text-amber-950 font-semibold'
                        : isSelected
                          ? 'bg-blue-600 border-blue-600 text-white font-semibold'
                          : isBooked
                            ? 'bg-slate-100 border-slate-300 text-slate-700 hover:border-amber-500'
                            : 'bg-white border-slate-300 text-slate-800 hover:border-blue-500'
                    }`}
                  >
                    <div>{formatHour(hour)}</div>
                    <div className="text-[10px] font-sans truncate mt-0.5">
                      {occupyingBooking
                        ? occupyingBooking.status === 'pending_faculty'
                          ? 'Pending'
                          : 'Booked'
                        : 'Open'}
                    </div>
                  </button>
                );
              })}
            </div>

            {dayBookings.length > 0 && (
              <div className="text-xs text-slate-600 space-y-1 pt-1">
                <p className="font-medium text-slate-700">Scheduled on {selectedDate}:</p>
                <ul className="space-y-1">
                  {dayBookings.map((b) => (
                    <li key={b.id} className="flex items-center justify-between gap-2 font-mono tabular-nums">
                      <span className="font-sans text-slate-700 truncate">
                        {b.studentName} — {b.projectTitle} (Due {b.projectDeadline})
                      </span>
                      <span className="text-slate-600 shrink-0">
                        {formatHour(b.startHour)}–{formatHour(b.endHour)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          {/* Deterministic Conflict Banner + Deterministic Alternatives + GenAI Recommendation Panel */}
          {hasConflict && !isMaintenance && (
            <section
              aria-live="polite"
              aria-label="Scheduling conflict and available alternatives"
              className="border border-amber-300 bg-amber-50/70 rounded-xl p-4 sm:p-5 space-y-4"
            >
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" aria-hidden="true" />
                <div className="space-y-1.5 flex-1">
                  <h3 className="text-sm font-bold text-amber-950">
                    Your requested slot is unavailable.
                  </h3>
                  <p className="text-xs sm:text-sm text-amber-900">
                    Requested {equipment.name} on{' '}
                    <span className="font-mono font-semibold">
                      {selectedDate} ({formatHour(startHour)}–{formatHour(endHour)})
                    </span>{' '}
                    overlaps with {effectiveConflicts.length} existing{' '}
                    {effectiveConflicts.length === 1 ? 'booking' : 'bookings'}. Double-booking is blocked by the scheduling engine.
                  </p>
                  <ul className="text-xs text-amber-950 space-y-1 pt-0.5">
                    {effectiveConflicts.map((c) => (
                      <li key={c.id} className="font-mono tabular-nums">
                        • {formatHour(c.startHour)}–{formatHour(c.endHour)} —{' '}
                        <span className="font-sans font-medium">
                          {c.projectTitle} ({c.studentName}, due {c.projectDeadline})
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Immediate Deterministic Feasible Alternatives (Server-verified) */}
              <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wide">
                    Verified Feasible Alternative Slots
                  </h4>
                  <span className="text-xs text-slate-600">
                    {availabilityLoading ? 'Checking schedule...' : 'Deterministically verified conflict-free'}
                  </span>
                </div>

                {deterministicAlternatives.length > 0 ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {deterministicAlternatives.slice(0, 6).map((alt) => (
                      <div
                        key={`det-${alt.equipmentId}-${alt.date}-${alt.startHour}-${alt.endHour}`}
                        className="flex items-center justify-between gap-2 border border-slate-200 rounded-lg px-3 py-2 text-xs bg-slate-50/70"
                      >
                        <div className="min-w-0">
                          <p className="font-mono tabular-nums font-semibold text-slate-900">
                            {alt.date} · {formatHour(alt.startHour)}–{formatHour(alt.endHour)}
                          </p>
                          <p className="text-slate-600 truncate">
                            {alt.isSameEquipment ? 'Same equipment' : `${alt.equipmentName} (${alt.department})`}
                          </p>
                        </div>
                        <button
                          type="button"
                          aria-label={`Select verified slot ${alt.equipmentName} on ${alt.date} from ${formatHour(alt.startHour)} to ${formatHour(alt.endHour)}`}
                          onClick={() =>
                            handleApplySlot(alt.equipmentId, alt.date, alt.startHour, alt.endHour, {
                              viaAi: false,
                            })
                          }
                          className="px-2.5 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                        >
                          Select Slot
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-600">
                    {availabilityLoading
                      ? 'Searching nearest open slots across operational equipment...'
                      : 'No feasible alternative slots are available on this or compatible resources in the next 3 days. Try adjusting duration or choosing another date.'}
                  </p>
                )}
              </div>

              {aiLoading && (
                <div
                  role="status"
                  aria-label="Loading AI conflict recommendation"
                  className="bg-white border border-slate-200 rounded-lg p-4 space-y-2.5 animate-pulse"
                >
                  <div className="h-4 w-56 bg-slate-200 rounded" />
                  <div className="h-3 w-full bg-slate-100 rounded" />
                  <div className="h-3 w-5/6 bg-slate-100 rounded" />
                </div>
              )}

              {!aiLoading &&
                (aiError || aiRecommendation?.aiStatus === 'unavailable') && (
                  <div
                    role="status"
                    className="bg-white border border-slate-300 rounded-lg p-4 text-xs sm:text-sm text-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="space-y-0.5">
                      <p className="font-semibold text-slate-900">
                        {aiRecommendation?.fallbackMessage ??
                          'AI recommendation unavailable. These alternatives are verified as available.'}
                      </p>
                      {aiError && <p className="text-xs text-slate-600">{aiError}</p>}
                    </div>
                    {deterministicAlternatives.length > 0 && (
                      <button
                        type="button"
                        onClick={handleRetryAi}
                        className="px-3 py-1.5 text-xs font-medium text-slate-800 bg-slate-100 border border-slate-200 rounded-md hover:bg-slate-200 shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                      >
                        Retry AI Advisor
                      </button>
                    )}
                  </div>
                )}

              {verifiedRecommendation && !aiLoading && (
                <div className="bg-white border border-slate-200 rounded-lg p-4 sm:p-5 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-blue-600" aria-hidden="true" />
                      <h4 className="text-sm font-bold text-slate-900">
                        AI Fair Allocation Recommendation
                      </h4>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-xs">
                      <span className="font-mono font-semibold text-slate-700">
                        Confidence: {Math.round(verifiedRecommendation.confidence * 100)}%
                      </span>
                      <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
                        <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                        Verified Free Slot
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50 border border-slate-200 rounded-lg p-3.5">
                    <div className="space-y-0.5">
                      <p className="text-sm font-semibold text-slate-900">
                        {verifiedRecommendation.slot.equipmentName}
                      </p>
                      <p className="text-xs text-slate-600">
                        {verifiedRecommendation.slot.department} · {verifiedRecommendation.slot.labLocation}
                      </p>
                      <p className="text-xs font-mono tabular-nums text-blue-700 font-medium pt-0.5">
                        {verifiedRecommendation.slot.date} ·{' '}
                        {formatHour(verifiedRecommendation.slot.startHour)}–
                        {formatHour(verifiedRecommendation.slot.endHour)} ({verifiedRecommendation.alternativeId})
                      </p>
                    </div>

                    <button
                      type="button"
                      aria-label={`Apply AI recommended slot ${verifiedRecommendation.slot.equipmentName} on ${verifiedRecommendation.slot.date} from ${formatHour(verifiedRecommendation.slot.startHour)} to ${formatHour(verifiedRecommendation.slot.endHour)}`}
                      onClick={() =>
                        handleApplySlot(
                          verifiedRecommendation.slot.equipmentId,
                          verifiedRecommendation.slot.date,
                          verifiedRecommendation.slot.startHour,
                          verifiedRecommendation.slot.endHour,
                          {
                            viaAi: true,
                            fairnessSummary: verifiedRecommendation.fairnessExplanation,
                          },
                        )
                      }
                      className="px-3.5 py-2 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                    >
                      Apply Recommended Slot
                    </button>
                  </div>

                  <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs leading-relaxed">
                    <div className="space-y-1">
                      <dt className="font-semibold text-slate-900">Why This Works</dt>
                      <dd className="text-slate-600">{verifiedRecommendation.reason}</dd>
                    </div>
                    <div className="space-y-1">
                      <dt className="font-semibold text-slate-900">Fairness Factors Considered</dt>
                      <dd className="text-slate-600">{verifiedRecommendation.fairnessExplanation}</dd>
                    </div>
                    <div className="space-y-1">
                      <dt className="font-semibold text-slate-900">Project Deadline Consideration</dt>
                      <dd className="text-slate-600">{verifiedRecommendation.deadlineConsideration}</dd>
                    </div>
                    <div className="space-y-1">
                      <dt className="font-semibold text-slate-900">Availability & Fit</dt>
                      <dd className="text-slate-600">{verifiedRecommendation.availabilityConsideration}</dd>
                    </div>
                  </dl>

                  {verifiedRecommendation.backupAlternatives.length > 0 && (
                    <div className="pt-3 border-t border-slate-100 space-y-2">
                      <p className="text-xs font-semibold text-slate-700">Validated Backup Alternatives</p>
                      <div className="space-y-2">
                        {verifiedRecommendation.backupAlternatives
                          .filter((alt) =>
                            aiRecommendation?.alternatives.some(
                              (serverAlt) => serverAlt.alternativeId === alt.alternativeId,
                            ),
                          )
                          .map((alt) => (
                            <div
                              key={`${alt.equipmentId}-${alt.date}-${alt.startHour}`}
                              className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs border border-slate-200 rounded-lg p-2.5"
                            >
                              <div className="space-y-0.5">
                                <span className="font-medium text-slate-900">{alt.equipmentName}</span>{' '}
                                <span className="font-mono tabular-nums text-blue-700">
                                  ({alt.date} {formatHour(alt.startHour)}–{formatHour(alt.endHour)})
                                </span>
                                <p className="text-slate-600">{alt.tradeoffNote}</p>
                              </div>
                              <button
                                type="button"
                                aria-label={`Select backup slot ${alt.equipmentName} on ${alt.date} from ${formatHour(alt.startHour)} to ${formatHour(alt.endHour)}`}
                                onClick={() =>
                                  handleApplySlot(alt.equipmentId, alt.date, alt.startHour, alt.endHour, {
                                    viaAi: true,
                                    fairnessSummary: alt.tradeoffNote,
                                  })
                                }
                                className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 rounded-md hover:bg-slate-200 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                              >
                                Select Backup
                              </button>
                            </div>
                          ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </section>
          )}

          {resolvedViaAi && !hasConflict && (
            <div
              role="status"
              className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-lg text-xs sm:text-sm text-emerald-900 flex items-start gap-2.5"
            >
              <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <p className="font-semibold">AI-Recommended Slot Applied ({selectedDate} · {formatHour(startHour)}–{formatHour(endHour)})</p>
                {aiFairnessNote && <p className="text-emerald-800 mt-0.5">{aiFairnessNote}</p>}
              </div>
            </div>
          )}

          {/* Booking Form */}
          <form
            noValidate
            onSubmit={handleSubmitBooking}
            aria-labelledby="booking-form-heading"
            className="space-y-4 border-t border-slate-200 pt-5"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 id="booking-form-heading" className="text-sm font-semibold text-slate-900">
                Project & Slot Details
              </h3>
              <p className="text-xs text-slate-600">
                Fields marked <span className="text-rose-700 font-semibold">*</span> are required
              </p>
            </div>

            <fieldset className="space-y-4">
              <legend className="sr-only">Student and project booking information</legend>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label htmlFor="booking-student-name" className="block text-xs font-medium text-slate-800">
                    Student / Team Reference <span aria-hidden="true" className="text-rose-700">*</span>
                    <span className="sr-only"> (required)</span>
                  </label>
                  <input
                    id="booking-student-name"
                    type="text"
                    required
                    maxLength={80}
                    aria-invalid={Boolean(fieldErrors['booking-student-name'])}
                    aria-describedby={fieldErrors['booking-student-name'] ? 'err-booking-student-name' : undefined}
                    value={studentName}
                    onChange={(e) => {
                      setStudentName(e.target.value);
                      if (fieldErrors['booking-student-name']) {
                        setFieldErrors((prev) => ({ ...prev, 'booking-student-name': '' }));
                      }
                    }}
                    className="w-full px-3 py-2 text-sm text-slate-900 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                  {fieldErrors['booking-student-name'] && (
                    <p id="err-booking-student-name" role="alert" className="text-xs text-rose-700 font-medium">
                      {fieldErrors['booking-student-name']}
                    </p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="booking-student-email" className="block text-xs font-medium text-slate-800">
                    Campus Contact (Optional)
                  </label>
                  <input
                    id="booking-student-email"
                    type="email"
                    maxLength={120}
                    placeholder="Optional campus email"
                    aria-invalid={Boolean(fieldErrors['booking-student-email'])}
                    aria-describedby={fieldErrors['booking-student-email'] ? 'err-booking-student-email' : undefined}
                    value={studentEmail}
                    onChange={(e) => {
                      setStudentEmail(e.target.value);
                      if (fieldErrors['booking-student-email']) {
                        setFieldErrors((prev) => ({ ...prev, 'booking-student-email': '' }));
                      }
                    }}
                    className="w-full px-3 py-2 text-sm text-slate-900 bg-white border border-slate-300 rounded-lg placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                  {fieldErrors['booking-student-email'] && (
                    <p id="err-booking-student-email" role="alert" className="text-xs text-rose-700 font-medium">
                      {fieldErrors['booking-student-email']}
                    </p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label htmlFor="booking-project-title" className="block text-xs font-medium text-slate-800">
                    Project / Purpose Title <span aria-hidden="true" className="text-rose-700">*</span>
                    <span className="sr-only"> (required)</span>
                  </label>
                  <input
                    id="booking-project-title"
                    type="text"
                    required
                    maxLength={120}
                    aria-invalid={Boolean(fieldErrors['booking-project-title'])}
                    aria-describedby={fieldErrors['booking-project-title'] ? 'err-booking-project-title' : undefined}
                    value={projectTitle}
                    onChange={(e) => {
                      setProjectTitle(e.target.value);
                      if (fieldErrors['booking-project-title']) {
                        setFieldErrors((prev) => ({ ...prev, 'booking-project-title': '' }));
                      }
                    }}
                    className="w-full px-3 py-2 text-sm text-slate-900 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                  {fieldErrors['booking-project-title'] && (
                    <p id="err-booking-project-title" role="alert" className="text-xs text-rose-700 font-medium">
                      {fieldErrors['booking-project-title']}
                    </p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="booking-deadline" className="block text-xs font-medium text-slate-800">
                    Project Deadline <span aria-hidden="true" className="text-rose-700">*</span>
                    <span className="sr-only"> (required)</span>
                  </label>
                  <input
                    id="booking-deadline"
                    type="date"
                    required
                    aria-invalid={Boolean(fieldErrors['booking-deadline'])}
                    aria-describedby={fieldErrors['booking-deadline'] ? 'err-booking-deadline' : undefined}
                    value={projectDeadline}
                    onChange={(e) => {
                      setProjectDeadline(e.target.value);
                      if (fieldErrors['booking-deadline']) {
                        setFieldErrors((prev) => ({ ...prev, 'booking-deadline': '' }));
                      }
                    }}
                    className="w-full px-3 py-2 text-sm font-mono text-slate-900 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                  {fieldErrors['booking-deadline'] && (
                    <p id="err-booking-deadline" role="alert" className="text-xs text-rose-700 font-medium">
                      {fieldErrors['booking-deadline']}
                    </p>
                  )}
                </div>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="booking-requirements" className="block text-xs font-medium text-slate-800">
                  Purpose & Technical Requirements <span aria-hidden="true" className="text-rose-700">*</span>
                  <span className="sr-only"> (required)</span>
                </label>
                <input
                  id="booking-requirements"
                  type="text"
                  required
                  maxLength={300}
                  aria-invalid={Boolean(fieldErrors['booking-requirements'])}
                  aria-describedby={fieldErrors['booking-requirements'] ? 'err-booking-requirements' : undefined}
                  value={requirementsSummary}
                  onChange={(e) => {
                    setRequirementsSummary(e.target.value);
                    if (fieldErrors['booking-requirements']) {
                      setFieldErrors((prev) => ({ ...prev, 'booking-requirements': '' }));
                    }
                  }}
                  className="w-full px-3 py-2 text-sm text-slate-900 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
                {fieldErrors['booking-requirements'] && (
                  <p id="err-booking-requirements" role="alert" className="text-xs text-rose-700 font-medium">
                    {fieldErrors['booking-requirements']}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <label htmlFor="booking-start-hour" className="block text-xs font-medium text-slate-800">
                    Start Time
                  </label>
                  <select
                    id="booking-start-hour"
                    value={startHour}
                    onChange={(e) => {
                      const nextStart = Number(e.target.value);
                      setStartHour(nextStart);
                      setEndHour(Math.min(equipment.closeHour, nextStart + selectedDuration));
                      setResolvedViaAi(false);
                      setServerConflictDetails(null);
                    }}
                    className="w-full px-3 py-2 text-sm font-mono text-slate-900 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                  >
                    {hoursList.map((h) => (
                      <option key={h} value={h}>
                        {formatHour(h)}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="booking-duration" className="block text-xs font-medium text-slate-800">
                    Duration
                  </label>
                  <select
                    id="booking-duration"
                    value={selectedDuration}
                    onChange={(e) => {
                      const nextDuration = Number(e.target.value);
                      setEndHour(Math.min(equipment.closeHour, startHour + nextDuration));
                      setResolvedViaAi(false);
                      setServerConflictDetails(null);
                    }}
                    className="w-full px-3 py-2 text-sm font-mono text-slate-900 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                  >
                    {[1, 2, 3, 4]
                      .filter((d) => startHour + d <= equipment.closeHour)
                      .map((d) => (
                        <option key={d} value={d}>
                          {d} {d === 1 ? 'hour' : 'hours'}
                        </option>
                      ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="booking-end-hour" className="block text-xs font-medium text-slate-800">
                    End Time (Max 4h)
                  </label>
                  <select
                    id="booking-end-hour"
                    aria-invalid={Boolean(fieldErrors['booking-end-hour'])}
                    aria-describedby={fieldErrors['booking-end-hour'] ? 'err-booking-end-hour' : undefined}
                    value={endHour}
                    onChange={(e) => {
                      setEndHour(Number(e.target.value));
                      setResolvedViaAi(false);
                      setServerConflictDetails(null);
                      if (fieldErrors['booking-end-hour']) {
                        setFieldErrors((prev) => ({ ...prev, 'booking-end-hour': '' }));
                      }
                    }}
                    className="w-full px-3 py-2 text-sm font-mono text-slate-900 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                  >
                    {hoursList
                      .map((h) => h + 1)
                      .filter((h) => h > startHour && h <= Math.min(equipment.closeHour, startHour + 4))
                      .map((h) => (
                        <option key={h} value={h}>
                          {formatHour(h)}
                        </option>
                      ))}
                  </select>
                  {fieldErrors['booking-end-hour'] && (
                    <p id="err-booking-end-hour" role="alert" className="text-xs text-rose-700 font-medium">
                      {fieldErrors['booking-end-hour']}
                    </p>
                  )}
                </div>
              </div>
            </fieldset>

            {submitError && (
              <div
                role="alert"
                className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs sm:text-sm text-rose-800"
              >
                {submitError}
              </div>
            )}

            <div className="pt-2 flex flex-wrap items-center justify-between gap-3">
              {onRequestProjectAccess ? (
                <button
                  type="button"
                  onClick={() => onRequestProjectAccess(equipment)}
                  className="px-3.5 py-2 text-xs sm:text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                >
                  Request Project Access Instead
                </button>
              ) : (
                <span />
              )}

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2.5 text-sm font-medium text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitLoading || isMaintenance || hasConflict}
                  className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                >
                  <Clock className="w-4 h-4" aria-hidden="true" />
                  <span>
                    {submitLoading
                      ? 'Submitting...'
                      : equipment.requiresFacultyApproval
                        ? 'Submit for Faculty Approval'
                        : 'Confirm Booking'}
                  </span>
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
