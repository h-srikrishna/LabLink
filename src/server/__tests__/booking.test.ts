import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import type { BookingConflictDetails } from '../../shared/types.js';
import { formatIsoDateOffset } from '../data/seedData.js';
import { resetDemoStore } from '../data/store.js';
import { getBookings } from '../repositories/bookingRepository.js';
import { getEquipment } from '../repositories/equipmentRepository.js';
import {
  AppServiceError,
  checkSlotAvailability,
  createStudentBooking,
  updateAdminEquipment,
} from '../services/bookingWorkflowService.js';
import {
  findConflictingBookings,
  findFeasibleAlternativeSlots,
} from '../services/schedulingService.js';

describe('LabLink Intelligent Slot Booking & Conflict Resolution', () => {
  beforeEach(() => {
    resetDemoStore();
  });

  it('creates a valid booking for open and faculty-restricted equipment without requiring unnecessary email PII', () => {
    const today = formatIsoDateOffset(0);
    const tomorrow = formatIsoDateOffset(1);

    const openBooking = createStudentBooking({
      equipmentId: 'eq-hplc-system',
      studentName: 'Chem Team B',
      projectTitle: 'Solvent Gradient Calibration',
      projectDeadline: tomorrow,
      requirementsSummary: 'UV-Vis Detection run',
      date: today,
      startHour: 13,
      endHour: 15,
    });

    assert.equal(openBooking.booking.status, 'confirmed');
    assert.ok(openBooking.booking.id.startsWith('bk-'));
    assert.equal(openBooking.booking.startHour, 13);
    assert.equal(openBooking.booking.endHour, 15);
    assert.equal(openBooking.createdProjectRequest, undefined);

    const restrictedBooking = createStudentBooking({
      equipmentId: 'eq-ur5e-arm',
      studentName: 'Robotics Capstone Alpha',
      projectTitle: 'Gripper Compliance Verification',
      projectDeadline: tomorrow,
      requirementsSummary: '6-DOF Manipulation',
      date: today,
      startHour: 16,
      endHour: 18,
    });

    assert.equal(restrictedBooking.booking.status, 'pending_faculty');
    assert.ok(restrictedBooking.createdProjectRequest);
    assert.equal(restrictedBooking.createdProjectRequest?.status, 'pending');
  });

  it('rejects missing or unknown equipment resource with 404 NOT_FOUND and empty resource id with 400', () => {
    const today = formatIsoDateOffset(0);
    const tomorrow = formatIsoDateOffset(1);

    assert.throws(
      () =>
        createStudentBooking({
          equipmentId: 'eq-does-not-exist',
          studentName: 'Jordan Rivera',
          projectTitle: 'Sensor Calibration',
          projectDeadline: tomorrow,
          requirementsSummary: 'Testing',
          date: today,
          startHour: 12,
          endHour: 14,
        }),
      (err: unknown) => err instanceof AppServiceError && err.statusCode === 404 && err.code === 'NOT_FOUND',
    );

    assert.throws(
      () =>
        createStudentBooking({
          equipmentId: '   ',
          studentName: 'Jordan Rivera',
          projectTitle: 'Sensor Calibration',
          projectDeadline: tomorrow,
          requirementsSummary: 'Testing',
          date: today,
          startHour: 12,
          endHour: 14,
        }),
      (err: unknown) => err instanceof AppServiceError && err.statusCode === 400 && err.code === 'VALIDATION_ERROR',
    );
  });

  it('rejects malformed dates and impossible calendar dates such as 2026-02-31', () => {
    const today = formatIsoDateOffset(0);
    const tomorrow = formatIsoDateOffset(1);

    for (const badDate of ['2026/05/01', '2026-02-31', '2026-13-01', 'not-a-date']) {
      assert.throws(
        () =>
          createStudentBooking({
            equipmentId: 'eq-hplc-system',
            studentName: 'Jordan Rivera',
            projectTitle: 'Chromatography Check',
            projectDeadline: tomorrow,
            requirementsSummary: 'UV-Vis',
            date: badDate,
            startHour: 13,
            endHour: 15,
          }),
        (err: unknown) => err instanceof AppServiceError && err.statusCode === 400 && err.code === 'VALIDATION_ERROR',
      );
    }

    assert.throws(
      () =>
        createStudentBooking({
          equipmentId: 'eq-hplc-system',
          studentName: 'Jordan Rivera',
          projectTitle: 'Chromatography Check',
          projectDeadline: '2026-04-31',
          requirementsSummary: 'UV-Vis',
          date: today,
          startHour: 13,
          endHour: 15,
        }),
      (err: unknown) => err instanceof AppServiceError && err.statusCode === 400 && err.code === 'VALIDATION_ERROR',
    );
  });

  it('rejects invalid times, end before start, equal start/end, and missing project purpose fields cleanly', () => {
    const today = formatIsoDateOffset(0);
    const tomorrow = formatIsoDateOffset(1);

    // End before start & end equal to start
    for (const [startHour, endHour] of [
      [15, 13],
      [14, 14],
      [7, 9], // before 08:00 openHour
      [19, 21], // after 20:00 closeHour
      [12, 18], // > 4h cap
      [13.5, 15], // non-integer
      [Number.NaN, 15],
    ]) {
      assert.throws(
        () =>
          createStudentBooking({
            equipmentId: 'eq-hplc-system',
            studentName: 'Jordan Rivera',
            projectTitle: 'Chromatography Check',
            projectDeadline: tomorrow,
            requirementsSummary: 'UV-Vis',
            date: today,
            startHour,
            endHour,
          }),
        (err: unknown) => err instanceof AppServiceError && err.statusCode === 400 && err.code === 'INVALID_SLOT',
      );
    }

    // Missing project/purpose fields (must return 400 VALIDATION_ERROR, never 500)
    assert.throws(
      () =>
        createStudentBooking({
          equipmentId: 'eq-hplc-system',
          studentName: 'Jordan Rivera',
          projectTitle: '   ',
          projectDeadline: tomorrow,
          requirementsSummary: 'UV-Vis',
          date: today,
          startHour: 13,
          endHour: 15,
        }),
      (err: unknown) => err instanceof AppServiceError && err.statusCode === 400 && err.code === 'VALIDATION_ERROR',
    );

    assert.throws(
      () =>
        createStudentBooking({
          equipmentId: 'eq-hplc-system',
          studentName: 'Jordan Rivera',
          projectTitle: 'Valid Title',
          projectDeadline: tomorrow,
          requirementsSummary: undefined as unknown as string,
          date: today,
          startHour: 13,
          endHour: 15,
        }),
      (err: unknown) => err instanceof AppServiceError && err.statusCode === 400 && err.code === 'VALIDATION_ERROR',
    );
  });

  it('allows exact boundary bookings (08:00-10:00 and 12:00-13:00) around existing 10:00-12:00 booking', () => {
    const today = formatIsoDateOffset(0);
    const tomorrow = formatIsoDateOffset(1);

    // Seeded eq-hplc-system has bk-108 at 10:00-12:00 today
    const before = createStudentBooking({
      equipmentId: 'eq-hplc-system',
      studentName: 'Student Before',
      projectTitle: 'Early Assay',
      projectDeadline: tomorrow,
      requirementsSummary: 'Chromatography',
      date: today,
      startHour: 8,
      endHour: 10,
    });
    assert.equal(before.booking.status, 'confirmed');

    const after = createStudentBooking({
      equipmentId: 'eq-hplc-system',
      studentName: 'Student After',
      projectTitle: 'Noon Assay',
      projectDeadline: tomorrow,
      requirementsSummary: 'Chromatography',
      date: today,
      startHour: 12,
      endHour: 13,
    });
    assert.equal(after.booking.status, 'confirmed');
  });

  it('rejects overlapping intervals (09:00-10:30, 11:00-13:00, 10:30-12:30 -> floored/whole hours 09-11, 11-13, 10-12) against 10:00-12:00 booking', () => {
    const today = formatIsoDateOffset(0);
    const tomorrow = formatIsoDateOffset(1);
    const hplcBookings = getBookings({ equipmentId: 'eq-hplc-system', date: today });

    // Raw deterministic interval overlap checks including half-hour inputs
    assert.equal(findConflictingBookings('eq-hplc-system', today, 9, 10.5, hplcBookings).length, 1);
    assert.equal(findConflictingBookings('eq-hplc-system', today, 11, 13, hplcBookings).length, 1);
    assert.equal(findConflictingBookings('eq-hplc-system', today, 10.5, 12.5, hplcBookings).length, 1);
    assert.equal(findConflictingBookings('eq-hplc-system', today, 8, 10, hplcBookings).length, 0);
    assert.equal(findConflictingBookings('eq-hplc-system', today, 12, 13, hplcBookings).length, 0);

    // Server booking rejection for whole-hour overlaps (09-11, 11-13, 10-12)
    for (const [startHour, endHour] of [
      [9, 11],
      [11, 13],
      [10, 12],
    ]) {
      assert.throws(
        () =>
          createStudentBooking({
            equipmentId: 'eq-hplc-system',
            studentName: 'Overlap Tester',
            projectTitle: 'Overlap Check',
            projectDeadline: tomorrow,
            requirementsSummary: 'UV-Vis',
            date: today,
            startHour,
            endHour,
          }),
        (err: unknown) => err instanceof AppServiceError && err.statusCode === 409 && err.code === 'BOOKING_CONFLICT',
      );
    }
  });

  it('detects and reports multiple overlapping bookings in 409 conflict details', () => {
    const today = formatIsoDateOffset(0);
    const tomorrow = formatIsoDateOffset(1);

    // Seeded eq-ur5e-arm today has 10:00-12:00 (bk-102) and 14:00-16:00 (bk-101)
    // Requesting 11:00-15:00 overlaps BOTH bookings
    let caught: AppServiceError | undefined;
    try {
      createStudentBooking({
        equipmentId: 'eq-ur5e-arm',
        studentName: 'Multi Conflict Tester',
        projectTitle: 'Extended Manipulation Run',
        projectDeadline: tomorrow,
        requirementsSummary: '6-DOF Manipulation',
        date: today,
        startHour: 11,
        endHour: 15,
      });
    } catch (err) {
      if (err instanceof AppServiceError) caught = err;
    }

    assert.ok(caught);
    assert.equal(caught.statusCode, 409);
    assert.equal(caught.code, 'BOOKING_CONFLICT');
    const details = caught.details as BookingConflictDetails;
    assert.equal(details.conflicts.length, 2);
    assert.deepEqual(
      details.conflicts.map((c) => c.id).sort(),
      ['bk-101', 'bk-102'],
    );
    // 4h alternative on today eq-ur5e-arm: only 16:00-20:00 fits without colliding with 10-12 or 14-16
    assert.ok(details.alternatives.length > 0);
    assert.equal(details.alternatives[0].equipmentId, 'eq-ur5e-arm');
    assert.equal(details.alternatives[0].date, today);
    assert.equal(details.alternatives[0].startHour, 16);
    assert.equal(details.alternatives[0].endHour, 20);
  });

  it('prioritizes feasible alternative slots by same resource, date, and proximity to requested start time', () => {
    const today = formatIsoDateOffset(0);
    const availability = checkSlotAvailability({
      equipmentId: 'eq-ur5e-arm',
      date: today,
      startHour: 14,
      endHour: 16,
    });

    assert.equal(availability.available, false);
    assert.equal(availability.conflicts.length, 1);
    assert.ok(availability.alternatives.length >= 2);

    // Closest 2h slots on eq-ur5e-arm today around 14:00 (booked 10-12 & 14-16) are 12:00-14:00 and 16:00-18:00 (distance 2h)
    const first = availability.alternatives[0];
    const second = availability.alternatives[1];
    assert.equal(first.equipmentId, 'eq-ur5e-arm');
    assert.equal(first.date, today);
    assert.equal(first.startHour, 12);
    assert.equal(first.endHour, 14);
    assert.equal(second.startHour, 16);
    assert.equal(second.endHour, 18);
  });

  it('never suggests impossible alternative slots (booked windows, out-of-hours, or maintenance resources)', () => {
    const today = formatIsoDateOffset(0);

    // Put a compatible resource (eq-a100-node shares ROS2 Control with eq-ur5e-arm) in maintenance
    updateAdminEquipment('eq-a100-node', { status: 'maintenance' });

    const allEquipment = getEquipment();
    const allBookings = getBookings();
    const alternatives = findFeasibleAlternativeSlots(
      'eq-ur5e-arm',
      today,
      14,
      16,
      allEquipment,
      allBookings,
      20,
      3,
    );

    assert.ok(alternatives.length > 0);
    for (const alt of alternatives) {
      const eq = allEquipment.find((e) => e.id === alt.equipmentId)!;
      assert.notEqual(eq.status, 'maintenance', 'Maintenance equipment must never be suggested');
      assert.ok(alt.startHour >= eq.openHour && alt.endHour <= eq.closeHour, 'Slot must be within operating hours');
      assert.equal(alt.endHour - alt.startHour, 2, 'Alternative slot must match requested duration');
      const overlaps = findConflictingBookings(alt.equipmentId, alt.date, alt.startHour, alt.endHour, allBookings);
      assert.equal(overlaps.length, 0, 'Alternative slot must have zero overlapping active bookings');
    }
  });
});
