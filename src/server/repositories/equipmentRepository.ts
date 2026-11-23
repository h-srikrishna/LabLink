import type { Equipment, EquipmentStatus, UpdateEquipmentInput } from '../../shared/types.js';
import { getStoreState } from '../data/store.js';

export interface EquipmentRepositoryFilters {
  department?: string;
  category?: string;
  status?: EquipmentStatus;
}

/**
 * Pure data-access repository for equipment resources.
 * Contains zero scheduling or authorization logic.
 */
function cloneEquipment(item: Equipment): Equipment {
  return {
    ...item,
    capabilities: [...item.capabilities],
  };
}

export function getEquipment(filters?: EquipmentRepositoryFilters): Equipment[] {
  return getStoreState()
    .equipment.filter((item) => {
      if (filters?.department && item.department !== filters.department) return false;
      if (filters?.category && item.category !== filters.category) return false;
      if (filters?.status && item.status !== filters.status) return false;
      return true;
    })
    .map(cloneEquipment);
}

export function getEquipmentById(id: string): Equipment | undefined {
  const found = getStoreState().equipment.find((item) => item.id === id);
  return found ? cloneEquipment(found) : undefined;
}

export function createEquipment(record: Equipment): Equipment {
  const stored = cloneEquipment(record);
  getStoreState().equipment.push(stored);
  return cloneEquipment(stored);
}

export function updateEquipment(id: string, patch: UpdateEquipmentInput): Equipment | undefined {
  const list = getStoreState().equipment;
  const index = list.findIndex((item) => item.id === id);
  if (index === -1) {
    return undefined;
  }

  const current = list[index];
  const updated: Equipment = {
    ...current,
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    ...(patch.requiresFacultyApproval !== undefined
      ? { requiresFacultyApproval: patch.requiresFacultyApproval }
      : {}),
    ...(patch.labLocation !== undefined ? { labLocation: patch.labLocation } : {}),
    ...(patch.description !== undefined ? { description: patch.description } : {}),
    ...(patch.availableUnits !== undefined ? { availableUnits: patch.availableUnits } : {}),
  };

  list[index] = updated;
  return cloneEquipment(updated);
}
