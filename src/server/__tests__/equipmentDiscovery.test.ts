import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { resetDemoStore } from '../data/store.js';
import { updateAdminEquipment } from '../services/bookingWorkflowService.js';
import { AppServiceError } from '../services/bookingWorkflowService.js';
import { discoverEquipment } from '../services/equipmentDiscoveryService.js';

describe('LabLink Equipment Discovery Service', () => {
  beforeEach(() => {
    resetDemoStore();
  });

  it('retrieves all seeded campus resources across departments and categories', () => {
    const result = discoverEquipment({});
    assert.ok(result.total >= 7);
    assert.equal(result.equipment.length, result.total);
    assert.ok(result.equipment.every((item) => item.totalUnits >= 1 && item.availableUnits >= 0));
  });

  it('supports case-insensitive partial name search', () => {
    const result = discoverEquipment({ q: 'oscillo' });
    assert.equal(result.total, 1);
    assert.equal(result.equipment[0].id, 'eq-keysight-mso');
  });

  it('supports department search and exact department filtering including Chemistry', () => {
    const viaSearch = discoverEquipment({ q: 'chemistry' });
    assert.ok(viaSearch.equipment.some((item) => item.department === 'Chemistry'));

    const viaFilter = discoverEquipment({ department: 'Chemistry' });
    assert.equal(viaFilter.total, 1);
    assert.equal(viaFilter.equipment[0].id, 'eq-hplc-system');
  });

  it('filters equipment accurately by category', () => {
    const devKits = discoverEquipment({ category: 'Development Kits' });
    assert.equal(devKits.total, 1);
    assert.equal(devKits.equipment[0].id, 'eq-fpga-rig');

    const workstations = discoverEquipment({ category: 'Lab Workstations' });
    assert.equal(workstations.total, 1);
    assert.equal(workstations.equipment[0].id, 'eq-a100-node');
  });

  it('searches across equipment capabilities safely', () => {
    const ros2 = discoverEquipment({ q: 'ROS2 Control' });
    assert.ok(ros2.total >= 2);
    assert.ok(ros2.equipment.some((e) => e.id === 'eq-ur5e-arm'));
    assert.ok(ros2.equipment.some((e) => e.id === 'eq-fpga-rig'));

    const chromatography = discoverEquipment({ q: 'chromatography' });
    assert.equal(chromatography.total, 1);
    assert.equal(chromatography.equipment[0].id, 'eq-hplc-system');
  });

  it('filters by availability including instant, approval-required, and maintenance states', () => {
    const approvalRequired = discoverEquipment({ availability: 'approval' });
    assert.ok(approvalRequired.total >= 2);
    assert.ok(approvalRequired.equipment.every((e) => e.requiresFacultyApproval));

    const instantOnly = discoverEquipment({ availability: 'instant' });
    assert.ok(instantOnly.equipment.every((e) => !e.requiresFacultyApproval));

    updateAdminEquipment('eq-keysight-mso', { status: 'maintenance' });
    const maintenanceOnly = discoverEquipment({ availability: 'maintenance' });
    assert.equal(maintenanceOnly.total, 1);
    assert.equal(maintenanceOnly.equipment[0].id, 'eq-keysight-mso');
    assert.equal(maintenanceOnly.equipment[0].availableUnits, 0);

    const availableNow = discoverEquipment({ availability: 'available' });
    assert.ok(availableNow.equipment.every((e) => e.id !== 'eq-keysight-mso'));
  });

  it('combines search, department, category, and availability filters together', () => {
    const combined = discoverEquipment({
      q: 'UV-Vis',
      department: 'Chemistry',
      category: 'Laboratory Instruments',
      availability: 'instant',
    });
    assert.equal(combined.total, 1);
    assert.equal(combined.equipment[0].id, 'eq-hplc-system');
  });

  it('returns clean empty results and safely handles malicious or invalid queries', () => {
    const empty = discoverEquipment({ q: 'quantum-cryostat-xyz' });
    assert.equal(empty.total, 0);
    assert.deepEqual(empty.equipment, []);

    // Regex metacharacters must be treated as literal plain text without throwing
    const regexChars = discoverEquipment({ q: '([a+]+)+$' });
    assert.equal(regexChars.total, 0);

    // Invalid availability enum rejected cleanly
    assert.throws(
      () => discoverEquipment({ availability: 'invalid_mode' }),
      (err: unknown) => err instanceof AppServiceError && err.statusCode === 400,
    );

    // Oversized search query rejected cleanly
    assert.throws(
      () => discoverEquipment({ q: 'a'.repeat(150) }),
      (err: unknown) => err instanceof AppServiceError && err.statusCode === 400,
    );
  });
});
