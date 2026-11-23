import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, it } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { getNextWrappedFocusIndex } from '../../client/useModalFocusTrap.js';
import { AdminConsoleView } from '../../components/AdminConsoleView.js';
import { BookingDrawer } from '../../components/BookingDrawer.js';
import { EquipmentCatalog } from '../../components/EquipmentCatalog.js';
import { FacultyReviewView } from '../../components/FacultyReviewView.js';
import { StudentScheduleView } from '../../components/StudentScheduleView.js';
import { TopBar } from '../../components/TopBar.js';
import { formatIsoDateOffset } from '../data/seedData.js';
import { resetDemoStore } from '../data/store.js';
import { getBookings } from '../repositories/bookingRepository.js';
import { getEquipment } from '../repositories/equipmentRepository.js';
import { getProjectRequests } from '../repositories/projectRequestRepository.js';
import { calculateEquipmentUtilization } from '../services/schedulingService.js';

function assertAllFormControlsLabeled(html: string, contextName: string) {
  const controlMatches = [...html.matchAll(/<(input|select|textarea)\b([^>]*)>/gi)];
  assert.ok(controlMatches.length > 0, `${contextName}: expected at least one form control`);

  for (const match of controlMatches) {
    const tag = match[1].toLowerCase();
    const attrs = match[2];
    const idMatch = attrs.match(/\bid="([^"]+)"/i);
    const hasAriaLabel = /\baria-label="[^"]+"/i.test(attrs) || /\baria-labelledby="[^"]+"/i.test(attrs);
    const isCheckbox = tag === 'input' && /\btype="checkbox"/i.test(attrs);

    if (isCheckbox) {
      // Checkbox wrapped inside <label> ... <input type="checkbox" .../> ... </label>
      continue;
    }

    assert.ok(idMatch || hasAriaLabel, `${contextName}: <${tag}> missing id or aria-label (${attrs})`);
    if (idMatch && !hasAriaLabel) {
      const controlId = idMatch[1];
      const labelRegex = new RegExp(`<label\\b[^>]*\\bfor="${controlId}"[^>]*>`, 'i');
      assert.match(html, labelRegex, `${contextName}: missing <label for="${controlId}">`);
    }
  }
}

describe('LabLink Stage 7: Complete Accessibility Pass', () => {
  const today = formatIsoDateOffset(0);
  const tomorrow = formatIsoDateOffset(1);

  beforeEach(() => {
    resetDemoStore();
  });

  it('wraps keyboard focus forward and backward accurately inside modal focus trap helper', () => {
    assert.equal(getNextWrappedFocusIndex(-1, 0, false), -1);
    assert.equal(getNextWrappedFocusIndex(0, 4, false), 1);
    assert.equal(getNextWrappedFocusIndex(3, 4, false), 0);
    assert.equal(getNextWrappedFocusIndex(0, 4, true), 3);
    assert.equal(getNextWrappedFocusIndex(2, 4, true), 1);
  });

  it('verifies index.html and App landmark / tablist / skip-link structure', () => {
    const indexHtml = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
    assert.match(indexHtml, /<html lang="en">/i);
    assert.match(indexHtml, /<meta name="viewport" content="width=device-width, initial-scale=1\.0"/i);
    assert.match(indexHtml, /<title>LabLink/i);

    const appSource = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');
    assert.match(appSource, /id="main-content"/);
    assert.match(appSource, /role="tablist"/);
    assert.match(appSource, /role="tabpanel"/);
    assert.match(appSource, /aria-controls="student-tabpanel"/);
    assert.match(appSource, /<footer\b/);

    const topBarHtml = renderToStaticMarkup(
      React.createElement(TopBar, {
        role: 'student',
        onRoleChange: () => {},
        onResetDemo: () => {},
        isResetting: false,
        pendingFacultyCount: 2,
      }),
    );

    assert.match(topBarHtml, /<header\b/);
    assert.match(topBarHtml, /href="#main-content"[^>]*>Skip to main content<\/a>/);
    assert.match(topBarHtml, /<nav\b[^>]*aria-label="Demo user role switcher"/);
    assert.match(topBarHtml, /aria-pressed="true"/);
    assert.match(topBarHtml, /\(current role\)/);
    assert.match(topBarHtml, /pending approvals/);
    assert.match(topBarHtml, /aria-label="Reset demo dataset to initial campus state"/);
  });

  it('renders EquipmentCatalog with search landmark, labeled filters, heading hierarchy, and non-color statuses', () => {
    const equipment = getEquipment();
    const bookings = getBookings();

    const html = renderToStaticMarkup(
      React.createElement(EquipmentCatalog, {
        equipment,
        bookings,
        today,
        onSelectEquipment: () => {},
        onSimulateConflictDemo: () => {},
      }),
    );

    assert.match(html, /<h1\b[^>]*id="catalog-heading"/);
    assert.match(html, /<form\b[^>]*role="search"/);
    assert.match(html, /aria-labelledby="department-filter-label"/);
    assert.match(html, /aria-pressed="true"/);
    assert.match(html, /● Available|▲ Faculty Approval|✖ Maintenance/);
    assert.match(html, /Inspect Details &amp; Book/);
    assertAllFormControlsLabeled(html, 'EquipmentCatalog');
  });

  it('renders BookingDrawer as an accessible modal dialog with conflict notice and labeled booking form', () => {
    const equipment = getEquipment();
    const bookings = getBookings();
    const flagship = equipment.find((eq) => eq.id === 'eq-ur5e-arm') ?? equipment[0];

    const html = renderToStaticMarkup(
      React.createElement(BookingDrawer, {
        equipment: flagship,
        allEquipment: equipment,
        bookings,
        today,
        tomorrow,
        role: 'student',
        presetConflictDemo: true,
        onClose: () => {},
        onSwitchEquipment: () => {},
        onBookingCreated: () => {},
        onRequestProjectAccess: () => {},
      }),
    );

    assert.match(html, /role="dialog"/);
    assert.match(html, /aria-modal="true"/);
    assert.match(html, /aria-labelledby="drawer-equipment-title"/);
    assert.match(html, /aria-label="Close booking panel for /);
    assert.match(html, /<fieldset\b/);
    assert.match(html, /<legend\b[^>]*class="sr-only"/);
    assert.match(html, /\(required\)/);
    assert.match(html, /Your requested slot is unavailable\./);
    assert.match(html, /aria-label="14:00,/);
    assertAllFormControlsLabeled(html, 'BookingDrawer');
  });

  it('renders StudentScheduleView with expanded request form accessibility and semantic bookings table', () => {
    const equipment = getEquipment();
    const bookings = getBookings();
    const projectRequests = getProjectRequests();

    const html = renderToStaticMarkup(
      React.createElement(StudentScheduleView, {
        equipment,
        bookings,
        projectRequests,
        today,
        tomorrow,
        role: 'student',
        autoOpenRequestForm: true,
        onStateMutated: () => {},
        onOpenEquipment: () => {},
      }),
    );

    assert.match(html, /<h1\b[^>]*id="student-schedule-heading"/);
    assert.match(html, /aria-expanded="true"/);
    assert.match(html, /aria-controls="project-request-form"/);
    assert.match(html, /id="project-request-form"/);
    assert.match(html, /<fieldset\b/);
    assert.match(html, /<caption\b[^>]*class="sr-only"/);
    assert.match(html, /<th scope="col"/);
    assert.match(html, /tabindex="0"|tabIndex="0"/i);
    assert.match(html, /aria-label="Cancel booking for /);
    assert.match(html, /● Confirmed|▲ Pending Faculty/);
    assertAllFormControlsLabeled(html, 'StudentScheduleView');
  });

  it('renders FacultyReviewView with accessible filters, labeled note inputs, descriptive buttons, and modal wiring', () => {
    const equipment = getEquipment();
    const bookings = getBookings();
    const projectRequests = getProjectRequests();

    const html = renderToStaticMarkup(
      React.createElement(FacultyReviewView, {
        equipment,
        bookings,
        projectRequests,
        today,
        role: 'faculty',
        onStateMutated: () => {},
      }),
    );

    assert.match(html, /<h1\b[^>]*id="faculty-heading"/);
    assert.match(html, /aria-pressed="true"/);
    assert.match(html, /aria-label="View full details for /);
    assert.match(html, /aria-label="Approve access request for /);
    assert.match(html, /aria-label="Reject access request for /);
    assert.match(html, /▲ Pending Decision/);
    assertAllFormControlsLabeled(html, 'FacultyReviewView');

    const facultySource = readFileSync(
      resolve(process.cwd(), 'src/components/FacultyReviewView.tsx'),
      'utf8',
    );
    assert.match(facultySource, /useModalFocusTrap/);
    assert.match(facultySource, /aria-labelledby="faculty-detail-title"/);
    assert.match(facultySource, /aria-invalid=\{Boolean\(fieldError\)\}/);
    assert.match(facultySource, /modal-decision-note/);
  });

  it('renders AdminConsoleView with accessible tables, approval toggles, status selects, and add-equipment form controls', () => {
    const equipment = getEquipment();
    const bookings = getBookings();
    const projectRequests = getProjectRequests();
    const utilization = calculateEquipmentUtilization(
      equipment,
      bookings,
      projectRequests,
      [today, tomorrow],
    );

    const html = renderToStaticMarkup(
      React.createElement(AdminConsoleView, {
        equipment,
        bookings,
        projectRequests,
        utilization,
        role: 'admin',
        onStateMutated: () => {},
      }),
    );

    assert.match(html, /<h1\b[^>]*id="admin-heading"/);
    assert.match(html, /aria-expanded="false"/);
    assert.match(html, /aria-controls="admin-add-equipment-form"/);
    const captionMatches = html.match(/<caption\b[^>]*class="sr-only"/g) ?? [];
    assert.equal(captionMatches.length, 2, 'Expected captions on both admin tables');
    assert.match(html, /<th scope="col"/);
    assert.match(html, /aria-pressed="(true|false)"/);
    assert.match(html, /Toggle faculty approval requirement for /);
    assert.match(html, /● Confirmed|▲ Pending Faculty/);
    assertAllFormControlsLabeled(html, 'AdminConsoleView');

    const adminSource = readFileSync(
      resolve(process.cwd(), 'src/components/AdminConsoleView.tsx'),
      'utf8',
    );
    assert.match(adminSource, /id="admin-add-equipment-form"/);
    assert.match(adminSource, /<fieldset\b/);
    assert.match(adminSource, /aria-invalid=\{Boolean\(fieldErrors\.name\)\}/);
  });
});
