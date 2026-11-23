import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { formatIsoDateOffset } from '../data/seedData.js';
import { resetDemoStore } from '../data/store.js';
import { getBookings } from '../repositories/bookingRepository.js';
import { getEquipment } from '../repositories/equipmentRepository.js';
import { getProjectRequests } from '../repositories/projectRequestRepository.js';
import {
  AppServiceError,
  createStudentBooking,
  reviewProjectRequest,
  updateAdminEquipment,
} from '../services/bookingWorkflowService.js';
import {
  calculateEquipmentUtilization,
  doIntervalsOverlap,
  findConflictingBookings,
  generateCandidateSlots,
  validateAiRecommendation,
  validateTimeSlot,
} from '../services/schedulingService.js';

describe('LabLink Deterministic Scheduling & Workflow', () => {
  beforeEach(() => {
    resetDemoStore();
  });

  it('detects interval overlaps accurately without false positives on adjacent slots', () => {
    assert.equal(doIntervalsOverlap(14, 16, 15, 17), true);
    assert.equal(doIntervalsOverlap(14, 16, 14, 16), true);
    assert.equal(doIntervalsOverlap(10, 12, 12, 14), false);
    assert.equal(doIntervalsOverlap(16, 18, 14, 16), false);
  });

  it('rejects out-of-hours and oversized booking slots', () => {
    const ur5e = getEquipment().find((e) => e.id === 'eq-ur5e-arm')!;
    assert.equal(validateTimeSlot(7, 9, ur5e).valid, false);
    assert.equal(validateTimeSlot(18, 21, ur5e).valid, false);
    assert.equal(validateTimeSlot(9, 15, ur5e).valid, false);
    assert.equal(validateTimeSlot(16, 18, ur5e).valid, true);
  });

  it('detects seeded overlap conflict on UR5e 14:00-16:00 today and blocks double booking', () => {
    const today = formatIsoDateOffset(0);
    const tomorrow = formatIsoDateOffset(1);
    const bookings = getBookings({ equipmentId: 'eq-ur5e-arm', date: today });
    const conflicts = findConflictingBookings('eq-ur5e-arm', today, 14, 16, bookings);
    assert.equal(conflicts.length, 1);

    assert.throws(
      () =>
        createStudentBooking({
          equipmentId: 'eq-ur5e-arm',
          studentName: 'Alex Mercer',
          studentEmail: 'amercer@campus.edu',
          projectTitle: 'Autonomous Manipulation Capstone',
          projectDeadline: tomorrow,
          requirementsSummary: 'ROS2 Control',
          date: today,
          startHour: 14,
          endHour: 16,
        }),
      (err: unknown) => err instanceof AppServiceError && err.code === 'BOOKING_CONFLICT',
    );
  });

  it('validates AI recommendations deterministically and rejects hallucinated/occupied slots', () => {
    const today = formatIsoDateOffset(0);
    const candidates = generateCandidateSlots(
      'eq-ur5e-arm',
      today,
      2,
      getEquipment(),
      getBookings(),
    );
    assert.ok(candidates.length > 0);

    // Hallucinated occupied slot (today 14-16 on eq-ur5e-arm is already booked) must fail validation
    assert.throws(() =>
      validateAiRecommendation(
        {
          recommendedSlot: {
            equipmentId: 'eq-ur5e-arm',
            date: today,
            startHour: 14,
            endHour: 16,
          },
          reason: 'Invalid occupied slot',
          deadlineConsideration: 'Urgent',
          availabilityConsideration: 'None',
          fairnessConsideration: 'None',
          alternatives: [],
        },
        candidates,
      ),
    );

    const firstValid = candidates[0];
    const secondValid = candidates[1];
    const validated = validateAiRecommendation(
      {
        recommendedSlot: {
          equipmentId: firstValid.equipmentId,
          date: firstValid.date,
          startHour: firstValid.startHour,
          endHour: firstValid.endHour,
        },
        reason: 'Open slot avoids colliding with existing kinematics practice.',
        deadlineConsideration: 'Meets upcoming capstone deadline.',
        availabilityConsideration: 'Window is unbooked and operational.',
        fairnessConsideration: 'Preserves earlier confirmed reservation.',
        alternatives: [
          {
            equipmentId: secondValid.equipmentId,
            date: secondValid.date,
            startHour: secondValid.startHour,
            endHour: secondValid.endHour,
            tradeoffNote: 'Slightly later window.',
          },
          {
            // Invalid alternative should be stripped deterministically without crashing
            equipmentId: 'eq-ur5e-arm',
            date: today,
            startHour: 14,
            endHour: 16,
            tradeoffNote: 'Should be filtered out',
          },
        ],
      },
      candidates,
    );

    assert.equal(validated.recommendedSlot.validated, true);
    assert.equal(validated.alternatives.length, 1);
  });

  it('blocks bookings when lab admin places equipment in maintenance', () => {
    const today = formatIsoDateOffset(0);
    const tomorrow = formatIsoDateOffset(1);
    updateAdminEquipment('eq-keysight-mso', { status: 'maintenance' });

    assert.throws(
      () =>
        createStudentBooking({
          equipmentId: 'eq-keysight-mso',
          studentName: 'Samira Lee',
          studentEmail: 'slee@campus.edu',
          projectTitle: 'Motor PWM Check',
          projectDeadline: tomorrow,
          requirementsSummary: 'PWM Debugging',
          date: today,
          startHour: 16,
          endHour: 18,
        }),
      (err: unknown) => err instanceof AppServiceError && err.code === 'EQUIPMENT_MAINTENANCE',
    );
  });

  it('transitions faculty approval and updates linked booking status cleanly', () => {
    const pendingReq = getProjectRequests({ status: 'pending' }).find(
      (r) => r.linkedBookingId !== undefined,
    )!;
    assert.ok(pendingReq);

    const result = reviewProjectRequest(
      pendingReq.id,
      'approved',
      'Dr. Aris Thorne',
      'Cleared for capstone demo.',
    );
    assert.equal(result.request.status, 'approved');
    assert.equal(result.updatedBooking?.status, 'confirmed');
  });

  it('computes equipment utilization accurately and resets store cleanly', () => {
    const today = formatIsoDateOffset(0);
    const tomorrow = formatIsoDateOffset(1);
    const util = calculateEquipmentUtilization(
      getEquipment(),
      getBookings(),
      getProjectRequests(),
      [today, tomorrow],
    );
    const ur5eUtil = util.find((u) => u.equipmentId === 'eq-ur5e-arm')!;
    // 2h (10-12) + 2h (14-16) + 2h tomorrow (11-13) = 6h out of 24h (12h/day * 2 days) = 25%
    assert.equal(ur5eUtil.bookedHours, 6);
    assert.equal(ur5eUtil.utilizationPercent, 25);

    updateAdminEquipment('eq-keysight-mso', { status: 'maintenance' });
    resetDemoStore();
    const afterReset = getEquipment().find((e) => e.id === 'eq-keysight-mso')!;
    assert.equal(afterReset.status, 'available');
  });

  it('includes Chemistry department equipment and allows open slot booking', () => {
    const today = formatIsoDateOffset(0);
    const tomorrow = formatIsoDateOffset(1);
    const chemEq = getEquipment().find((e) => e.department === 'Chemistry');
    assert.ok(chemEq, 'Chemistry equipment should be present in seeded catalog');

    const created = createStudentBooking({
      equipmentId: chemEq.id,
      studentName: 'Elena Vance',
      studentEmail: 'evance@campus.edu',
      projectTitle: 'Organic Polymer Purity Assay',
      projectDeadline: tomorrow,
      requirementsSummary: 'Chromatography and UV-Vis Detection',
      date: today,
      startHour: 14,
      endHour: 16,
    });
    assert.equal(created.booking.status, 'confirmed');
  });
});
