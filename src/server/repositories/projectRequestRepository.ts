import type { ProjectAccessRequest, ProjectRequestStatus } from '../../shared/types.js';
import { getStoreState } from '../data/store.js';

export interface ProjectRequestFilters {
  equipmentId?: string;
  status?: ProjectRequestStatus;
  department?: string;
}

export interface ProjectRequestDecisionPatch {
  status: ProjectRequestStatus;
  facultyReviewer?: string;
  facultyDecisionNote?: string;
  reviewedAt: string;
  linkedBookingId?: string;
}

/**
 * Pure data-access repository for project-based access requests.
 * Contains zero workflow transition or authorization logic.
 */
function cloneRequest(item: ProjectAccessRequest): ProjectAccessRequest {
  return { ...item };
}

export function getProjectRequests(filters?: ProjectRequestFilters): ProjectAccessRequest[] {
  return getStoreState()
    .projectRequests.filter((item) => {
      if (filters?.equipmentId && item.equipmentId !== filters.equipmentId) return false;
      if (filters?.status && item.status !== filters.status) return false;
      if (filters?.department && item.department !== filters.department) return false;
      return true;
    })
    .map(cloneRequest);
}

export function getProjectRequestById(id: string): ProjectAccessRequest | undefined {
  const found = getStoreState().projectRequests.find((item) => item.id === id);
  return found ? cloneRequest(found) : undefined;
}

export function createProjectRequest(record: ProjectAccessRequest): ProjectAccessRequest {
  const stored = cloneRequest(record);
  getStoreState().projectRequests.push(stored);
  return cloneRequest(stored);
}

export function updateProjectRequestStatus(
  id: string,
  patch: ProjectRequestDecisionPatch,
): ProjectAccessRequest | undefined {
  const list = getStoreState().projectRequests;
  const index = list.findIndex((item) => item.id === id);
  if (index === -1) {
    return undefined;
  }

  const updated: ProjectAccessRequest = {
    ...list[index],
    status: patch.status,
    facultyReviewer: patch.facultyReviewer,
    facultyDecisionNote: patch.facultyDecisionNote,
    reviewedAt: patch.reviewedAt,
    ...(patch.linkedBookingId !== undefined ? { linkedBookingId: patch.linkedBookingId } : {}),
  };
  list[index] = updated;
  return cloneRequest(updated);
}
