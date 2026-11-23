import type {
  Booking,
  BookingConflictDetails,
  CreateBookingInput,
  CreateEquipmentInput,
  CreateProjectRequestInput,
  Equipment,
  ProjectAccessRequest,
  SlotAvailabilityResponse,
  UpdateEquipmentInput,
} from '../../shared/types.js';
import {
  createBooking as repoCreateBooking,
  getBookingById as repoGetBookingById,
  getBookings as repoGetBookings,
  updateBookingStatus as repoUpdateBookingStatus,
} from '../repositories/bookingRepository.js';
import {
  createEquipment as repoCreateEquipment,
  getEquipment as repoGetEquipment,
  getEquipmentById as repoGetEquipmentById,
  updateEquipment as repoUpdateEquipment,
} from '../repositories/equipmentRepository.js';
import {
  createProjectRequest as repoCreateProjectRequest,
  getProjectRequestById as repoGetProjectRequestById,
  getProjectRequests as repoGetProjectRequests,
  updateProjectRequestStatus as repoUpdateProjectRequestStatus,
} from '../repositories/projectRequestRepository.js';
import {
  findConflictingBookings,
  findFeasibleAlternativeSlots,
  isValidIsoDate,
  validateTimeSlot,
} from './schedulingService.js';

export class AppServiceError extends Error {
  statusCode: number;
  code: string;
  details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

function formatHourLabel(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

const CONTROL_CHAR_REGEX = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isValidResourceId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{2,64}$/.test(value.trim());
}

function sanitizeText(value: unknown, fieldName: string, maxLength: number): string {
  if (typeof value !== 'string') {
    throw new AppServiceError(400, 'VALIDATION_ERROR', `${fieldName} is required.`);
  }
  if (CONTROL_CHAR_REGEX.test(value)) {
    throw new AppServiceError(400, 'VALIDATION_ERROR', `${fieldName} contains invalid control characters.`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new AppServiceError(400, 'VALIDATION_ERROR', `${fieldName} is required.`);
  }
  if (trimmed.length > maxLength) {
    throw new AppServiceError(
      400,
      'VALIDATION_ERROR',
      `${fieldName} must be ${maxLength} characters or fewer.`,
    );
  }
  return trimmed;
}

function resolveOptionalStudentEmail(value: unknown, studentName: string): string {
  if (value !== undefined && value !== null) {
    if (typeof value !== 'string') {
      throw new AppServiceError(400, 'VALIDATION_ERROR', 'Student email must be text.');
    }
    if (CONTROL_CHAR_REGEX.test(value)) {
      throw new AppServiceError(400, 'VALIDATION_ERROR', 'Student email contains invalid control characters.');
    }
    const trimmed = value.trim();
    if (trimmed) {
      if (trimmed.length > 120) {
        throw new AppServiceError(400, 'VALIDATION_ERROR', 'Student email must be 120 characters or fewer.');
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
        throw new AppServiceError(400, 'VALIDATION_ERROR', 'Student email must be a valid email address.');
      }
      return trimmed;
    }
  }
  const slug = studentName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '');
  return `${slug || 'student'}@campus.edu`;
}

function parseWholeHourInput(value: unknown): number {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^\d{1,2}$/.test(trimmed)) {
      return Number.parseInt(trimmed, 10);
    }
  }
  return Number.NaN;
}

export function listBookings(filters?: {
  equipmentId?: unknown;
  date?: unknown;
  status?: unknown;
}): Booking[] {
  let equipmentId: string | undefined;
  if (filters?.equipmentId !== undefined && filters.equipmentId !== '') {
    if (!isValidResourceId(filters.equipmentId)) {
      throw new AppServiceError(400, 'VALIDATION_ERROR', 'Malformed equipment ID filter.');
    }
    equipmentId = filters.equipmentId.trim();
  }

  let date: string | undefined;
  if (filters?.date !== undefined && filters.date !== '') {
    if (!isValidIsoDate(filters.date)) {
      throw new AppServiceError(400, 'VALIDATION_ERROR', 'Date filter must be a valid YYYY-MM-DD date.');
    }
    date = filters.date;
  }

  let status: Booking['status'] | undefined;
  if (filters?.status !== undefined && filters.status !== '') {
    if (
      typeof filters.status !== 'string' ||
      !['confirmed', 'pending_faculty', 'cancelled'].includes(filters.status)
    ) {
      throw new AppServiceError(400, 'VALIDATION_ERROR', 'Invalid booking status filter.');
    }
    status = filters.status as Booking['status'];
  }

  return repoGetBookings({
    ...(equipmentId ? { equipmentId } : {}),
    ...(date ? { date } : {}),
    ...(status ? { status } : {}),
  });
}

export function checkSlotAvailability(params: {
  equipmentId: unknown;
  date: unknown;
  startHour: unknown;
  endHour: unknown;
}): SlotAvailabilityResponse {
  if (!isValidResourceId(params.equipmentId)) {
    throw new AppServiceError(400, 'VALIDATION_ERROR', 'A valid equipment resource ID is required.');
  }
  const equipment = repoGetEquipmentById(params.equipmentId.trim());
  if (!equipment) {
    throw new AppServiceError(404, 'NOT_FOUND', 'Selected equipment resource was not found.');
  }
  if (!isValidIsoDate(params.date)) {
    throw new AppServiceError(400, 'VALIDATION_ERROR', 'Date must be a valid YYYY-MM-DD date.');
  }

  const startHour = parseWholeHourInput(params.startHour);
  const endHour = parseWholeHourInput(params.endHour);

  const slotCheck = validateTimeSlot(startHour, endHour, equipment);
  if (!slotCheck.valid) {
    throw new AppServiceError(400, 'INVALID_SLOT', slotCheck.reason ?? 'Invalid time slot.');
  }

  const allEquipment = repoGetEquipment();
  const allBookings = repoGetBookings();

  if (equipment.status === 'maintenance') {
    const alternatives = findFeasibleAlternativeSlots(
      equipment.id,
      params.date,
      startHour,
      endHour,
      allEquipment,
      allBookings,
      4,
    );
    return {
      available: false,
      reason: `${equipment.name} is currently under maintenance and cannot accept bookings.`,
      equipmentId: equipment.id,
      equipmentName: equipment.name,
      date: params.date,
      startHour,
      endHour,
      requiresFacultyApproval: equipment.requiresFacultyApproval,
      conflicts: [],
      alternatives,
    };
  }

  const dayBookings = allBookings.filter((b) => b.equipmentId === equipment.id && b.date === params.date);
  const conflicts = findConflictingBookings(equipment.id, params.date, startHour, endHour, dayBookings);
  const alternatives =
    conflicts.length > 0
      ? findFeasibleAlternativeSlots(
          equipment.id,
          params.date,
          startHour,
          endHour,
          allEquipment,
          allBookings,
          4,
        )
      : [];

  return {
    available: conflicts.length === 0,
    ...(conflicts.length > 0
      ? {
          reason: `Requested slot ${formatHourLabel(startHour)}–${formatHourLabel(endHour)} overlaps with ${conflicts.length} existing ${conflicts.length === 1 ? 'booking' : 'bookings'}.`,
        }
      : {}),
    equipmentId: equipment.id,
    equipmentName: equipment.name,
    date: params.date,
    startHour,
    endHour,
    requiresFacultyApproval: equipment.requiresFacultyApproval,
    conflicts: conflicts.map((c) => ({
      id: c.id,
      studentName: c.studentName,
      projectTitle: c.projectTitle,
      projectDeadline: c.projectDeadline,
      date: c.date,
      startHour: c.startHour,
      endHour: c.endHour,
      status: c.status,
    })),
    alternatives,
  };
}

export function createStudentBooking(input: CreateBookingInput): {
  booking: Booking;
  createdProjectRequest?: ProjectAccessRequest;
} {
  if (!isPlainObject(input)) {
    throw new AppServiceError(400, 'VALIDATION_ERROR', 'Booking payload is required.');
  }

  if (!isValidResourceId(input.equipmentId)) {
    throw new AppServiceError(400, 'VALIDATION_ERROR', 'A valid equipment resource ID is required.');
  }

  const equipment = repoGetEquipmentById(input.equipmentId.trim());
  if (!equipment) {
    throw new AppServiceError(404, 'NOT_FOUND', 'Selected equipment resource was not found.');
  }

  if (equipment.status === 'maintenance') {
    throw new AppServiceError(
      409,
      'EQUIPMENT_MAINTENANCE',
      `${equipment.name} is currently under maintenance and cannot accept bookings.`,
    );
  }

  if (!isValidIsoDate(input.date)) {
    throw new AppServiceError(400, 'VALIDATION_ERROR', 'Booking date must be a valid YYYY-MM-DD date.');
  }
  if (!isValidIsoDate(input.projectDeadline)) {
    throw new AppServiceError(400, 'VALIDATION_ERROR', 'Project deadline must be a valid YYYY-MM-DD date.');
  }

  if (typeof input.startHour !== 'number' || typeof input.endHour !== 'number') {
    throw new AppServiceError(400, 'INVALID_SLOT', 'Start and end hours must be whole numbers.');
  }

  const slotCheck = validateTimeSlot(input.startHour, input.endHour, equipment);
  if (!slotCheck.valid) {
    throw new AppServiceError(400, 'INVALID_SLOT', slotCheck.reason ?? 'Invalid time slot.');
  }

  if (input.resolvedViaAi !== undefined && typeof input.resolvedViaAi !== 'boolean') {
    throw new AppServiceError(400, 'VALIDATION_ERROR', 'resolvedViaAi flag must be a boolean.');
  }

  const studentName = sanitizeText(input.studentName, 'Student or team reference', 80);
  const studentEmail = resolveOptionalStudentEmail(input.studentEmail, studentName);
  const projectTitle = sanitizeText(input.projectTitle, 'Project title', 120);
  const requirementsSummary = sanitizeText(input.requirementsSummary, 'Project purpose / requirements', 300);
  const aiFairnessNote = sanitizeOptionalNote(input.aiFairnessNote, 'AI fairness note', 240);

  const existingBookings = repoGetBookings({ equipmentId: equipment.id, date: input.date });
  const conflicts = findConflictingBookings(
    equipment.id,
    input.date,
    input.startHour,
    input.endHour,
    existingBookings,
  );

  if (conflicts.length > 0) {
    const alternatives = findFeasibleAlternativeSlots(
      equipment.id,
      input.date,
      input.startHour,
      input.endHour,
      repoGetEquipment(),
      repoGetBookings(),
      4,
    );
    const conflictWindowSummary = conflicts
      .map((c) => `${formatHourLabel(c.startHour)}–${formatHourLabel(c.endHour)}`)
      .join(', ');

    const details: BookingConflictDetails = {
      requestedSlot: {
        equipmentId: equipment.id,
        equipmentName: equipment.name,
        date: input.date,
        startHour: input.startHour,
        endHour: input.endHour,
      },
      conflicts: conflicts.map((c) => ({
        id: c.id,
        studentName: c.studentName,
        projectTitle: c.projectTitle,
        projectDeadline: c.projectDeadline,
        date: c.date,
        startHour: c.startHour,
        endHour: c.endHour,
        status: c.status,
      })),
      alternatives,
    };

    throw new AppServiceError(
      409,
      'BOOKING_CONFLICT',
      `Requested slot ${formatHourLabel(input.startHour)}–${formatHourLabel(input.endHour)} on ${input.date} overlaps with ${conflicts.length} existing ${conflicts.length === 1 ? 'booking' : 'bookings'} (${conflictWindowSummary}).`,
      details,
    );
  }

  const nowIso = new Date().toISOString();
  const bookingId = `bk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const status = equipment.requiresFacultyApproval ? 'pending_faculty' : 'confirmed';

  const booking = repoCreateBooking({
    id: bookingId,
    equipmentId: equipment.id,
    studentName,
    studentEmail,
    projectTitle,
    projectDeadline: input.projectDeadline,
    requirementsSummary,
    date: input.date,
    startHour: input.startHour,
    endHour: input.endHour,
    status,
    createdAt: nowIso,
    resolvedViaAi: Boolean(input.resolvedViaAi),
    aiFairnessNote,
  });

  let createdProjectRequest: ProjectAccessRequest | undefined;
  if (equipment.requiresFacultyApproval) {
    createdProjectRequest = repoCreateProjectRequest({
      id: `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      equipmentId: equipment.id,
      equipmentName: equipment.name,
      labLocation: equipment.labLocation,
      linkedBookingId: booking.id,
      studentName,
      department: equipment.department,
      projectTitle,
      projectDescription: requirementsSummary,
      projectDeadline: input.projectDeadline,
      equipmentRequirements: requirementsSummary,
      justification: `Requested ${input.endHour - input.startHour}h supervised access on ${input.date} (${formatHourLabel(input.startHour)}–${formatHourLabel(input.endHour)}).`,
      requestedHours: input.endHour - input.startHour,
      preferredDate: input.date,
      preferredStartHour: input.startHour,
      preferredEndHour: input.endHour,
      status: 'pending',
      createdAt: nowIso,
    });
  }

  return { booking, createdProjectRequest };
}

export function cancelStudentBooking(bookingId: unknown): Booking {
  if (!isValidResourceId(bookingId)) {
    throw new AppServiceError(400, 'VALIDATION_ERROR', 'Malformed booking ID.');
  }
  const cleanId = bookingId.trim();
  const existing = repoGetBookingById(cleanId);
  if (!existing) {
    throw new AppServiceError(404, 'NOT_FOUND', 'Booking not found.');
  }
  if (existing.status === 'cancelled') {
    throw new AppServiceError(400, 'INVALID_STATE', 'Booking is already cancelled.');
  }

  const updated = repoUpdateBookingStatus(cleanId, 'cancelled');
  if (!updated) {
    throw new AppServiceError(404, 'NOT_FOUND', 'Booking not found.');
  }
  return updated;
}

export function listProjectRequests(filters?: {
  status?: unknown;
  equipmentId?: unknown;
}): ProjectAccessRequest[] {
  let statusFilter: ProjectAccessRequest['status'] | undefined;
  if (filters?.status !== undefined && filters.status !== '') {
    if (
      typeof filters.status !== 'string' ||
      !['pending', 'approved', 'rejected', 'conflict', 'cancelled'].includes(filters.status)
    ) {
      throw new AppServiceError(400, 'VALIDATION_ERROR', 'Invalid project request status filter.');
    }
    statusFilter = filters.status as ProjectAccessRequest['status'];
  }

  let equipmentIdFilter: string | undefined;
  if (filters?.equipmentId !== undefined && filters.equipmentId !== '') {
    if (!isValidResourceId(filters.equipmentId)) {
      throw new AppServiceError(400, 'VALIDATION_ERROR', 'Malformed equipment ID filter.');
    }
    equipmentIdFilter = filters.equipmentId.trim();
  }

  const equipmentById = new Map(repoGetEquipment().map((eq) => [eq.id, eq]));
  return repoGetProjectRequests({
    ...(statusFilter ? { status: statusFilter } : {}),
    ...(equipmentIdFilter ? { equipmentId: equipmentIdFilter } : {}),
  }).map((req) => {
    const eq = equipmentById.get(req.equipmentId);
    return {
      ...req,
      equipmentName: req.equipmentName ?? eq?.name,
      labLocation: req.labLocation ?? eq?.labLocation,
    };
  });
}

export function getProjectRequestDetails(requestId: unknown): {
  request: ProjectAccessRequest;
  linkedBooking?: Booking;
} {
  if (!isValidResourceId(requestId)) {
    throw new AppServiceError(400, 'VALIDATION_ERROR', 'Malformed project request ID.');
  }

  const existing = repoGetProjectRequestById(requestId.trim());
  if (!existing) {
    throw new AppServiceError(404, 'NOT_FOUND', 'Project access request not found.');
  }

  const eq = repoGetEquipmentById(existing.equipmentId);
  const linkedBooking = existing.linkedBookingId
    ? repoGetBookingById(existing.linkedBookingId)
    : undefined;

  return {
    request: {
      ...existing,
      equipmentName: existing.equipmentName ?? eq?.name,
      labLocation: existing.labLocation ?? eq?.labLocation,
    },
    ...(linkedBooking ? { linkedBooking } : {}),
  };
}

export function submitProjectRequest(input: CreateProjectRequestInput): {
  request: ProjectAccessRequest;
  linkedBooking?: Booking;
} {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new AppServiceError(400, 'VALIDATION_ERROR', 'Project access request payload is required.');
  }

  if (!isValidResourceId(input.equipmentId)) {
    throw new AppServiceError(400, 'VALIDATION_ERROR', 'A valid equipment resource ID is required.');
  }

  const equipment = repoGetEquipmentById(input.equipmentId.trim());
  if (!equipment) {
    throw new AppServiceError(404, 'NOT_FOUND', 'Selected equipment resource was not found.');
  }

  if (!isValidIsoDate(input.preferredDate)) {
    throw new AppServiceError(400, 'VALIDATION_ERROR', 'Preferred date must be a valid YYYY-MM-DD date.');
  }
  if (!isValidIsoDate(input.projectDeadline)) {
    throw new AppServiceError(400, 'VALIDATION_ERROR', 'Project deadline must be a valid YYYY-MM-DD date.');
  }

  const studentName = sanitizeText(input.studentName, 'Student or project reference', 80);
  const department = sanitizeText(input.department, 'Department', 80);
  const projectTitle = sanitizeText(input.projectTitle, 'Project title', 120);
  const projectDescription = sanitizeText(input.projectDescription, 'Project description', 600);
  const justification = sanitizeText(input.justification, 'Reason for resource access', 500);

  let equipmentRequirements: string;
  if (input.equipmentRequirements === undefined) {
    equipmentRequirements = justification.slice(0, 300);
  } else if (typeof input.equipmentRequirements !== 'string') {
    throw new AppServiceError(400, 'VALIDATION_ERROR', 'Equipment requirements must be text.');
  } else {
    const trimmedReq = input.equipmentRequirements.trim();
    if (trimmedReq.length > 300) {
      throw new AppServiceError(
        400,
        'VALIDATION_ERROR',
        'Equipment requirements must be 300 characters or fewer.',
      );
    }
    equipmentRequirements = trimmedReq || justification.slice(0, 300);
  }

  if (typeof input.preferredStartHour !== 'number') {
    throw new AppServiceError(400, 'INVALID_SLOT', 'Preferred start time must be a whole hour.');
  }
  const preferredStartHour = input.preferredStartHour;
  const rawEndHour =
    input.preferredEndHour !== undefined
      ? input.preferredEndHour
      : typeof input.requestedHours === 'number'
        ? preferredStartHour + input.requestedHours
        : undefined;

  if (typeof rawEndHour !== 'number') {
    throw new AppServiceError(400, 'INVALID_SLOT', 'Preferred end time must be a whole hour.');
  }
  const preferredEndHour = rawEndHour;

  if (!Number.isInteger(preferredStartHour) || !Number.isInteger(preferredEndHour)) {
    throw new AppServiceError(
      400,
      'INVALID_SLOT',
      'Preferred start and end times must be whole hours.',
    );
  }
  if (preferredEndHour <= preferredStartHour) {
    throw new AppServiceError(
      400,
      'INVALID_SLOT',
      'Preferred end time must be after preferred start time.',
    );
  }
  if (preferredStartHour < equipment.openHour || preferredEndHour > equipment.closeHour) {
    throw new AppServiceError(
      400,
      'INVALID_SLOT',
      `Preferred time window must fall within lab operating hours (${formatHourLabel(equipment.openHour)}–${formatHourLabel(equipment.closeHour)}).`,
    );
  }

  const requestedHours = preferredEndHour - preferredStartHour;
  if (requestedHours > 8) {
    throw new AppServiceError(
      400,
      'INVALID_SLOT',
      'Project access requests are capped at 8 hours per requested window.',
    );
  }
  if (requestedHours <= 4) {
    const slotCheck = validateTimeSlot(preferredStartHour, preferredEndHour, equipment);
    if (!slotCheck.valid) {
      throw new AppServiceError(400, 'INVALID_SLOT', slotCheck.reason ?? 'Invalid preferred time window.');
    }
  }

  let linkedBooking: Booking | undefined;
  const nowIso = new Date().toISOString();

  // Safely link a provisional pending_faculty hold when the requested window fits standard booking limits and is conflict-free
  if (requestedHours <= 4 && equipment.status !== 'maintenance') {
    const existingBookings = repoGetBookings({
      equipmentId: equipment.id,
      date: input.preferredDate,
    });
    const conflicts = findConflictingBookings(
      equipment.id,
      input.preferredDate,
      preferredStartHour,
      preferredEndHour,
      existingBookings,
    );
    if (conflicts.length === 0) {
      linkedBooking = repoCreateBooking({
        id: `bk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        equipmentId: equipment.id,
        studentName,
        studentEmail: resolveOptionalStudentEmail(undefined, studentName),
        projectTitle,
        projectDeadline: input.projectDeadline,
        requirementsSummary: equipmentRequirements,
        date: input.preferredDate,
        startHour: preferredStartHour,
        endHour: preferredEndHour,
        status: 'pending_faculty',
        createdAt: nowIso,
        resolvedViaAi: false,
      });
    }
  }

  const request = repoCreateProjectRequest({
    id: `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    equipmentId: equipment.id,
    equipmentName: equipment.name,
    labLocation: equipment.labLocation,
    linkedBookingId: linkedBooking?.id,
    studentName,
    department,
    projectTitle,
    projectDescription,
    projectDeadline: input.projectDeadline,
    equipmentRequirements,
    justification,
    requestedHours,
    preferredDate: input.preferredDate,
    preferredStartHour,
    preferredEndHour,
    status: 'pending',
    createdAt: nowIso,
  });

  return { request, linkedBooking };
}

function sanitizeOptionalNote(value: unknown, fieldName: string, maxLength: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw new AppServiceError(400, 'VALIDATION_ERROR', `${fieldName} must be text.`);
  }
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value)) {
    throw new AppServiceError(400, 'VALIDATION_ERROR', `${fieldName} contains invalid control characters.`);
  }
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > maxLength) {
    throw new AppServiceError(400, 'VALIDATION_ERROR', `${fieldName} must be ${maxLength} characters or fewer.`);
  }
  return trimmed;
}

export function reviewProjectRequest(
  requestId: string,
  decision: 'approved' | 'rejected',
  facultyReviewer: string,
  facultyDecisionNote?: string,
): {
  request: ProjectAccessRequest;
  updatedBooking?: Booking;
} {
  if (!isValidResourceId(requestId)) {
    throw new AppServiceError(400, 'VALIDATION_ERROR', 'Malformed project request ID.');
  }
  const cleanId = requestId.trim();
  const existing = repoGetProjectRequestById(cleanId);
  if (!existing) {
    throw new AppServiceError(404, 'NOT_FOUND', 'Project access request not found.');
  }

  if (existing.status !== 'pending' && existing.status !== 'conflict') {
    throw new AppServiceError(
      400,
      'INVALID_STATE',
      `Project request cannot be ${decision} because its status is already "${existing.status}".`,
    );
  }

  const reviewer = sanitizeText(facultyReviewer, 'Faculty reviewer', 80);
  const nowIso = new Date().toISOString();

  if (decision === 'rejected') {
    const rejectionReason = sanitizeText(facultyDecisionNote, 'Rejection reason', 300);
    let updatedBooking: Booking | undefined;

    if (existing.linkedBookingId) {
      const linked = repoGetBookingById(existing.linkedBookingId);
      if (linked && linked.status !== 'cancelled') {
        updatedBooking = repoUpdateBookingStatus(linked.id, 'cancelled');
      }
    }

    const updatedRequest = repoUpdateProjectRequestStatus(cleanId, {
      status: 'rejected',
      facultyReviewer: reviewer,
      facultyDecisionNote: rejectionReason,
      reviewedAt: nowIso,
    });
    if (!updatedRequest) {
      throw new AppServiceError(404, 'NOT_FOUND', 'Project access request not found.');
    }

    return { request: updatedRequest, updatedBooking };
  }

  // Approval path: deterministically validate equipment, schedule window, and active overlaps
  const optionalNote = sanitizeOptionalNote(facultyDecisionNote, 'Faculty decision note', 300);
  const equipment = repoGetEquipmentById(existing.equipmentId);
  if (!equipment) {
    throw new AppServiceError(404, 'NOT_FOUND', 'Requested equipment resource no longer exists.');
  }
  if (equipment.status === 'maintenance') {
    throw new AppServiceError(
      409,
      'EQUIPMENT_MAINTENANCE',
      `Cannot approve request while ${equipment.name} is under maintenance.`,
    );
  }

  const existingLinked = existing.linkedBookingId
    ? repoGetBookingById(existing.linkedBookingId)
    : undefined;
  const activeLinked = existingLinked && existingLinked.status !== 'cancelled' ? existingLinked : undefined;

  const targetDate = activeLinked?.date ?? existing.preferredDate;
  const targetStartHour = activeLinked?.startHour ?? existing.preferredStartHour;
  const targetEndHour =
    activeLinked?.endHour ??
    existing.preferredEndHour ??
    (targetStartHour !== undefined ? targetStartHour + existing.requestedHours : undefined);

  if (!isValidIsoDate(targetDate)) {
    throw new AppServiceError(400, 'VALIDATION_ERROR', 'Requested access date is invalid.');
  }
  if (
    typeof targetStartHour !== 'number' ||
    typeof targetEndHour !== 'number' ||
    !Number.isInteger(targetStartHour) ||
    !Number.isInteger(targetEndHour)
  ) {
    throw new AppServiceError(400, 'INVALID_SLOT', 'Requested schedule must specify valid whole hours.');
  }
  if (targetEndHour <= targetStartHour) {
    throw new AppServiceError(400, 'INVALID_SLOT', 'Requested end time must be after start time.');
  }
  if (targetStartHour < equipment.openHour || targetEndHour > equipment.closeHour) {
    throw new AppServiceError(
      400,
      'INVALID_SLOT',
      `Requested slot must fall within lab operating hours (${formatHourLabel(equipment.openHour)}–${formatHourLabel(equipment.closeHour)}).`,
    );
  }
  if (targetEndHour - targetStartHour <= 4) {
    const slotCheck = validateTimeSlot(targetStartHour, targetEndHour, equipment);
    if (!slotCheck.valid) {
      throw new AppServiceError(400, 'INVALID_SLOT', slotCheck.reason ?? 'Invalid time slot.');
    }
  } else if (targetEndHour - targetStartHour > 8) {
    throw new AppServiceError(400, 'INVALID_SLOT', 'Approved project slot cannot exceed 8 hours.');
  }

  const dayBookings = repoGetBookings({ equipmentId: equipment.id, date: targetDate });
  const conflicts = findConflictingBookings(
    equipment.id,
    targetDate,
    targetStartHour,
    targetEndHour,
    dayBookings,
    activeLinked?.id,
  );

  if (conflicts.length > 0) {
    const conflictSummary = conflicts
      .map((c) => `${formatHourLabel(c.startHour)}–${formatHourLabel(c.endHour)}`)
      .join(', ');

    repoUpdateProjectRequestStatus(cleanId, {
      status: 'conflict',
      facultyReviewer: reviewer,
      facultyDecisionNote:
        optionalNote ??
        `Approval blocked: overlaps existing booking (${conflictSummary}) on ${targetDate}.`,
      reviewedAt: nowIso,
    });

    throw new AppServiceError(
      409,
      'SCHEDULE_CONFLICT',
      `Cannot approve request: ${targetDate} (${formatHourLabel(targetStartHour)}–${formatHourLabel(targetEndHour)}) conflicts with existing active booking (${conflictSummary}).`,
      {
        conflicts: conflicts.map((c) => ({
          id: c.id,
          studentName: c.studentName,
          projectTitle: c.projectTitle,
          projectDeadline: c.projectDeadline,
          date: c.date,
          startHour: c.startHour,
          endHour: c.endHour,
          status: c.status,
        })),
      },
    );
  }

  let updatedBooking: Booking | undefined;
  if (activeLinked) {
    updatedBooking = repoUpdateBookingStatus(activeLinked.id, 'confirmed');
  } else {
    updatedBooking = repoCreateBooking({
      id: `bk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      equipmentId: equipment.id,
      studentName: existing.studentName,
      studentEmail: resolveOptionalStudentEmail(undefined, existing.studentName),
      projectTitle: existing.projectTitle,
      projectDeadline: existing.projectDeadline,
      requirementsSummary: existing.equipmentRequirements,
      date: targetDate,
      startHour: targetStartHour,
      endHour: targetEndHour,
      status: 'confirmed',
      createdAt: nowIso,
      resolvedViaAi: false,
    });
  }

  const updatedRequest = repoUpdateProjectRequestStatus(cleanId, {
    status: 'approved',
    facultyReviewer: reviewer,
    facultyDecisionNote: optionalNote,
    reviewedAt: nowIso,
    linkedBookingId: updatedBooking?.id ?? existing.linkedBookingId,
  });

  if (!updatedRequest) {
    throw new AppServiceError(404, 'NOT_FOUND', 'Project access request not found.');
  }

  return { request: updatedRequest, updatedBooking };
}

export function approveProjectRequest(
  requestId: string,
  facultyReviewer: string,
  facultyDecisionNote?: string,
): {
  request: ProjectAccessRequest;
  updatedBooking?: Booking;
} {
  return reviewProjectRequest(requestId, 'approved', facultyReviewer, facultyDecisionNote);
}

export function rejectProjectRequest(
  requestId: string,
  facultyReviewer: string,
  rejectionReason: string,
): {
  request: ProjectAccessRequest;
  updatedBooking?: Booking;
} {
  return reviewProjectRequest(requestId, 'rejected', facultyReviewer, rejectionReason);
}

export function createAdminEquipment(input: CreateEquipmentInput): Equipment {
  if (!isPlainObject(input)) {
    throw new AppServiceError(400, 'VALIDATION_ERROR', 'Equipment payload is required.');
  }

  const name = sanitizeText(input.name, 'Equipment name', 100);
  const department = sanitizeText(input.department, 'Department', 80);
  const labLocation = sanitizeText(input.labLocation, 'Lab location', 80);
  const category = sanitizeText(input.category, 'Category', 60);
  const description = sanitizeText(input.description, 'Description', 300);

  if (!Array.isArray(input.capabilities)) {
    throw new AppServiceError(400, 'VALIDATION_ERROR', 'Capabilities must be provided as a list.');
  }
  const capabilities: string[] = [];
  for (const rawCap of input.capabilities) {
    if (typeof rawCap !== 'string') {
      throw new AppServiceError(400, 'VALIDATION_ERROR', 'Each capability must be text.');
    }
    if (CONTROL_CHAR_REGEX.test(rawCap)) {
      throw new AppServiceError(400, 'VALIDATION_ERROR', 'Capability contains invalid control characters.');
    }
    const cleanCap = rawCap.trim();
    if (!cleanCap) continue;
    if (cleanCap.length > 60) {
      throw new AppServiceError(400, 'VALIDATION_ERROR', 'Each capability must be 60 characters or fewer.');
    }
    capabilities.push(cleanCap);
    if (capabilities.length >= 8) break;
  }
  if (capabilities.length === 0) {
    throw new AppServiceError(400, 'VALIDATION_ERROR', 'At least one equipment capability is required.');
  }

  if (
    typeof input.openHour !== 'number' ||
    typeof input.closeHour !== 'number' ||
    !Number.isInteger(input.openHour) ||
    !Number.isInteger(input.closeHour) ||
    input.openHour < 6 ||
    input.closeHour > 23 ||
    input.closeHour <= input.openHour
  ) {
    throw new AppServiceError(
      400,
      'VALIDATION_ERROR',
      'Operating hours must be valid whole hours between 06:00 and 23:00.',
    );
  }

  const totalUnits = input.totalUnits !== undefined ? input.totalUnits : 1;
  if (typeof totalUnits !== 'number' || !Number.isInteger(totalUnits) || totalUnits < 1 || totalUnits > 50) {
    throw new AppServiceError(400, 'VALIDATION_ERROR', 'Total units must be a whole number between 1 and 50.');
  }

  if (
    input.requiresFacultyApproval !== undefined &&
    typeof input.requiresFacultyApproval !== 'boolean'
  ) {
    throw new AppServiceError(400, 'VALIDATION_ERROR', 'requiresFacultyApproval must be a boolean.');
  }
  const requiresFacultyApproval = Boolean(input.requiresFacultyApproval);

  const allExisting = repoGetEquipment();
  const fallbackImage =
    allExisting[0]?.imageUrl ?? '/src/assets/images/equip_oscilloscope_1795420251674.jpg';

  return repoCreateEquipment({
    id: `eq-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
    name,
    department,
    labLocation,
    category,
    description,
    capabilities,
    requiresFacultyApproval,
    status: requiresFacultyApproval ? 'restricted' : 'available',
    openHour: input.openHour,
    closeHour: input.closeHour,
    totalUnits,
    availableUnits: totalUnits,
    imageUrl: fallbackImage,
  });
}

const ALLOWED_EQUIPMENT_UPDATE_KEYS = new Set([
  'status',
  'requiresFacultyApproval',
  'labLocation',
  'description',
  'availableUnits',
]);

export function updateAdminEquipment(id: string, patch: UpdateEquipmentInput): Equipment {
  if (!isValidResourceId(id)) {
    throw new AppServiceError(400, 'VALIDATION_ERROR', 'Malformed equipment ID.');
  }
  if (!isPlainObject(patch)) {
    throw new AppServiceError(400, 'VALIDATION_ERROR', 'Equipment update payload must be an object.');
  }

  const patchKeys = Object.keys(patch);
  if (patchKeys.length === 0) {
    throw new AppServiceError(400, 'VALIDATION_ERROR', 'At least one updatable equipment field is required.');
  }
  for (const key of patchKeys) {
    if (!ALLOWED_EQUIPMENT_UPDATE_KEYS.has(key)) {
      throw new AppServiceError(
        400,
        'VALIDATION_ERROR',
        `Field "${key}" cannot be updated via this endpoint.`,
      );
    }
  }

  const cleanId = id.trim();
  const existing = repoGetEquipmentById(cleanId);
  if (!existing) {
    throw new AppServiceError(404, 'NOT_FOUND', 'Equipment resource not found.');
  }

  const nextPatch: UpdateEquipmentInput = {};

  if (patch.status !== undefined) {
    if (typeof patch.status !== 'string' || !['available', 'maintenance', 'restricted'].includes(patch.status)) {
      throw new AppServiceError(400, 'VALIDATION_ERROR', 'Invalid equipment status.');
    }
    nextPatch.status = patch.status as Equipment['status'];
  }

  if (patch.requiresFacultyApproval !== undefined) {
    if (typeof patch.requiresFacultyApproval !== 'boolean') {
      throw new AppServiceError(400, 'VALIDATION_ERROR', 'requiresFacultyApproval must be a boolean.');
    }
    nextPatch.requiresFacultyApproval = patch.requiresFacultyApproval;
  }

  if (patch.labLocation !== undefined) {
    nextPatch.labLocation = sanitizeText(patch.labLocation, 'Lab location', 80);
  }

  if (patch.description !== undefined) {
    nextPatch.description = sanitizeText(patch.description, 'Description', 300);
  }

  if (patch.availableUnits !== undefined) {
    if (
      typeof patch.availableUnits !== 'number' ||
      !Number.isInteger(patch.availableUnits) ||
      patch.availableUnits < 0 ||
      patch.availableUnits > existing.totalUnits
    ) {
      throw new AppServiceError(
        400,
        'VALIDATION_ERROR',
        `Available units must be a whole number between 0 and ${existing.totalUnits}.`,
      );
    }
    nextPatch.availableUnits = patch.availableUnits;
  }

  if (nextPatch.status === 'maintenance') {
    nextPatch.availableUnits = 0;
  } else if (nextPatch.status && existing.status === 'maintenance' && nextPatch.availableUnits === undefined) {
    nextPatch.availableUnits = Math.max(1, existing.totalUnits);
  }

  const updated = repoUpdateEquipment(cleanId, nextPatch);
  if (!updated) {
    throw new AppServiceError(404, 'NOT_FOUND', 'Equipment resource not found.');
  }
  return updated;
}
