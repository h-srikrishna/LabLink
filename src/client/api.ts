import type {
  Booking,
  ConflictResolutionRequest,
  ConflictResolutionResponse,
  CreateBookingInput,
  CreateEquipmentInput,
  CreateProjectRequestInput,
  Equipment,
  LabLinkStateSnapshot,
  ProjectAccessRequest,
  SlotAvailabilityResponse,
  UpdateEquipmentInput,
  UserRole,
} from '../shared/types.js';

export class ApiClientError extends Error {
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

async function apiRequest<T>(
  url: string,
  options: RequestInit = {},
  role: UserRole = 'student',
): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-lablink-role': role,
      ...(options.headers ?? {}),
    },
  });

  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  if (!response.ok) {
    throw new ApiClientError(
      response.status,
      typeof data.code === 'string' ? data.code : 'REQUEST_FAILED',
      typeof data.error === 'string' ? data.error : 'Request failed. Please try again.',
      data.details,
    );
  }

  return data as T;
}

export function fetchLabLinkState(): Promise<LabLinkStateSnapshot> {
  return apiRequest<LabLinkStateSnapshot>('/api/state');
}

export function resetDemoState(): Promise<LabLinkStateSnapshot> {
  return apiRequest<LabLinkStateSnapshot>('/api/demo/reset', { method: 'POST' });
}

export function checkSlotAvailabilityApi(params: {
  equipmentId: string;
  date: string;
  startHour: number;
  endHour: number;
}): Promise<SlotAvailabilityResponse> {
  const query = new URLSearchParams({
    equipmentId: params.equipmentId,
    date: params.date,
    startHour: String(params.startHour),
    endHour: String(params.endHour),
  });
  return apiRequest<SlotAvailabilityResponse>(`/api/bookings/availability?${query.toString()}`);
}

export function createBookingApi(
  input: CreateBookingInput,
  role: UserRole,
): Promise<{
  booking: Booking;
  createdProjectRequest?: ProjectAccessRequest;
  state: LabLinkStateSnapshot;
}> {
  return apiRequest('/api/bookings', { method: 'POST', body: JSON.stringify(input) }, role);
}

export function cancelBookingApi(
  bookingId: string,
  role: UserRole,
): Promise<{ booking: Booking; state: LabLinkStateSnapshot }> {
  return apiRequest(`/api/bookings/${encodeURIComponent(bookingId)}/cancel`, { method: 'PATCH' }, role);
}

export function resolveConflictApi(
  input: ConflictResolutionRequest,
  role: UserRole,
): Promise<ConflictResolutionResponse> {
  return apiRequest('/api/ai/resolve-conflict', { method: 'POST', body: JSON.stringify(input) }, role);
}

export function getProjectRequestByIdApi(
  requestId: string,
): Promise<{
  request: ProjectAccessRequest;
  linkedBooking?: Booking;
}> {
  return apiRequest(`/api/project-requests/${encodeURIComponent(requestId)}`);
}

export function createProjectRequestApi(
  input: CreateProjectRequestInput,
  role: UserRole,
): Promise<{
  request: ProjectAccessRequest;
  linkedBooking?: Booking;
  state: LabLinkStateSnapshot;
}> {
  return apiRequest('/api/project-requests', { method: 'POST', body: JSON.stringify(input) }, role);
}

export function reviewProjectRequestApi(
  requestId: string,
  decision: 'approved' | 'rejected',
  facultyReviewer: string,
  facultyDecisionNote: string,
  role: UserRole,
): Promise<{
  request: ProjectAccessRequest;
  updatedBooking?: Booking;
  state: LabLinkStateSnapshot;
}> {
  const action = decision === 'approved' ? 'approve' : 'reject';
  return apiRequest(
    `/api/project-requests/${encodeURIComponent(requestId)}/${action}`,
    {
      method: 'POST',
      body: JSON.stringify({
        facultyReviewer,
        facultyDecisionNote,
        reason: facultyDecisionNote,
      }),
    },
    role,
  );
}

export function createEquipmentApi(
  input: CreateEquipmentInput,
  role: UserRole,
): Promise<{ equipment: Equipment; state: LabLinkStateSnapshot }> {
  return apiRequest('/api/equipment', { method: 'POST', body: JSON.stringify(input) }, role);
}

export function updateEquipmentApi(
  equipmentId: string,
  patch: UpdateEquipmentInput,
  role: UserRole,
): Promise<{ equipment: Equipment; state: LabLinkStateSnapshot }> {
  return apiRequest(
    `/api/equipment/${encodeURIComponent(equipmentId)}`,
    { method: 'PATCH', body: JSON.stringify(patch) },
    role,
  );
}
