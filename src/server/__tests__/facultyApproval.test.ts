import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, beforeEach, describe, it } from 'node:test';
import { createApp } from '../../../server.js';
import type { CreateProjectRequestInput } from '../../shared/types.js';
import { formatIsoDateOffset } from '../data/seedData.js';
import { resetDemoStore } from '../data/store.js';
import { getBookingById, getBookings } from '../repositories/bookingRepository.js';
import {
  AppServiceError,
  approveProjectRequest,
  getProjectRequestDetails,
  listProjectRequests,
  rejectProjectRequest,
  reviewProjectRequest,
  submitProjectRequest,
  updateAdminEquipment,
} from '../services/bookingWorkflowService.js';

describe('LabLink Stage 5: Faculty Approval Workflow', () => {
  let server: ReturnType<ReturnType<typeof createApp>['listen']>;
  let baseUrl = '';

  before(async () => {
    const app = createApp();
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const address = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  });

  beforeEach(() => {
    resetDemoStore();
  });

  function buildRequestInput(
    overrides: Partial<CreateProjectRequestInput> = {},
  ): CreateProjectRequestInput {
    const today = formatIsoDateOffset(0);
    const tomorrow = formatIsoDateOffset(1);
    return {
      equipmentId: 'eq-ur5e-arm',
      studentName: 'Elena Vance',
      department: 'Robotics & Mechatronics',
      projectTitle: 'Compliant Force Assembly Validation',
      projectDescription:
        'Validating wrist force-torque impedance loops for autonomous connector insertion.',
      projectDeadline: tomorrow,
      equipmentRequirements: 'UR5e arm with FT300 sensor calibrated.',
      justification: 'Requires physical hardware force feedback before capstone sign-off.',
      preferredDate: today,
      preferredStartHour: 16,
      preferredEndHour: 18,
      ...overrides,
    };
  }

  it('retrieves pending access requests for Faculty review', async () => {
    const pendingList = listProjectRequests({ status: 'pending' });
    assert.ok(pendingList.some((r) => r.id === 'req-201'));

    const res = await fetch(`${baseUrl}/api/project-requests?status=pending`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { projectRequests: Array<{ id: string; status: string }> };
    assert.ok(body.projectRequests.length >= 1);
    assert.ok(body.projectRequests.every((r) => r.status === 'pending'));
  });

  it('approves a valid pending request with an existing provisional hold and updates linked booking to confirmed without duplicates', () => {
    const bookingsBefore = getBookings().length;
    const result = approveProjectRequest('req-201', 'Dr. Aris Thorne');

    assert.equal(result.request.status, 'approved');
    assert.equal(result.request.facultyReviewer, 'Dr. Aris Thorne');
    assert.ok(result.request.reviewedAt);
    assert.equal(result.request.linkedBookingId, 'bk-103');
    assert.equal(result.updatedBooking?.id, 'bk-103');
    assert.equal(result.updatedBooking?.status, 'confirmed');
    assert.equal(getBookings().length, bookingsBefore);
  });

  it('approves an unlinked pending request on an open slot and creates exactly one confirmed linked booking', () => {
    const today = formatIsoDateOffset(0);
    // Submit a 5-hour request (no provisional hold created on submit because >4h booking cap)
    const created = submitProjectRequest(
      buildRequestInput({
        equipmentId: 'eq-hplc-system',
        department: 'Chemistry',
        projectTitle: 'Extended Solvent Gradient Purification',
        preferredDate: today,
        preferredStartHour: 13,
        preferredEndHour: 18,
      }),
    );
    assert.equal(created.request.linkedBookingId, undefined);

    const bookingsBefore = getBookings().length;
    const approved = approveProjectRequest(
      created.request.id,
      'Prof. Linnea Patel',
      'Approved extended 5-hour purification run.',
    );

    assert.equal(approved.request.status, 'approved');
    assert.equal(
      approved.request.facultyDecisionNote,
      'Approved extended 5-hour purification run.',
    );
    assert.ok(approved.updatedBooking?.id);
    assert.equal(approved.updatedBooking?.status, 'confirmed');
    assert.equal(approved.request.linkedBookingId, approved.updatedBooking?.id);
    assert.equal(getBookings().length, bookingsBefore + 1);
  });

  it('rejects duplicate approval of an already approved request', () => {
    approveProjectRequest('req-201', 'Dr. Aris Thorne', 'First approval');

    assert.throws(
      () => approveProjectRequest('req-201', 'Dr. Aris Thorne', 'Duplicate approval'),
      (err: unknown) =>
        err instanceof AppServiceError && err.statusCode === 400 && err.code === 'INVALID_STATE',
    );
  });

  it('requires a non-empty rejection reason and rejects missing or whitespace reasons', () => {
    for (const badReason of ['', '   ', undefined as unknown as string]) {
      assert.throws(
        () => rejectProjectRequest('req-201', 'Dr. Aris Thorne', badReason),
        (err: unknown) =>
          err instanceof AppServiceError && err.statusCode === 400 && err.code === 'VALIDATION_ERROR',
      );
    }

    const stillPending = getProjectRequestDetails('req-201');
    assert.equal(stillPending.request.status, 'pending');
  });

  it('rejects a pending request, stores the rejection reason, cancels any provisional hold, and creates no new booking', () => {
    const bookingsBefore = getBookings().length;
    const rejected = rejectProjectRequest(
      'req-201',
      'Dr. Aris Thorne',
      'Robot cell safety orientation certification is incomplete.',
    );

    assert.equal(rejected.request.status, 'rejected');
    assert.equal(rejected.request.facultyReviewer, 'Dr. Aris Thorne');
    assert.equal(
      rejected.request.facultyDecisionNote,
      'Robot cell safety orientation certification is incomplete.',
    );
    assert.ok(rejected.request.reviewedAt);
    assert.equal(rejected.updatedBooking?.id, 'bk-103');
    assert.equal(rejected.updatedBooking?.status, 'cancelled');
    assert.equal(getBookingById('bk-103')?.status, 'cancelled');
    assert.equal(getBookings().length, bookingsBefore);
  });

  it('rejects invalid state transitions such as approving a rejected request or rejecting an approved request', () => {
    rejectProjectRequest('req-201', 'Dr. Aris Thorne', 'Incomplete training log.');

    assert.throws(
      () => approveProjectRequest('req-201', 'Dr. Aris Thorne'),
      (err: unknown) =>
        err instanceof AppServiceError && err.statusCode === 400 && err.code === 'INVALID_STATE',
    );

    assert.throws(
      () => reviewProjectRequest('req-203', 'rejected', 'Dr. Aris Thorne', 'Already approved earlier'),
      (err: unknown) =>
        err instanceof AppServiceError && err.statusCode === 400 && err.code === 'INVALID_STATE',
    );
  });

  it('exposes updated approval status, rejection reason, and linked booking details to students', async () => {
    rejectProjectRequest(
      'req-201',
      'Dr. Aris Thorne',
      'Need updated force limit safety calculation.',
    );

    const detailsRes = await fetch(`${baseUrl}/api/project-requests/req-201`);
    assert.equal(detailsRes.status, 200);
    const payload = (await detailsRes.json()) as {
      request: {
        id: string;
        status: string;
        facultyDecisionNote?: string;
        facultyReviewer?: string;
      };
      linkedBooking?: { id: string; status: string };
    };

    assert.equal(payload.request.id, 'req-201');
    assert.equal(payload.request.status, 'rejected');
    assert.equal(payload.request.facultyReviewer, 'Dr. Aris Thorne');
    assert.equal(
      payload.request.facultyDecisionNote,
      'Need updated force limit safety calculation.',
    );
    assert.equal(payload.linkedBooking?.status, 'cancelled');
  });

  it('fails deterministically with 409 SCHEDULE_CONFLICT and creates no booking when slot overlaps an active booking', () => {
    const today = formatIsoDateOffset(0);
    // eq-ur5e-arm already has confirmed bk-101 on today 14:00-16:00
    const overlapping = submitProjectRequest(
      buildRequestInput({
        equipmentId: 'eq-ur5e-arm',
        preferredDate: today,
        preferredStartHour: 14,
        preferredEndHour: 16,
      }),
    );
    assert.equal(overlapping.request.linkedBookingId, undefined);

    const bookingsBefore = getBookings().length;

    assert.throws(
      () => approveProjectRequest(overlapping.request.id, 'Dr. Aris Thorne'),
      (err: unknown) =>
        err instanceof AppServiceError &&
        err.statusCode === 409 &&
        err.code === 'SCHEDULE_CONFLICT' &&
        Boolean((err.details as { conflicts?: unknown[] } | undefined)?.conflicts?.length),
    );

    const updated = getProjectRequestDetails(overlapping.request.id);
    assert.equal(updated.request.status, 'conflict');
    assert.equal(updated.request.linkedBookingId, undefined);
    assert.equal(getBookings().length, bookingsBefore);
  });

  it('blocks approval with 409 EQUIPMENT_MAINTENANCE when equipment is under maintenance', () => {
    updateAdminEquipment('eq-ur5e-arm', { status: 'maintenance' });

    assert.throws(
      () => approveProjectRequest('req-201', 'Dr. Aris Thorne'),
      (err: unknown) =>
        err instanceof AppServiceError &&
        err.statusCode === 409 &&
        err.code === 'EQUIPMENT_MAINTENANCE',
    );

    assert.equal(getProjectRequestDetails('req-201').request.status, 'pending');
    assert.equal(getBookingById('bk-103')?.status, 'pending_faculty');
  });

  it('rejects invalid, malformed, and nonexistent project request IDs', () => {
    assert.throws(
      () => approveProjectRequest('req-missing-999', 'Dr. Aris Thorne'),
      (err: unknown) => err instanceof AppServiceError && err.statusCode === 404 && err.code === 'NOT_FOUND',
    );

    for (const badId of ['', '   ', '../bad-path', 'bad id with spaces']) {
      assert.throws(
        () => rejectProjectRequest(badId, 'Dr. Aris Thorne', 'Valid reason'),
        (err: unknown) =>
          err instanceof AppServiceError && err.statusCode === 400 && err.code === 'VALIDATION_ERROR',
      );
    }
  });

  it('enforces Faculty-only permissions on approve/reject/review HTTP routes (403 for Student and Admin)', async () => {
    const roleHeaderCases: Array<Record<string, string>> = [
      {},
      { 'x-lablink-role': 'student' },
      { 'x-lablink-role': 'admin' },
    ];
    for (const roleHeaders of roleHeaderCases) {
      const approveRes = await fetch(`${baseUrl}/api/project-requests/req-201/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...roleHeaders,
        },
        body: JSON.stringify({ facultyDecisionNote: 'Attempted unauthorized approve' }),
      });
      assert.equal(approveRes.status, 403);
      const approveBody = (await approveRes.json()) as { code: string };
      assert.equal(approveBody.code, 'FORBIDDEN_ROLE');

      const rejectRes = await fetch(`${baseUrl}/api/project-requests/req-201/reject`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...roleHeaders,
        },
        body: JSON.stringify({ reason: 'Attempted unauthorized reject' }),
      });
      assert.equal(rejectRes.status, 403);

      const reviewRes = await fetch(`${baseUrl}/api/project-requests/req-201/review`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...roleHeaders,
        },
        body: JSON.stringify({ decision: 'approved' }),
      });
      assert.equal(reviewRes.status, 403);
    }

    // Request remains untouched pending after unauthorized attempts
    assert.equal(getProjectRequestDetails('req-201').request.status, 'pending');

    // Authorized faculty call succeeds via HTTP
    const facultyApproveRes = await fetch(`${baseUrl}/api/project-requests/req-201/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-lablink-role': 'faculty',
      },
      body: JSON.stringify({
        facultyReviewer: 'Dr. Aris Thorne',
        facultyDecisionNote: 'Cleared via Faculty HTTP endpoint.',
      }),
    });
    assert.equal(facultyApproveRes.status, 200);
    const facultyBody = (await facultyApproveRes.json()) as {
      request: { status: string; facultyDecisionNote?: string };
      updatedBooking?: { id: string; status: string };
    };
    assert.equal(facultyBody.request.status, 'approved');
    assert.equal(
      facultyBody.request.facultyDecisionNote,
      'Cleared via Faculty HTTP endpoint.',
    );
    assert.equal(facultyBody.updatedBooking?.status, 'confirmed');
  });

  it('returns 400 on HTTP reject without reason and 409 on HTTP approve when schedule conflicts', async () => {
    // 1. Missing rejection reason -> 400
    const badRejectRes = await fetch(`${baseUrl}/api/project-requests/req-201/reject`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-lablink-role': 'faculty',
      },
      body: JSON.stringify({ reason: '   ' }),
    });
    assert.equal(badRejectRes.status, 400);
    const badRejectBody = (await badRejectRes.json()) as { code: string };
    assert.equal(badRejectBody.code, 'VALIDATION_ERROR');

    // 2. Conflicting request -> 409 SCHEDULE_CONFLICT with conflict details
    const today = formatIsoDateOffset(0);
    const createRes = await fetch(`${baseUrl}/api/project-requests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        buildRequestInput({
          equipmentId: 'eq-ur5e-arm',
          preferredDate: today,
          preferredStartHour: 14,
          preferredEndHour: 16,
        }),
      ),
    });
    assert.equal(createRes.status, 201);
    const createdPayload = (await createRes.json()) as { request: { id: string } };

    const conflictApproveRes = await fetch(
      `${baseUrl}/api/project-requests/${createdPayload.request.id}/approve`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-lablink-role': 'faculty',
        },
        body: JSON.stringify({ facultyReviewer: 'Dr. Aris Thorne' }),
      },
    );
    assert.equal(conflictApproveRes.status, 409);
    const conflictBody = (await conflictApproveRes.json()) as {
      code: string;
      details?: { conflicts?: Array<{ id: string }> };
    };
    assert.equal(conflictBody.code, 'SCHEDULE_CONFLICT');
    assert.ok(conflictBody.details?.conflicts && conflictBody.details.conflicts.length > 0);
  });
});
