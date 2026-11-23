export type UserRole = 'student' | 'faculty' | 'admin';

export type EquipmentStatus = 'available' | 'maintenance' | 'restricted';

export type BookingStatus = 'confirmed' | 'pending_faculty' | 'cancelled';

export type ProjectRequestStatus = 'pending' | 'approved' | 'rejected' | 'conflict' | 'cancelled';

export interface Equipment {
  id: string;
  name: string;
  department: string;
  labLocation: string;
  category: string;
  description: string;
  capabilities: string[];
  requiresFacultyApproval: boolean;
  status: EquipmentStatus;
  openHour: number;
  closeHour: number;
  totalUnits: number;
  availableUnits: number;
  imageUrl: string;
}

export type EquipmentAvailabilityFilter =
  | 'all'
  | 'available'
  | 'instant'
  | 'approval'
  | 'maintenance';

export interface EquipmentDiscoveryFilters {
  q?: string;
  department?: string;
  category?: string;
  availability?: EquipmentAvailabilityFilter;
}

export interface Booking {
  id: string;
  equipmentId: string;
  studentName: string;
  studentEmail: string;
  projectTitle: string;
  projectDeadline: string; // YYYY-MM-DD
  requirementsSummary: string;
  date: string; // YYYY-MM-DD
  startHour: number; // 0-23
  endHour: number; // 1-24
  status: BookingStatus;
  createdAt: string;
  resolvedViaAi: boolean;
  aiFairnessNote?: string;
}

export interface ProjectAccessRequest {
  id: string;
  equipmentId: string;
  equipmentName?: string;
  labLocation?: string;
  linkedBookingId?: string;
  studentName: string;
  department: string;
  projectTitle: string;
  projectDescription: string;
  projectDeadline: string; // YYYY-MM-DD
  equipmentRequirements: string;
  justification: string;
  requestedHours: number;
  preferredDate: string; // YYYY-MM-DD
  preferredStartHour?: number;
  preferredEndHour?: number;
  status: ProjectRequestStatus;
  facultyReviewer?: string;
  facultyDecisionNote?: string;
  reviewedAt?: string;
  createdAt: string;
}

export interface CandidateSlot {
  equipmentId: string;
  equipmentName: string;
  department: string;
  labLocation: string;
  date: string;
  startHour: number;
  endHour: number;
  isSameEquipment: boolean;
  requiresFacultyApproval: boolean;
}

export interface ConflictResolutionRequest {
  equipmentId: string;
  date: string;
  startHour: number;
  endHour: number;
  studentName: string;
  projectTitle: string;
  projectDescription?: string;
  projectDeadline: string;
  requirementsSummary: string;
  requiredCapabilities?: string[];
}

export interface ConflictAlternativeSlot {
  alternativeId: string;
  equipmentId: string;
  equipmentName: string;
  department: string;
  labLocation: string;
  date: string;
  startHour: number;
  endHour: number;
  isSameEquipment: boolean;
  requiresFacultyApproval: boolean;
  tradeoffNote?: string;
}

export interface ValidatedAlternativeSlot {
  alternativeId?: string;
  equipmentId: string;
  equipmentName: string;
  department: string;
  labLocation: string;
  date: string;
  startHour: number;
  endHour: number;
  requiresFacultyApproval: boolean;
  tradeoffNote: string;
}

export interface ConflictAiRecommendation {
  alternativeId: string;
  recommendedAlternativeId: string;
  slot: ConflictAlternativeSlot;
  reason: string;
  fairnessExplanation: string;
  deadlineConsideration: string;
  availabilityConsideration: string;
  confidence: number;
  validated: true;
  backupAlternatives: ValidatedAlternativeSlot[];
}

export interface ConflictResolutionResponse {
  conflict: boolean;
  requestedSlot: {
    equipmentId: string;
    equipmentName: string;
    department: string;
    labLocation: string;
    date: string;
    startHour: number;
    endHour: number;
  };
  alternatives: ConflictAlternativeSlot[];
  recommendation: ConflictAiRecommendation | null;
  aiStatus: 'available' | 'unavailable' | 'not_needed';
  message?: string;
  fallbackMessage?: string;
  conflictingBookings: Array<{
    id: string;
    bookingRef: string;
    projectTitle: string;
    projectDeadline: string;
    startHour: number;
    endHour: number;
    status: BookingStatus;
    studentName?: string;
  }>;
}

export interface EquipmentUtilization {
  equipmentId: string;
  equipmentName: string;
  department: string;
  status: EquipmentStatus;
  bookedHours: number;
  totalCapacityHours: number;
  utilizationPercent: number;
  activeBookingsCount: number;
  pendingRequestsCount: number;
}

export interface BookingConflictItem {
  id: string;
  studentName: string;
  projectTitle: string;
  projectDeadline: string;
  date: string;
  startHour: number;
  endHour: number;
  status: BookingStatus;
}

export interface BookingConflictDetails {
  requestedSlot: {
    equipmentId: string;
    equipmentName: string;
    date: string;
    startHour: number;
    endHour: number;
  };
  conflicts: BookingConflictItem[];
  alternatives: CandidateSlot[];
}

export interface SlotAvailabilityResponse {
  available: boolean;
  reason?: string;
  equipmentId: string;
  equipmentName: string;
  date: string;
  startHour: number;
  endHour: number;
  requiresFacultyApproval: boolean;
  conflicts: BookingConflictItem[];
  alternatives: CandidateSlot[];
}

export interface CreateBookingInput {
  equipmentId: string;
  studentName: string;
  studentEmail?: string;
  projectTitle: string;
  projectDeadline: string;
  requirementsSummary: string;
  date: string;
  startHour: number;
  endHour: number;
  resolvedViaAi?: boolean;
  aiFairnessNote?: string;
}

export interface CreateProjectRequestInput {
  equipmentId: string;
  studentName: string;
  department: string;
  projectTitle: string;
  projectDescription: string;
  projectDeadline: string;
  equipmentRequirements?: string;
  justification: string;
  requestedHours?: number;
  preferredDate: string;
  preferredStartHour: number;
  preferredEndHour: number;
}

export interface CreateEquipmentInput {
  name: string;
  department: string;
  labLocation: string;
  category: string;
  description: string;
  capabilities: string[];
  requiresFacultyApproval: boolean;
  openHour: number;
  closeHour: number;
  totalUnits?: number;
}

export interface UpdateEquipmentInput {
  status?: EquipmentStatus;
  requiresFacultyApproval?: boolean;
  labLocation?: string;
  description?: string;
  availableUnits?: number;
}

export interface LabLinkStateSnapshot {
  today: string;
  tomorrow: string;
  equipment: Equipment[];
  bookings: Booking[];
  projectRequests: ProjectAccessRequest[];
  utilization: EquipmentUtilization[];
}
