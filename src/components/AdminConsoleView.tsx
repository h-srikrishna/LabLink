import { Plus } from 'lucide-react';
import { useState } from 'react';
import type {
  Booking,
  Equipment,
  EquipmentStatus,
  EquipmentUtilization,
  ProjectAccessRequest,
  UserRole,
} from '../shared/types.js';
import { createEquipmentApi, updateEquipmentApi } from '../client/api.js';

interface AdminConsoleViewProps {
  equipment: Equipment[];
  bookings: Booking[];
  projectRequests: ProjectAccessRequest[];
  utilization: EquipmentUtilization[];
  role: UserRole;
  onStateMutated: (message: string) => void;
}

function formatHour(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

function renderBookingState(status: Booking['status']): { label: string; className: string } {
  if (status === 'confirmed') return { label: '● Confirmed', className: 'text-emerald-800' };
  if (status === 'pending_faculty') return { label: '▲ Pending Faculty', className: 'text-amber-800' };
  return { label: '✖ Cancelled', className: 'text-slate-600' };
}

export function AdminConsoleView({
  equipment,
  bookings,
  projectRequests,
  utilization,
  role,
  onStateMutated,
}: AdminConsoleViewProps) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [name, setName] = useState('');
  const [department, setDepartment] = useState('Robotics & Mechatronics');
  const [labLocation, setLabLocation] = useState('');
  const [category, setCategory] = useState('Instrumentation');
  const [description, setDescription] = useState('');
  const [capabilitiesInput, setCapabilitiesInput] = useState('');
  const [requiresApproval, setRequiresApproval] = useState(false);
  const [openHour, setOpenHour] = useState(8);
  const [closeHour, setCloseHour] = useState(20);
  const [totalUnits, setTotalUnits] = useState(1);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const clearFieldError = (fieldKey: string) => {
    setFieldErrors((prev) => {
      if (!prev[fieldKey]) return prev;
      const next = { ...prev };
      delete next[fieldKey];
      return next;
    });
  };

  const equipmentById = new Map(equipment.map((e) => [e.id, e]));
  const utilizationById = new Map(utilization.map((u) => [u.equipmentId, u]));

  const totalBookedHours = utilization.reduce((sum, u) => sum + u.bookedHours, 0);
  const totalCapacityHours = utilization.reduce((sum, u) => sum + u.totalCapacityHours, 0);
  const overallUtilPercent =
    totalCapacityHours > 0 ? Math.round((totalBookedHours / totalCapacityHours) * 100) : 0;

  const handleStatusChange = async (equipmentId: string, status: EquipmentStatus) => {
    setUpdatingId(equipmentId);
    try {
      await updateEquipmentApi(equipmentId, { status }, role);
      onStateMutated(`Updated equipment operational status to ${status}.`);
    } catch (err: unknown) {
      onStateMutated(err instanceof Error ? err.message : 'Unable to update status.');
    } finally {
      setUpdatingId(null);
    }
  };

  const handleToggleApproval = async (item: Equipment) => {
    setUpdatingId(item.id);
    try {
      await updateEquipmentApi(
        item.id,
        { requiresFacultyApproval: !item.requiresFacultyApproval },
        role,
      );
      onStateMutated(
        `${item.name} now ${!item.requiresFacultyApproval ? 'requires faculty approval' : 'allows instant booking'}.`,
      );
    } catch (err: unknown) {
      onStateMutated(err instanceof Error ? err.message : 'Unable to update approval policy.');
    } finally {
      setUpdatingId(null);
    }
  };

  const handleAddEquipment = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const capabilities = capabilitiesInput
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean);

    const nextErrors: Record<string, string> = {};
    if (!name.trim()) nextErrors.name = 'Enter the equipment resource name.';
    if (!department.trim()) nextErrors.department = 'Enter the owning department.';
    if (!labLocation.trim()) nextErrors.labLocation = 'Enter the lab room or building location.';
    if (!category.trim()) nextErrors.category = 'Enter an equipment category.';
    if (!Number.isInteger(totalUnits) || totalUnits < 1 || totalUnits > 50) {
      nextErrors.totalUnits = 'Total units must be a whole number between 1 and 50.';
    }
    if (
      !Number.isInteger(openHour) ||
      !Number.isInteger(closeHour) ||
      openHour < 6 ||
      closeHour > 23 ||
      closeHour <= openHour
    ) {
      nextErrors.closeHour = 'Operating hours must be whole hours between 06:00 and 23:00 with close after open.';
    }
    if (capabilities.length === 0) {
      nextErrors.capabilities = 'List at least one hardware capability separated by commas.';
    }
    if (!description.trim()) {
      nextErrors.description = 'Enter a short technical description.';
    }

    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors(nextErrors);
      setFormError('Please review and complete the highlighted equipment fields.');
      const fieldIdMap: Array<[string, string]> = [
        ['name', 'admin-eq-name'],
        ['department', 'admin-eq-dept'],
        ['labLocation', 'admin-eq-loc'],
        ['category', 'admin-eq-cat'],
        ['totalUnits', 'admin-eq-units'],
        ['closeHour', 'admin-eq-close'],
        ['capabilities', 'admin-eq-caps'],
        ['description', 'admin-eq-desc'],
      ];
      const firstInvalid = fieldIdMap.find(([key]) => Boolean(nextErrors[key]));
      if (firstInvalid) {
        document.getElementById(firstInvalid[1])?.focus();
      }
      return;
    }

    setFieldErrors({});
    setSubmitting(true);
    try {
      await createEquipmentApi(
        {
          name: name.trim(),
          department: department.trim(),
          labLocation: labLocation.trim(),
          category: category.trim(),
          description: description.trim(),
          capabilities,
          requiresFacultyApproval: requiresApproval,
          openHour,
          closeHour,
          totalUnits,
        },
        role,
      );
      setName('');
      setLabLocation('');
      setDescription('');
      setCapabilitiesInput('');
      setTotalUnits(1);
      setShowAddForm(false);
      onStateMutated('New lab equipment added to the campus catalog.');
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Could not add equipment.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section aria-labelledby="admin-heading" className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 id="admin-heading" className="text-2xl font-bold text-slate-900">
            Lab Admin Resource & Utilization Console
          </h1>
          <p className="text-sm text-slate-600">
            Monitor 2-day campus hardware utilization, toggle maintenance blocks, and register shared lab resources.
          </p>
        </div>

        <button
          type="button"
          aria-expanded={showAddForm}
          aria-controls="admin-add-equipment-form"
          onClick={() => {
            setFormError(null);
            setFieldErrors({});
            setShowAddForm((prev) => !prev);
          }}
          className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
        >
          <Plus className="w-4 h-4" aria-hidden="true" />
          <span>{showAddForm ? 'Close Form' : 'Add Equipment'}</span>
        </button>
      </div>

      {/* Campus Utilization Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-1">
          <p className="text-xs text-slate-600">Shared Resources</p>
          <p className="text-2xl font-bold font-mono tabular-nums text-slate-900">
            {equipment.length}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-1">
          <p className="text-xs text-slate-600">2-Day Utilization</p>
          <p className="text-2xl font-bold font-mono tabular-nums text-blue-700">
            {overallUtilPercent}%
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-1">
          <p className="text-xs text-slate-600">Booked Hours (48h)</p>
          <p className="text-2xl font-bold font-mono tabular-nums text-slate-900">
            {totalBookedHours}h / {totalCapacityHours}h
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-1">
          <p className="text-xs text-slate-600">Pending Faculty Reviews</p>
          <p className="text-2xl font-bold font-mono tabular-nums text-amber-800">
            {projectRequests.filter((r) => r.status === 'pending').length}
          </p>
        </div>
      </div>

      {showAddForm && (
        <form
          id="admin-add-equipment-form"
          noValidate
          onSubmit={handleAddEquipment}
          aria-labelledby="admin-add-form-heading"
          className="bg-white border border-slate-200 rounded-xl p-6 space-y-4"
        >
          <div>
            <h2 id="admin-add-form-heading" className="text-base font-semibold text-slate-900">
              Register New Lab Resource
            </h2>
            <p className="text-xs text-slate-600 mt-0.5">
              Fields marked with <span aria-hidden="true" className="text-rose-700 font-semibold">*</span>
              <span className="sr-only">an asterisk</span> are required.
            </p>
          </div>

          <fieldset className="space-y-4">
            <legend className="sr-only">Equipment identity and operating capacity</legend>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <label htmlFor="admin-eq-name" className="block text-xs font-medium text-slate-700">
                  Equipment Name
                  <span aria-hidden="true" className="text-rose-700"> *</span>
                  <span className="sr-only"> (required)</span>
                </label>
                <input
                  id="admin-eq-name"
                  type="text"
                  required
                  maxLength={100}
                  placeholder="e.g. Keysight Power Analyzer"
                  value={name}
                  aria-invalid={Boolean(fieldErrors.name)}
                  aria-describedby={fieldErrors.name ? 'admin-eq-name-error' : undefined}
                  onChange={(e) => {
                    setName(e.target.value);
                    clearFieldError('name');
                  }}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 placeholder:text-slate-500"
                />
                {fieldErrors.name && (
                  <p id="admin-eq-name-error" role="alert" className="text-xs text-rose-800 font-medium">
                    {fieldErrors.name}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <label htmlFor="admin-eq-dept" className="block text-xs font-medium text-slate-700">
                  Department
                  <span aria-hidden="true" className="text-rose-700"> *</span>
                  <span className="sr-only"> (required)</span>
                </label>
                <input
                  id="admin-eq-dept"
                  type="text"
                  required
                  maxLength={80}
                  value={department}
                  aria-invalid={Boolean(fieldErrors.department)}
                  aria-describedby={fieldErrors.department ? 'admin-eq-dept-error' : undefined}
                  onChange={(e) => {
                    setDepartment(e.target.value);
                    clearFieldError('department');
                  }}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
                {fieldErrors.department && (
                  <p id="admin-eq-dept-error" role="alert" className="text-xs text-rose-800 font-medium">
                    {fieldErrors.department}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <label htmlFor="admin-eq-loc" className="block text-xs font-medium text-slate-700">
                  Lab Room Location
                  <span aria-hidden="true" className="text-rose-700"> *</span>
                  <span className="sr-only"> (required)</span>
                </label>
                <input
                  id="admin-eq-loc"
                  type="text"
                  required
                  maxLength={80}
                  placeholder="e.g. Engineering Hall 210"
                  value={labLocation}
                  aria-invalid={Boolean(fieldErrors.labLocation)}
                  aria-describedby={fieldErrors.labLocation ? 'admin-eq-loc-error' : undefined}
                  onChange={(e) => {
                    setLabLocation(e.target.value);
                    clearFieldError('labLocation');
                  }}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 placeholder:text-slate-500"
                />
                {fieldErrors.labLocation && (
                  <p id="admin-eq-loc-error" role="alert" className="text-xs text-rose-800 font-medium">
                    {fieldErrors.labLocation}
                  </p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="space-y-1.5">
                <label htmlFor="admin-eq-cat" className="block text-xs font-medium text-slate-700">
                  Category
                  <span aria-hidden="true" className="text-rose-700"> *</span>
                  <span className="sr-only"> (required)</span>
                </label>
                <input
                  id="admin-eq-cat"
                  type="text"
                  required
                  maxLength={60}
                  value={category}
                  aria-invalid={Boolean(fieldErrors.category)}
                  aria-describedby={fieldErrors.category ? 'admin-eq-cat-error' : undefined}
                  onChange={(e) => {
                    setCategory(e.target.value);
                    clearFieldError('category');
                  }}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
                {fieldErrors.category && (
                  <p id="admin-eq-cat-error" role="alert" className="text-xs text-rose-800 font-medium">
                    {fieldErrors.category}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <label htmlFor="admin-eq-units" className="block text-xs font-medium text-slate-700">
                  Total Units
                  <span aria-hidden="true" className="text-rose-700"> *</span>
                  <span className="sr-only"> (required)</span>
                </label>
                <input
                  id="admin-eq-units"
                  type="number"
                  min={1}
                  max={50}
                  required
                  value={totalUnits}
                  aria-invalid={Boolean(fieldErrors.totalUnits)}
                  aria-describedby={fieldErrors.totalUnits ? 'admin-eq-units-error' : undefined}
                  onChange={(e) => {
                    setTotalUnits(Number(e.target.value));
                    clearFieldError('totalUnits');
                  }}
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
                {fieldErrors.totalUnits && (
                  <p id="admin-eq-units-error" role="alert" className="text-xs text-rose-800 font-medium">
                    {fieldErrors.totalUnits}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <label htmlFor="admin-eq-open" className="block text-xs font-medium text-slate-700">
                  Open Hour (24h)
                </label>
                <input
                  id="admin-eq-open"
                  type="number"
                  min={6}
                  max={12}
                  required
                  value={openHour}
                  onChange={(e) => {
                    setOpenHour(Number(e.target.value));
                    clearFieldError('closeHour');
                  }}
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="admin-eq-close" className="block text-xs font-medium text-slate-700">
                  Close Hour (24h)
                </label>
                <input
                  id="admin-eq-close"
                  type="number"
                  min={14}
                  max={23}
                  required
                  value={closeHour}
                  aria-invalid={Boolean(fieldErrors.closeHour)}
                  aria-describedby={fieldErrors.closeHour ? 'admin-eq-close-error' : undefined}
                  onChange={(e) => {
                    setCloseHour(Number(e.target.value));
                    clearFieldError('closeHour');
                  }}
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
                {fieldErrors.closeHour && (
                  <p id="admin-eq-close-error" role="alert" className="text-xs text-rose-800 font-medium">
                    {fieldErrors.closeHour}
                  </p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label htmlFor="admin-eq-caps" className="block text-xs font-medium text-slate-700">
                  Capabilities (Comma-Separated)
                  <span aria-hidden="true" className="text-rose-700"> *</span>
                  <span className="sr-only"> (required)</span>
                </label>
                <input
                  id="admin-eq-caps"
                  type="text"
                  required
                  placeholder="e.g. ROS2 Control, High-Current Probe"
                  value={capabilitiesInput}
                  aria-invalid={Boolean(fieldErrors.capabilities)}
                  aria-describedby={fieldErrors.capabilities ? 'admin-eq-caps-error' : undefined}
                  onChange={(e) => {
                    setCapabilitiesInput(e.target.value);
                    clearFieldError('capabilities');
                  }}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 placeholder:text-slate-500"
                />
                {fieldErrors.capabilities && (
                  <p id="admin-eq-caps-error" role="alert" className="text-xs text-rose-800 font-medium">
                    {fieldErrors.capabilities}
                  </p>
                )}
              </div>

              <div className="flex items-end pb-2">
                <label className="inline-flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={requiresApproval}
                    onChange={(e) => setRequiresApproval(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                  />
                  <span>Requires Faculty Approval before confirmation</span>
                </label>
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="admin-eq-desc" className="block text-xs font-medium text-slate-700">
                Technical Description
                <span aria-hidden="true" className="text-rose-700"> *</span>
                <span className="sr-only"> (required)</span>
              </label>
              <textarea
                id="admin-eq-desc"
                rows={2}
                required
                maxLength={300}
                value={description}
                aria-invalid={Boolean(fieldErrors.description)}
                aria-describedby={fieldErrors.description ? 'admin-eq-desc-error' : undefined}
                onChange={(e) => {
                  setDescription(e.target.value);
                  clearFieldError('description');
                }}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
              {fieldErrors.description && (
                <p id="admin-eq-desc-error" role="alert" className="text-xs text-rose-800 font-medium">
                  {fieldErrors.description}
                </p>
              )}
            </div>
          </fieldset>

          {formError && (
            <p role="alert" className="text-xs sm:text-sm text-rose-800 font-medium">
              {formError}
            </p>
          )}

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
            >
              {submitting ? 'Saving...' : 'Create Equipment'}
            </button>
          </div>
        </form>
      )}

      {/* Equipment Utilization & Control Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200">
          <h2 id="admin-utilization-heading" className="text-base font-semibold text-slate-900">
            Resource Utilization & Status Controls
          </h2>
        </div>

        <div
          tabIndex={0}
          role="region"
          aria-labelledby="admin-utilization-heading"
          className="overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600"
        >
          <table className="w-full text-left border-collapse text-sm">
            <caption className="sr-only">
              Campus lab equipment utilization metrics, approval policy toggles, and operational status controls
            </caption>
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-700">
                <th scope="col" className="py-3 px-4">Equipment Resource</th>
                <th scope="col" className="py-3 px-4">48h Utilization</th>
                <th scope="col" className="py-3 px-4">Active / Pending</th>
                <th scope="col" className="py-3 px-4">Approval Policy</th>
                <th scope="col" className="py-3 px-4">Operational Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {equipment.map((item) => {
                const util = utilizationById.get(item.id);
                const percent = util?.utilizationPercent ?? 0;

                return (
                  <tr key={item.id} className="hover:bg-slate-50/60">
                    <td className="py-3.5 px-4">
                      <p className="font-semibold text-slate-900">{item.name}</p>
                      <p className="text-xs text-slate-600">
                        {item.department} · {item.labLocation} ·{' '}
                        <span className="font-mono tabular-nums">
                          {item.availableUnits}/{item.totalUnits} units
                        </span>
                      </p>
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-3">
                        <div
                          aria-hidden="true"
                          className="w-24 h-2 bg-slate-100 rounded-full overflow-hidden"
                        >
                          <div
                            className="h-full bg-blue-600 rounded-full"
                            style={{ width: `${percent}%` }}
                          />
                        </div>
                        <span className="font-mono tabular-nums text-xs text-slate-700">
                          {percent}% ({util?.bookedHours ?? 0}h/{util?.totalCapacityHours ?? 24}h)
                        </span>
                      </div>
                    </td>
                    <td className="py-3.5 px-4 font-mono tabular-nums text-xs text-slate-700">
                      {util?.activeBookingsCount ?? 0} slots · {util?.pendingRequestsCount ?? 0} req
                    </td>
                    <td className="py-3.5 px-4">
                      <button
                        type="button"
                        disabled={updatingId === item.id}
                        aria-pressed={item.requiresFacultyApproval}
                        aria-label={`Toggle faculty approval requirement for ${item.name}. Currently ${
                          item.requiresFacultyApproval ? 'Faculty Required' : 'Instant Access'
                        }`}
                        onClick={() => handleToggleApproval(item)}
                        className="px-2.5 py-1 text-xs font-medium border border-slate-300 rounded-md bg-white hover:bg-slate-50 text-slate-700 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                      >
                        {item.requiresFacultyApproval ? 'Faculty Required' : 'Instant Access'}
                      </button>
                    </td>
                    <td className="py-3.5 px-4">
                      <label htmlFor={`status-${item.id}`} className="sr-only">
                        Operational status for {item.name}
                      </label>
                      <select
                        id={`status-${item.id}`}
                        value={item.status}
                        disabled={updatingId === item.id}
                        onChange={(e) => handleStatusChange(item.id, e.target.value as EquipmentStatus)}
                        className="px-2.5 py-1.5 text-xs font-medium bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
                      >
                        <option value="available">Available</option>
                        <option value="restricted">Restricted (Approval)</option>
                        <option value="maintenance">Maintenance</option>
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Campus-Wide Audit Log */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 id="admin-bookings-heading" className="text-base font-semibold text-slate-900">
            Campus Bookings Overview
          </h2>
          <span className="text-xs font-mono tabular-nums text-slate-600">
            {bookings.length} records
          </span>
        </div>

        <div
          tabIndex={0}
          role="region"
          aria-labelledby="admin-bookings-heading"
          className="overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600"
        >
          <table className="w-full text-left border-collapse text-xs sm:text-sm">
            <caption className="sr-only">
              Campus-wide bookings overview showing equipment resource, student, project, time window, and booking state
            </caption>
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-700">
                <th scope="col" className="py-3 px-4">Resource</th>
                <th scope="col" className="py-3 px-4">Student</th>
                <th scope="col" className="py-3 px-4">Project</th>
                <th scope="col" className="py-3 px-4">Time Window</th>
                <th scope="col" className="py-3 px-4">State</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {bookings.map((b) => {
                const stateInfo = renderBookingState(b.status);
                return (
                  <tr key={b.id}>
                    <td className="py-3 px-4 font-medium text-slate-900">
                      {equipmentById.get(b.equipmentId)?.name ?? b.equipmentId}
                    </td>
                    <td className="py-3 px-4 text-slate-700">{b.studentName}</td>
                    <td className="py-3 px-4 text-slate-600">{b.projectTitle}</td>
                    <td className="py-3 px-4 font-mono tabular-nums text-xs text-slate-700">
                      {b.date} · {formatHour(b.startHour)}–{formatHour(b.endHour)}
                    </td>
                    <td className={`py-3 px-4 text-xs font-medium whitespace-nowrap ${stateInfo.className}`}>
                      {stateInfo.label}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
