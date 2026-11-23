import type {
  Booking,
  CandidateSlot,
  ConflictAiRecommendation,
  ConflictAlternativeSlot,
  Equipment,
  EquipmentUtilization,
  ProjectAccessRequest,
  ValidatedAlternativeSlot,
} from '../../shared/types.js';
export interface SlotValidationResult {
  valid: boolean;
  reason?: string;
}

export function isValidIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.toISOString().slice(0, 10) === value;
}

export function addDaysToIsoDate(isoDate: string, days: number): string {
  const parsed = new Date(`${isoDate}T12:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

export function doIntervalsOverlap(
  startA: number,
  endA: number,
  startB: number,
  endB: number,
): boolean {
  return startA < endB && startB < endA;
}

export function validateTimeSlot(
  startHour: number,
  endHour: number,
  equipment: Equipment,
): SlotValidationResult {
  if (!Number.isInteger(startHour) || !Number.isInteger(endHour)) {
    return { valid: false, reason: 'Start and end hours must be whole hours.' };
  }
  if (startHour < equipment.openHour || endHour > equipment.closeHour) {
    return {
      valid: false,
      reason: `Booking must fall within lab operating hours (${String(equipment.openHour).padStart(2, '0')}:00–${String(equipment.closeHour).padStart(2, '0')}:00).`,
    };
  }
  if (endHour <= startHour) {
    return { valid: false, reason: 'End hour must be after start hour.' };
  }
  if (endHour - startHour > 4) {
    return { valid: false, reason: 'Standard equipment slots are capped at 4 hours per booking.' };
  }
  return { valid: true };
}

export function findConflictingBookings(
  equipmentId: string,
  date: string,
  startHour: number,
  endHour: number,
  bookings: Booking[],
  excludeBookingId?: string,
): Booking[] {
  return bookings.filter((booking) => {
    if (booking.status === 'cancelled') return false;
    if (excludeBookingId && booking.id === excludeBookingId) return false;
    if (booking.equipmentId !== equipmentId || booking.date !== date) return false;
    return doIntervalsOverlap(startHour, endHour, booking.startHour, booking.endHour);
  });
}

export function generateCandidateSlots(
  requestedEquipmentId: string,
  preferredDate: string,
  durationHours: number,
  allEquipment: Equipment[],
  allBookings: Booking[],
  dayHorizon = 3,
): CandidateSlot[] {
  const target = allEquipment.find((eq) => eq.id === requestedEquipmentId);
  if (!target) return [];

  const duration = Math.max(1, Math.min(4, Math.round(durationHours)));
  const targetCaps = new Set(target.capabilities.map((cap) => cap.toLowerCase()));

  const eligibleEquipment = allEquipment.filter((eq) => {
    if (eq.status === 'maintenance') return false;
    if (eq.id === target.id) return true;
    const sharesCapability = eq.capabilities.some((cap) => targetCaps.has(cap.toLowerCase()));
    return sharesCapability || eq.category === target.category;
  });

  const candidates: CandidateSlot[] = [];
  for (let dayOffset = 0; dayOffset < dayHorizon; dayOffset += 1) {
    const candidateDate = addDaysToIsoDate(preferredDate, dayOffset);
    for (const eq of eligibleEquipment) {
      for (let start = eq.openHour; start + duration <= eq.closeHour; start += 1) {
        const end = start + duration;
        const conflicts = findConflictingBookings(eq.id, candidateDate, start, end, allBookings);
        if (conflicts.length === 0) {
          candidates.push({
            equipmentId: eq.id,
            equipmentName: eq.name,
            department: eq.department,
            labLocation: eq.labLocation,
            date: candidateDate,
            startHour: start,
            endHour: end,
            isSameEquipment: eq.id === target.id,
            requiresFacultyApproval: eq.requiresFacultyApproval,
          });
        }
      }
    }
  }

  return candidates;
}

export function findFeasibleAlternativeSlots(
  requestedEquipmentId: string,
  preferredDate: string,
  requestedStartHour: number,
  requestedEndHour: number,
  allEquipment: Equipment[],
  allBookings: Booking[],
  limit = 4,
  dayHorizon = 3,
): CandidateSlot[] {
  if (!isValidIsoDate(preferredDate)) return [];

  const rawDuration = requestedEndHour - requestedStartHour;
  const duration = Number.isFinite(rawDuration)
    ? Math.max(1, Math.min(4, Math.round(rawDuration)))
    : 1;

  const candidates = generateCandidateSlots(
    requestedEquipmentId,
    preferredDate,
    duration,
    allEquipment,
    allBookings,
    dayHorizon,
  );

  const dayIndexByDate = new Map<string, number>();
  for (let offset = 0; offset < dayHorizon; offset += 1) {
    dayIndexByDate.set(addDaysToIsoDate(preferredDate, offset), offset);
  }

  return [...candidates]
    .sort((a, b) => {
      if (a.isSameEquipment !== b.isSameEquipment) {
        return a.isSameEquipment ? -1 : 1;
      }
      const dayA = dayIndexByDate.get(a.date) ?? dayHorizon;
      const dayB = dayIndexByDate.get(b.date) ?? dayHorizon;
      if (dayA !== dayB) {
        return dayA - dayB;
      }
      const distA = Math.abs(a.startHour - requestedStartHour);
      const distB = Math.abs(b.startHour - requestedStartHour);
      if (distA !== distB) {
        return distA - distB;
      }
      if (a.startHour !== b.startHour) {
        return a.startHour - b.startHour;
      }
      return a.equipmentName.localeCompare(b.equipmentName);
    })
    .slice(0, Math.max(0, limit));
}

export interface RawAiSlotProposal {
  equipmentId: string;
  date: string;
  startHour: number;
  endHour: number;
  tradeoffNote?: string;
}

export interface RawAiConflictOutput {
  recommendedSlot: RawAiSlotProposal;
  reason: string;
  deadlineConsideration: string;
  availabilityConsideration: string;
  fairnessConsideration: string;
  alternatives: RawAiSlotProposal[];
}

export interface ValidatedAiResult {
  recommendedSlot: CandidateSlot & { validated: true };
  reason: string;
  deadlineConsideration: string;
  availabilityConsideration: string;
  fairnessConsideration: string;
  alternatives: ValidatedAlternativeSlot[];
}

function matchCandidateSlot(
  proposal: RawAiSlotProposal | undefined,
  candidateSlots: CandidateSlot[],
): CandidateSlot | undefined {
  if (!proposal) return undefined;
  return candidateSlots.find(
    (slot) =>
      slot.equipmentId === proposal.equipmentId &&
      slot.date === proposal.date &&
      slot.startHour === proposal.startHour &&
      slot.endHour === proposal.endHour,
  );
}

/**
 * Deterministic Post-Validation Guardrail:
 * Guarantees no GenAI recommendation can ever propose an occupied slot,
 * out-of-hours window, or equipment under maintenance.
 */
export function validateAiRecommendation(
  aiOutput: RawAiConflictOutput,
  candidateSlots: CandidateSlot[],
): ValidatedAiResult {
  const matchedPrimary = matchCandidateSlot(aiOutput.recommendedSlot, candidateSlots);
  if (!matchedPrimary) {
    throw new Error(
      'AI recommendation failed deterministic scheduling validation: proposed slot is unavailable or outside operating constraints.',
    );
  }

  const seenKeys = new Set<string>([
    `${matchedPrimary.equipmentId}|${matchedPrimary.date}|${matchedPrimary.startHour}|${matchedPrimary.endHour}`,
  ]);

  const validatedAlternatives: ValidatedAlternativeSlot[] = [];
  for (const alt of aiOutput.alternatives ?? []) {
    const matchedAlt = matchCandidateSlot(alt, candidateSlots);
    if (!matchedAlt) continue;
    const key = `${matchedAlt.equipmentId}|${matchedAlt.date}|${matchedAlt.startHour}|${matchedAlt.endHour}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    validatedAlternatives.push({
      equipmentId: matchedAlt.equipmentId,
      equipmentName: matchedAlt.equipmentName,
      department: matchedAlt.department,
      labLocation: matchedAlt.labLocation,
      date: matchedAlt.date,
      startHour: matchedAlt.startHour,
      endHour: matchedAlt.endHour,
      requiresFacultyApproval: matchedAlt.requiresFacultyApproval,
      tradeoffNote:
        alt.tradeoffNote?.trim() ||
        (matchedAlt.isSameEquipment
          ? 'Open slot on requested equipment.'
          : `Compatible hardware in ${matchedAlt.department}.`),
    });
    if (validatedAlternatives.length >= 2) break;
  }

  return {
    recommendedSlot: {
      ...matchedPrimary,
      validated: true,
    },
    reason: aiOutput.reason.trim(),
    deadlineConsideration: aiOutput.deadlineConsideration.trim(),
    availabilityConsideration: aiOutput.availabilityConsideration.trim(),
    fairnessConsideration: aiOutput.fairnessConsideration.trim(),
    alternatives: validatedAlternatives,
  };
}

export interface RawAiAlternativeOutput {
  recommendedAlternativeId?: unknown;
  reason?: unknown;
  fairnessExplanation?: unknown;
  deadlineConsideration?: unknown;
  availabilityConsideration?: unknown;
  confidence?: unknown;
  backupAlternativeIds?: unknown;
}

export function buildDeterministicAlternatives(
  requestedEquipmentId: string,
  preferredDate: string,
  requestedStartHour: number,
  requestedEndHour: number,
  allEquipment: Equipment[],
  allBookings: Booking[],
  requiredCapabilities: string[] = [],
  limit = 10,
  dayHorizon = 3,
): ConflictAlternativeSlot[] {
  const candidates = findFeasibleAlternativeSlots(
    requestedEquipmentId,
    preferredDate,
    requestedStartHour,
    requestedEndHour,
    allEquipment,
    allBookings,
    Math.max(limit * 2, 16),
    dayHorizon,
  );

  const equipmentById = new Map(allEquipment.map((e) => [e.id, e]));
  const normalizedReqCaps = requiredCapabilities.map((c) => c.trim().toLowerCase()).filter(Boolean);

  const verified = candidates.filter((slot) => {
    const eq = equipmentById.get(slot.equipmentId);
    if (!eq || eq.status === 'maintenance') return false;
    if (!isValidIsoDate(slot.date)) return false;
    if (!validateTimeSlot(slot.startHour, slot.endHour, eq).valid) return false;
    return findConflictingBookings(eq.id, slot.date, slot.startHour, slot.endHour, allBookings).length === 0;
  });

  if (normalizedReqCaps.length > 0) {
    verified.sort((a, b) => {
      if (a.isSameEquipment !== b.isSameEquipment) return a.isSameEquipment ? -1 : 1;
      const eqA = equipmentById.get(a.equipmentId);
      const eqB = equipmentById.get(b.equipmentId);
      const matchesA = (eqA?.capabilities ?? []).filter((cap) =>
        normalizedReqCaps.some((rc) => cap.toLowerCase().includes(rc) || rc.includes(cap.toLowerCase())),
      ).length;
      const matchesB = (eqB?.capabilities ?? []).filter((cap) =>
        normalizedReqCaps.some((rc) => cap.toLowerCase().includes(rc) || rc.includes(cap.toLowerCase())),
      ).length;
      if (matchesA !== matchesB) return matchesB - matchesA;
      return 0;
    });
  }

  return verified.slice(0, limit).map((slot, index) => ({
    ...slot,
    alternativeId: `alternative-${index + 1}`,
    tradeoffNote: slot.isSameEquipment
      ? slot.date === preferredDate
        ? 'Same hardware, shifted time window on requested date.'
        : `Same hardware, nearest open slot on ${slot.date}.`
      : `Cross-department compatible hardware in ${slot.department}.`,
  }));
}

const UNSAFE_AI_OUTPUT_PATTERN =
  /<(?:script|iframe|svg|img|object|embed)\b|javascript:|on(?:error|load|click)\s*=|AIza[A-Za-z0-9_-]{8,}|GEMINI_API_KEY|process\.env/i;

function sanitizeAiTextField(value: unknown, fieldName: string, maxLength = 500): string {
  if (typeof value !== 'string') {
    throw new Error(`AI output field "${fieldName}" must be a string.`);
  }
  if (UNSAFE_AI_OUTPUT_PATTERN.test(value)) {
    throw new Error(`AI output field "${fieldName}" failed safety validation.`);
  }
  const clean = value
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/[<>]/g, '')
    .trim();
  if (!clean) {
    throw new Error(`AI output field "${fieldName}" cannot be empty.`);
  }
  return clean.slice(0, maxLength);
}

/**
 * Stage 6 Deterministic AI Guardrail:
 * Validates JSON structure, ensures recommendedAlternativeId exists in server-generated alternatives,
 * and re-verifies against authoritative equipment & booking state so AI can never bypass hard constraints.
 */
export function validateAiAlternativeSelection(
  rawOutput: unknown,
  serverAlternatives: ConflictAlternativeSlot[],
  allEquipment: Equipment[],
  allBookings: Booking[],
): ConflictAiRecommendation {
  if (!rawOutput || typeof rawOutput !== 'object' || Array.isArray(rawOutput)) {
    throw new Error('AI output must be a structured JSON object.');
  }

  const parsed = rawOutput as RawAiAlternativeOutput;
  if (typeof parsed.recommendedAlternativeId !== 'string' || !parsed.recommendedAlternativeId.trim()) {
    throw new Error('AI output missing valid recommendedAlternativeId.');
  }
  const recommendedId = parsed.recommendedAlternativeId.trim();
  const matchedAlternative = serverAlternatives.find((alt) => alt.alternativeId === recommendedId);
  if (!matchedAlternative) {
    throw new Error(
      `AI recommended unknown or unverified alternativeId "${recommendedId}".`,
    );
  }

  // Re-verify hard constraints directly against authoritative server state
  const equipment = allEquipment.find((eq) => eq.id === matchedAlternative.equipmentId);
  if (!equipment || equipment.status === 'maintenance') {
    throw new Error('Recommended equipment is no longer operational.');
  }
  if (!isValidIsoDate(matchedAlternative.date)) {
    throw new Error('Recommended date is invalid.');
  }
  const slotCheck = validateTimeSlot(matchedAlternative.startHour, matchedAlternative.endHour, equipment);
  if (!slotCheck.valid) {
    throw new Error(slotCheck.reason ?? 'Recommended slot violates operating hours or duration rules.');
  }
  const liveConflicts = findConflictingBookings(
    equipment.id,
    matchedAlternative.date,
    matchedAlternative.startHour,
    matchedAlternative.endHour,
    allBookings,
  );
  if (liveConflicts.length > 0) {
    throw new Error('Recommended alternative conflicts with an active booking.');
  }

  const reason = sanitizeAiTextField(parsed.reason, 'reason', 500);
  const fairnessExplanation = sanitizeAiTextField(
    parsed.fairnessExplanation,
    'fairnessExplanation',
    500,
  );
  const deadlineConsideration =
    typeof parsed.deadlineConsideration === 'string' && parsed.deadlineConsideration.trim()
      ? sanitizeAiTextField(parsed.deadlineConsideration, 'deadlineConsideration', 350)
      : 'Selected window aligns with project submission timeline.';
  const availabilityConsideration =
    typeof parsed.availabilityConsideration === 'string' && parsed.availabilityConsideration.trim()
      ? sanitizeAiTextField(parsed.availabilityConsideration, 'availabilityConsideration', 350)
      : `${matchedAlternative.equipmentName} is verified open at ${String(matchedAlternative.startHour).padStart(2, '0')}:00–${String(matchedAlternative.endHour).padStart(2, '0')}:00.`;

  if (
    typeof parsed.confidence !== 'number' ||
    !Number.isFinite(parsed.confidence) ||
    parsed.confidence < 0 ||
    parsed.confidence > 1
  ) {
    throw new Error('AI confidence score must be a finite number between 0 and 1.');
  }
  const confidence = Math.round(parsed.confidence * 100) / 100;

  const backupAlternatives: ValidatedAlternativeSlot[] = [];
  const seenIds = new Set<string>([matchedAlternative.alternativeId]);
  if (Array.isArray(parsed.backupAlternativeIds)) {
    for (const rawBackupId of parsed.backupAlternativeIds) {
      if (typeof rawBackupId !== 'string') continue;
      const cleanBackupId = rawBackupId.trim();
      if (!cleanBackupId || seenIds.has(cleanBackupId)) continue;
      const matchedBackup = serverAlternatives.find((alt) => alt.alternativeId === cleanBackupId);
      if (!matchedBackup) continue;
      const backupEq = allEquipment.find((eq) => eq.id === matchedBackup.equipmentId);
      if (!backupEq || backupEq.status === 'maintenance') continue;
      if (
        findConflictingBookings(
          backupEq.id,
          matchedBackup.date,
          matchedBackup.startHour,
          matchedBackup.endHour,
          allBookings,
        ).length > 0
      ) {
        continue;
      }
      seenIds.add(cleanBackupId);
      backupAlternatives.push({
        alternativeId: matchedBackup.alternativeId,
        equipmentId: matchedBackup.equipmentId,
        equipmentName: matchedBackup.equipmentName,
        department: matchedBackup.department,
        labLocation: matchedBackup.labLocation,
        date: matchedBackup.date,
        startHour: matchedBackup.startHour,
        endHour: matchedBackup.endHour,
        requiresFacultyApproval: matchedBackup.requiresFacultyApproval,
        tradeoffNote:
          matchedBackup.tradeoffNote ??
          (matchedBackup.isSameEquipment
            ? 'Verified open window on same hardware.'
            : `Verified compatible resource in ${matchedBackup.department}.`),
      });
      if (backupAlternatives.length >= 2) break;
    }
  }

  return {
    alternativeId: matchedAlternative.alternativeId,
    recommendedAlternativeId: matchedAlternative.alternativeId,
    slot: matchedAlternative,
    reason,
    fairnessExplanation,
    deadlineConsideration,
    availabilityConsideration,
    confidence,
    validated: true,
    backupAlternatives,
  };
}

export function calculateEquipmentUtilization(
  equipmentList: Equipment[],
  bookings: Booking[],
  projectRequests: ProjectAccessRequest[],
  referenceDates: string[],
): EquipmentUtilization[] {
  const dateSet = new Set(referenceDates);

  return equipmentList.map((eq) => {
    const dailyCapacity = Math.max(1, eq.closeHour - eq.openHour);
    const totalCapacityHours = dailyCapacity * Math.max(1, referenceDates.length);

    const activeBookings = bookings.filter(
      (b) => b.equipmentId === eq.id && b.status !== 'cancelled' && dateSet.has(b.date),
    );
    const bookedHours = activeBookings.reduce((sum, b) => sum + Math.max(0, b.endHour - b.startHour), 0);
    const pendingRequestsCount = projectRequests.filter(
      (req) => req.equipmentId === eq.id && req.status === 'pending',
    ).length;

    const utilizationPercent = Math.min(
      100,
      Math.round((bookedHours / totalCapacityHours) * 100),
    );

    return {
      equipmentId: eq.id,
      equipmentName: eq.name,
      department: eq.department,
      status: eq.status,
      bookedHours,
      totalCapacityHours,
      utilizationPercent,
      activeBookingsCount: activeBookings.length,
      pendingRequestsCount,
    };
  });
}
