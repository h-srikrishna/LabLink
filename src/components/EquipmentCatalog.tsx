import { CalendarClock, Search, Sparkles, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  filterEquipmentCatalog,
  MAX_SEARCH_QUERY_LENGTH,
} from '../shared/equipmentFilter.js';
import type {
  Booking,
  Equipment,
  EquipmentAvailabilityFilter,
} from '../shared/types.js';
import { EquipmentImage } from './EquipmentImage.js';

interface EquipmentCatalogProps {
  equipment: Equipment[];
  bookings: Booking[];
  today: string;
  onSelectEquipment: (equipment: Equipment) => void;
  onSimulateConflictDemo: () => void;
}

function getNextAvailableSlotLabel(equipment: Equipment, bookings: Booking[], today: string): string {
  if (equipment.status === 'maintenance' || equipment.availableUnits <= 0) {
    return 'Unavailable (Maintenance)';
  }

  const todayBookings = bookings.filter(
    (b) => b.equipmentId === equipment.id && b.date === today && b.status !== 'cancelled',
  );

  for (let hour = equipment.openHour; hour < equipment.closeHour; hour += 1) {
    const occupied = todayBookings.some((b) => hour >= b.startHour && hour < b.endHour);
    if (!occupied) {
      return `Today ${String(hour).padStart(2, '0')}:00`;
    }
  }

  return 'Tomorrow 08:00';
}

function getStatusDisplay(equipment: Equipment): { label: string; className: string } {
  if (equipment.status === 'maintenance' || equipment.availableUnits <= 0) {
    return { label: '✖ Maintenance', className: 'text-rose-800' };
  }
  if (equipment.requiresFacultyApproval || equipment.status === 'restricted') {
    return { label: '▲ Faculty Approval', className: 'text-amber-800' };
  }
  return { label: '● Available', className: 'text-emerald-800' };
}

export function EquipmentCatalog({
  equipment,
  bookings,
  today,
  onSelectEquipment,
  onSimulateConflictDemo,
}: EquipmentCatalogProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDepartment, setSelectedDepartment] = useState<string>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [availabilityFilter, setAvailabilityFilter] =
    useState<EquipmentAvailabilityFilter>('all');

  const departments = useMemo(() => {
    const unique = Array.from(new Set(equipment.map((eq) => eq.department)));
    return ['all', ...unique];
  }, [equipment]);

  const categories = useMemo(() => {
    const unique = Array.from(new Set(equipment.map((eq) => eq.category)));
    return ['all', ...unique];
  }, [equipment]);

  const filteredEquipment = useMemo(() => {
    return filterEquipmentCatalog(equipment, {
      q: searchQuery,
      department: selectedDepartment,
      category: selectedCategory,
      availability: availabilityFilter,
    });
  }, [equipment, searchQuery, selectedDepartment, selectedCategory, availabilityFilter]);

  const hasActiveFilters =
    searchQuery.trim().length > 0 ||
    selectedDepartment !== 'all' ||
    selectedCategory !== 'all' ||
    availabilityFilter !== 'all';

  const handleClearFilters = () => {
    setSearchQuery('');
    setSelectedDepartment('all');
    setSelectedCategory('all');
    setAvailabilityFilter('all');
  };

  return (
    <section aria-labelledby="catalog-heading" className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
        <div className="max-w-2xl space-y-2">
          <p className="text-xs font-medium text-blue-700">
            Cross-Department Campus Equipment Directory
          </p>
          <h1
            id="catalog-heading"
            className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 text-balance"
          >
            Discover specialised lab hardware, dev kits, and workstations
          </h1>
          <p className="text-sm sm:text-base text-slate-600 leading-relaxed">
            Search across campus departments by hardware name, capability, or category. Check live unit
            counts and open time windows, or run the conflict demo to see fair AI scheduling.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={onSimulateConflictDemo}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
          >
            <Sparkles className="w-4 h-4" aria-hidden="true" />
            <span>Simulate Conflict Demo</span>
          </button>
        </div>
      </div>

      {/* Search & Multi-Criteria Filter Controls */}
      <form
        role="search"
        aria-label="Search and filter campus lab equipment"
        onSubmit={(e) => e.preventDefault()}
        className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-4"
      >
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-end">
          <div className="lg:col-span-5 space-y-1.5">
            <label htmlFor="equipment-search" className="block text-xs font-medium text-slate-800">
              Search Equipment, Department, Category, or Capability
            </label>
            <div className="relative">
              <Search
                className="w-4 h-4 text-slate-600 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                aria-hidden="true"
              />
              <input
                id="equipment-search"
                type="search"
                maxLength={MAX_SEARCH_QUERY_LENGTH}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="e.g. ROS2, Chemistry, FPGA, oscilloscope..."
                className="w-full pl-10 pr-9 py-2 text-sm text-slate-900 bg-slate-50 border border-slate-300 rounded-lg placeholder:text-slate-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  aria-label="Clear search query"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-600 hover:text-slate-900 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                >
                  <X className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              )}
            </div>
          </div>

          <div className="lg:col-span-3 space-y-1.5">
            <label htmlFor="category-filter" className="block text-xs font-medium text-slate-800">
              Category
            </label>
            <select
              id="category-filter"
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="w-full px-3 py-2 text-sm text-slate-900 bg-slate-50 border border-slate-300 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              {categories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat === 'all' ? 'All Categories' : cat}
                </option>
              ))}
            </select>
          </div>

          <div className="lg:col-span-3 space-y-1.5">
            <label htmlFor="availability-filter" className="block text-xs font-medium text-slate-800">
              Availability
            </label>
            <select
              id="availability-filter"
              value={availabilityFilter}
              onChange={(e) => setAvailabilityFilter(e.target.value as EquipmentAvailabilityFilter)}
              className="w-full px-3 py-2 text-sm text-slate-900 bg-slate-50 border border-slate-300 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              <option value="all">All Availability</option>
              <option value="available">Available Now</option>
              <option value="instant">Instant Booking</option>
              <option value="approval">Faculty Approval Required</option>
              <option value="maintenance">Under Maintenance</option>
            </select>
          </div>

          <div className="lg:col-span-1 flex lg:justify-end">
            <button
              type="button"
              onClick={handleClearFilters}
              disabled={!hasActiveFilters}
              aria-label="Clear all search and equipment filters"
              className="w-full lg:w-auto px-3 py-2 text-xs font-medium text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap disabled:opacity-45 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
            >
              Clear filters
            </button>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span id="department-filter-label" className="text-xs font-medium text-slate-800">
              Department
            </span>
            <p
              aria-live="polite"
              className="text-xs font-mono tabular-nums text-slate-600"
            >
              Showing {filteredEquipment.length} of {equipment.length} campus resources
            </p>
          </div>

          <div
            className="flex flex-wrap items-center gap-1.5"
            role="group"
            aria-labelledby="department-filter-label"
          >
            {departments.map((dept) => {
              const active = selectedDepartment === dept;
              return (
                <button
                  key={dept}
                  type="button"
                  onClick={() => setSelectedDepartment(dept)}
                  aria-pressed={active}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                    active
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-700 border-slate-300 hover:text-slate-900 hover:border-slate-400'
                  }`}
                >
                  {dept === 'all' ? 'All Departments' : dept}
                </button>
              );
            })}
          </div>
        </div>
      </form>

      {filteredEquipment.length === 0 ? (
        <div
          role="status"
          aria-live="polite"
          className="bg-white border border-slate-200 rounded-xl p-12 text-center space-y-3"
        >
          <p className="text-base font-semibold text-slate-900">No matching lab equipment found</p>
          <p className="text-sm text-slate-600">
            No resources match your current search or department/category/availability filters.
          </p>
          <button
            type="button"
            onClick={handleClearFilters}
            className="px-4 py-2 text-sm font-medium text-blue-700 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
          >
            Clear filters
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredEquipment.map((item) => {
            const nextSlot = getNextAvailableSlotLabel(item, bookings, today);
            const statusDisplay = getStatusDisplay(item);

            return (
              <article
                key={item.id}
                className="bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col transition-colors hover:border-slate-300"
              >
                <div className="aspect-[4/3] w-full overflow-hidden border-b border-slate-200 bg-slate-100">
                  <EquipmentImage
                    src={item.imageUrl}
                    alt={`${item.name} in ${item.labLocation}`}
                    title={item.name}
                    className="w-full h-full"
                  />
                </div>

                <div className="p-5 flex-1 flex flex-col justify-between gap-4">
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-slate-600 truncate">
                        {item.department} · {item.labLocation}
                      </span>
                      <span className={`font-semibold whitespace-nowrap shrink-0 ${statusDisplay.className}`}>
                        {statusDisplay.label}
                      </span>
                    </div>

                    <div className="space-y-1">
                      <p className="text-xs font-medium text-blue-700">{item.category}</p>
                      <h2 className="text-lg font-semibold text-slate-900 leading-snug">
                        {item.name}
                      </h2>
                    </div>

                    <p className="text-sm text-slate-700 leading-relaxed line-clamp-2">
                      {item.description}
                    </p>

                    <p className="text-xs text-slate-600 leading-relaxed">
                      {item.capabilities.join(' · ')}
                    </p>
                  </div>

                  <div className="pt-4 border-t border-slate-100 space-y-3">
                    <div className="flex items-center justify-between gap-2 text-xs text-slate-700 font-mono tabular-nums">
                      <span className="inline-flex items-center gap-1.5">
                        <CalendarClock className="w-3.5 h-3.5 text-slate-600 shrink-0" aria-hidden="true" />
                        <span>Next: {nextSlot}</span>
                      </span>
                      <span className="text-slate-800 font-medium">
                        {item.availableUnits}/{item.totalUnits} units free
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => onSelectEquipment(item)}
                      aria-label={`Inspect details and book ${item.name}`}
                      className="w-full px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                    >
                      Inspect Details & Book
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
