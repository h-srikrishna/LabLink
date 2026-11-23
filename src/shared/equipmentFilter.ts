import type {
  Equipment,
  EquipmentAvailabilityFilter,
  EquipmentDiscoveryFilters,
} from './types.js';

export const ALLOWED_AVAILABILITY_FILTERS: readonly EquipmentAvailabilityFilter[] = [
  'all',
  'available',
  'instant',
  'approval',
  'maintenance',
];

export const MAX_SEARCH_QUERY_LENGTH = 100;
export const MAX_FILTER_VALUE_LENGTH = 80;

export interface ParsedDiscoveryQueryResult {
  valid: boolean;
  filters?: EquipmentDiscoveryFilters;
  error?: string;
}

function normalizeText(value: string): string {
  // Strip control characters and collapse whitespace without regex execution of user text
  return value
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .trim()
    .toLowerCase();
}

export function validateEquipmentDiscoveryFilters(raw: {
  q?: unknown;
  department?: unknown;
  category?: unknown;
  availability?: unknown;
}): ParsedDiscoveryQueryResult {
  const fields: Array<[string, unknown, number]> = [
    ['q', raw.q, MAX_SEARCH_QUERY_LENGTH],
    ['department', raw.department, MAX_FILTER_VALUE_LENGTH],
    ['category', raw.category, MAX_FILTER_VALUE_LENGTH],
    ['availability', raw.availability, 30],
  ];

  for (const [name, val, maxLen] of fields) {
    if (val === undefined) continue;
    if (typeof val !== 'string') {
      return { valid: false, error: `Query parameter "${name}" must be a single string.` };
    }
    if (val.length > maxLen) {
      return {
        valid: false,
        error: `Query parameter "${name}" must be ${maxLen} characters or fewer.`,
      };
    }
  }

  const rawAvailability =
    typeof raw.availability === 'string' && raw.availability.trim()
      ? raw.availability.trim().toLowerCase()
      : 'all';

  if (!ALLOWED_AVAILABILITY_FILTERS.includes(rawAvailability as EquipmentAvailabilityFilter)) {
    return {
      valid: false,
      error: `Invalid availability filter. Allowed values: ${ALLOWED_AVAILABILITY_FILTERS.join(', ')}.`,
    };
  }

  const q = typeof raw.q === 'string' ? raw.q.trim() : '';
  const department = typeof raw.department === 'string' ? raw.department.trim() : 'all';
  const category = typeof raw.category === 'string' ? raw.category.trim() : 'all';

  return {
    valid: true,
    filters: {
      q,
      department: department || 'all',
      category: category || 'all',
      availability: rawAvailability as EquipmentAvailabilityFilter,
    },
  };
}

export function filterEquipmentCatalog(
  equipment: Equipment[],
  filters: EquipmentDiscoveryFilters,
): Equipment[] {
  const query = normalizeText(filters.q ?? '');
  const departmentFilter = normalizeText(filters.department ?? 'all');
  const categoryFilter = normalizeText(filters.category ?? 'all');
  const availability = filters.availability ?? 'all';

  return equipment.filter((item) => {
    if (departmentFilter && departmentFilter !== 'all') {
      if (item.department.toLowerCase() !== departmentFilter) return false;
    }

    if (categoryFilter && categoryFilter !== 'all') {
      if (item.category.toLowerCase() !== categoryFilter) return false;
    }

    if (availability === 'available') {
      if (item.status === 'maintenance' || item.availableUnits <= 0) return false;
    } else if (availability === 'instant') {
      if (item.requiresFacultyApproval || item.status === 'maintenance' || item.availableUnits <= 0) {
        return false;
      }
    } else if (availability === 'approval') {
      if (!item.requiresFacultyApproval) return false;
    } else if (availability === 'maintenance') {
      if (item.status !== 'maintenance') return false;
    }

    if (!query) return true;

    const searchableFields = [
      item.name,
      item.category,
      item.department,
      item.labLocation,
      item.description,
      ...item.capabilities,
    ];

    return searchableFields.some((field) => field.toLowerCase().includes(query));
  });
}
