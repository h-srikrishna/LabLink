import {
  filterEquipmentCatalog,
  validateEquipmentDiscoveryFilters,
} from '../../shared/equipmentFilter.js';
import type { Equipment, EquipmentDiscoveryFilters } from '../../shared/types.js';
import { getEquipment, getEquipmentById } from '../repositories/equipmentRepository.js';
import { AppServiceError } from './bookingWorkflowService.js';

export interface DiscoveryResult {
  equipment: Equipment[];
  total: number;
  filters: EquipmentDiscoveryFilters;
}

/**
 * Validates search/filter query parameters and executes safe discovery
 * against the equipment repository without exposing internal backing arrays.
 */
export function discoverEquipment(rawQuery: {
  q?: unknown;
  department?: unknown;
  category?: unknown;
  availability?: unknown;
}): DiscoveryResult {
  const parsed = validateEquipmentDiscoveryFilters(rawQuery);
  if (!parsed.valid || !parsed.filters) {
    throw new AppServiceError(400, 'VALIDATION_ERROR', parsed.error ?? 'Invalid discovery filters.');
  }

  const allEquipment = getEquipment();
  const filtered = filterEquipmentCatalog(allEquipment, parsed.filters);

  return {
    equipment: filtered,
    total: filtered.length,
    filters: parsed.filters,
  };
}

export function getEquipmentResourceDetails(id: string): Equipment {
  const cleanId = id.trim();
  if (!cleanId || cleanId.length > 64) {
    throw new AppServiceError(400, 'VALIDATION_ERROR', 'Valid equipment ID is required.');
  }
  const found = getEquipmentById(cleanId);
  if (!found) {
    throw new AppServiceError(404, 'NOT_FOUND', 'Equipment resource was not found.');
  }
  return found;
}
