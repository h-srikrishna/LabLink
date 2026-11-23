import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import type { CreateProjectRequestInput } from '../../shared/types.js';
import { formatIsoDateOffset } from '../data/seedData.js';
import { resetDemoStore } from '../data/store.js';
import {
  AppServiceError,
  getProjectRequestDetails,
  listProjectRequests,
  submitProjectRequest,
} from '../services/bookingWorkflowService.js';

describe('LabLink Project-Based Access Requests', () => {
  beforeEach(() => {
    resetDemoStore();
  });

  function buildValidPayload(overrides: Partial<CreateProjectRequestInput> = {}): CreateProjectRequestInput {
    const today = formatIsoDateOffset(0);
    const tomorrow = formatIsoDateOffset(1);
    return {
      equipmentId: 'eq-ur5e-arm',
      studentName: 'Jordan Rivera',
      department: 'Robotics & Mechatronics',
      projectTitle: 'Force-Controlled Micro-Assembly Study',
      projectDescription:
        'Closed-loop compliant trajectory testing with wrist force-torque feedback for capstone evaluation.',
      projectDeadline: tomorrow,
      equipmentRequirements: '6-DOF Manipulation, Force-Torque Sensing',
      justification: 'Requires high-precision impedance control unavailable on simulation benches.',
      preferredDate: today,
      preferredStartHour: 16,
      preferredEndHour: 19,
      ...overrides,
    };
  }

  it('creates a valid project access request with complete metadata and safe provisional hold when slot is free', () => {
    const result = submitProjectRequest(buildValidPayload());
    assert.ok(result.request.id.startsWith('req-'));
    assert.equal(result.request.status, 'pending');
    assert.equal(result.request.equipmentId, 'eq-ur5e-arm');
    assert.equal(result.request.equipmentName, 'UR5e 6-DOF Robotic Arm');
    assert.equal(result.request.preferredStartHour, 16);
    assert.equal(result.request.preferredEndHour, 19);
    assert.equal(result.request.requestedHours, 3);
    assert.ok(result.request.projectDescription.includes('wrist force-torque'));
    assert.ok(result.request.createdAt);
    assert.ok(result.linkedBooking);
    assert.equal(result.linkedBooking?.status, 'pending_faculty');
  });

  it('initializes status strictly to pending on creation and ignores client-supplied status tampering', () => {
    const tampered = {
      ...buildValidPayload(),
      status: 'approved',
      facultyReviewer: 'Spoofed Reviewer',
    } as CreateProjectRequestInput;

    const result = submitProjectRequest(tampered);
    assert.equal(result.request.status, 'pending');
    assert.equal(result.request.facultyReviewer, undefined);
  });

  it('creates a pending project request without creating a conflicting booking when preferred slot overlaps', () => {
    // eq-ur5e-arm already has bk-101 at 14:00-16:00 today
    const result = submitProjectRequest(
      buildValidPayload({
        preferredStartHour: 14,
        preferredEndHour: 16,
      }),
    );
    assert.equal(result.request.status, 'pending');
    assert.equal(result.request.linkedBookingId, undefined);
    assert.equal(result.linkedBooking, undefined);
  });

  it('rejects missing project title, missing project description, and missing purpose/justification', () => {
    assert.throws(
      () => submitProjectRequest(buildValidPayload({ projectTitle: '   ' })),
      (err: unknown) => err instanceof AppServiceError && err.statusCode === 400 && err.code === 'VALIDATION_ERROR',
    );

    assert.throws(
      () => submitProjectRequest(buildValidPayload({ projectDescription: '' })),
      (err: unknown) => err instanceof AppServiceError && err.statusCode === 400 && err.code === 'VALIDATION_ERROR',
    );

    assert.throws(
      () =>
        submitProjectRequest(
          buildValidPayload({ projectDescription: undefined as unknown as string }),
        ),
      (err: unknown) => err instanceof AppServiceError && err.statusCode === 400 && err.code === 'VALIDATION_ERROR',
    );

    assert.throws(
      () => submitProjectRequest(buildValidPayload({ justification: '   ' })),
      (err: unknown) => err instanceof AppServiceError && err.statusCode === 400 && err.code === 'VALIDATION_ERROR',
    );

    assert.throws(
      () =>
        submitProjectRequest(
          buildValidPayload({ justification: undefined as unknown as string }),
        ),
      (err: unknown) => err instanceof AppServiceError && err.statusCode === 400 && err.code === 'VALIDATION_ERROR',
    );
  });

  it('rejects nonexistent and malformed equipment IDs cleanly', () => {
    assert.throws(
      () => submitProjectRequest(buildValidPayload({ equipmentId: 'eq-nonexistent-999' })),
      (err: unknown) => err instanceof AppServiceError && err.statusCode === 404 && err.code === 'NOT_FOUND',
    );

    for (const badId of ['', '   ', '../etc/passwd', 'eq with spaces', '<script>alert(1)</script>']) {
      assert.throws(
        () => submitProjectRequest(buildValidPayload({ equipmentId: badId })),
        (err: unknown) => err instanceof AppServiceError && err.statusCode === 400 && err.code === 'VALIDATION_ERROR',
      );
    }
  });

  it('rejects invalid preferred dates and invalid or missing project deadlines', () => {
    for (const badDate of ['2026/11/24', '2026-02-31', '2026-13-01', 'invalid', '']) {
      assert.throws(
        () => submitProjectRequest(buildValidPayload({ preferredDate: badDate })),
        (err: unknown) => err instanceof AppServiceError && err.statusCode === 400 && err.code === 'VALIDATION_ERROR',
      );

      assert.throws(
        () => submitProjectRequest(buildValidPayload({ projectDeadline: badDate })),
        (err: unknown) => err instanceof AppServiceError && err.statusCode === 400 && err.code === 'VALIDATION_ERROR',
      );
    }
  });

  it('rejects invalid start/end times and end time before or equal to start time', () => {
    const invalidWindows: Array<[number, number]> = [
      [15, 13], // end before start
      [12, 12], // equal start and end
      [7, 9], // before 08:00 lab openHour
      [19, 21], // after 20:00 lab closeHour
      [9, 19], // 10 hours (> 8h cap)
      [10.5, 12], // fractional hour
      [Number.NaN, 12],
    ];

    for (const [preferredStartHour, preferredEndHour] of invalidWindows) {
      assert.throws(
        () =>
          submitProjectRequest(
            buildValidPayload({ preferredStartHour, preferredEndHour }),
          ),
        (err: unknown) => err instanceof AppServiceError && err.statusCode === 400 && err.code === 'INVALID_SLOT',
      );
    }
  });

  it('rejects excessively long text inputs and control characters across project request fields', () => {
    assert.throws(
      () => submitProjectRequest(buildValidPayload({ projectTitle: 'T'.repeat(121) })),
      (err: unknown) => err instanceof AppServiceError && err.statusCode === 400 && err.code === 'VALIDATION_ERROR',
    );

    assert.throws(
      () => submitProjectRequest(buildValidPayload({ projectDescription: 'D'.repeat(601) })),
      (err: unknown) => err instanceof AppServiceError && err.statusCode === 400 && err.code === 'VALIDATION_ERROR',
    );

    assert.throws(
      () => submitProjectRequest(buildValidPayload({ justification: 'J'.repeat(501) })),
      (err: unknown) => err instanceof AppServiceError && err.statusCode === 400 && err.code === 'VALIDATION_ERROR',
    );

    assert.throws(
      () => submitProjectRequest(buildValidPayload({ equipmentRequirements: 'R'.repeat(301) })),
      (err: unknown) => err instanceof AppServiceError && err.statusCode === 400 && err.code === 'VALIDATION_ERROR',
    );

    assert.throws(
      () => submitProjectRequest(buildValidPayload({ projectTitle: 'Bad\u0000Title' })),
      (err: unknown) => err instanceof AppServiceError && err.statusCode === 400 && err.code === 'VALIDATION_ERROR',
    );
  });

  it('retrieves created project requests by list and by ID while rejecting malformed IDs', () => {
    const created = submitProjectRequest(
      buildValidPayload({
        equipmentId: 'eq-hplc-system',
        department: 'Chemistry',
        projectTitle: 'Polymer Separation Gradient Trial',
      }),
    );

    const allRequests = listProjectRequests();
    const found = allRequests.find((r) => r.id === created.request.id);
    assert.ok(found);
    assert.equal(found.equipmentName, 'Agilent 1260 Infinity II HPLC System');
    assert.equal(found.projectTitle, 'Polymer Separation Gradient Trial');

    const byId = getProjectRequestDetails(created.request.id);
    assert.equal(byId.request.id, created.request.id);
    assert.equal(byId.request.equipmentName, 'Agilent 1260 Infinity II HPLC System');

    const hplcOnly = listProjectRequests({ equipmentId: 'eq-hplc-system', status: 'pending' });
    assert.equal(hplcOnly.length, 1);
    assert.equal(hplcOnly[0].id, created.request.id);

    assert.throws(
      () => getProjectRequestDetails('../invalid'),
      (err: unknown) => err instanceof AppServiceError && err.statusCode === 400 && err.code === 'VALIDATION_ERROR',
    );
    assert.throws(
      () => getProjectRequestDetails('req-does-not-exist'),
      (err: unknown) => err instanceof AppServiceError && err.statusCode === 404 && err.code === 'NOT_FOUND',
    );
    assert.throws(
      () => listProjectRequests({ status: 'bogus_status' }),
      (err: unknown) => err instanceof AppServiceError && err.statusCode === 400,
    );
    assert.throws(
      () => listProjectRequests({ equipmentId: '../bad' }),
      (err: unknown) => err instanceof AppServiceError && err.statusCode === 400,
    );
  });

  it('allows multiple project requests to coexist without corrupting seeded or prior requests', () => {
    const initialCount = listProjectRequests().length;
    const first = submitProjectRequest(
      buildValidPayload({
        equipmentId: 'eq-hplc-system',
        department: 'Chemistry',
        projectTitle: 'Solvent Gradient Experiment A',
        preferredStartHour: 13,
        preferredEndHour: 15,
      }),
    );
    const second = submitProjectRequest(
      buildValidPayload({
        equipmentId: 'eq-a100-node',
        department: 'Computer Science',
        projectTitle: 'Vision Policy Training B',
        preferredStartHour: 8,
        preferredEndHour: 11,
      }),
    );

    const after = listProjectRequests();
    assert.equal(after.length, initialCount + 2);
    assert.notEqual(first.request.id, second.request.id);
    assert.ok(after.some((r) => r.id === 'req-201' && r.projectTitle === 'Autonomous Surgical Suturing Capstone'));
    assert.ok(after.some((r) => r.id === first.request.id && r.projectTitle === 'Solvent Gradient Experiment A'));
    assert.ok(after.some((r) => r.id === second.request.id && r.projectTitle === 'Vision Policy Training B'));
  });

  it('rejects malformed non-object payloads safely', () => {
    for (const badPayload of [null, undefined, [], 'raw-string', 42]) {
      assert.throws(
        () => submitProjectRequest(badPayload as unknown as CreateProjectRequestInput),
        (err: unknown) => err instanceof AppServiceError && err.statusCode === 400 && err.code === 'VALIDATION_ERROR',
      );
    }
  });
});
