import type { Booking, Equipment, ProjectAccessRequest } from '../../shared/types.js';
import { createSeedDataset } from './seedData.js';

/**
 * DEMO / EPHEMERAL STORE NOTICE (Cloud Run Readiness):
 * This in-memory store holds seeded demo state for the 3-hour hackathon MVP.
 * It is strictly EPHEMERAL: Cloud Run container instances are stateless and may
 * restart, scale to zero, or scale horizontally, so in-memory mutations are NOT
 * durable across container restarts and the app never relies on writable local disk.
 *
 * All reads and writes go through the repository modules (`src/server/repositories/*`),
 * allowing a persistent database (e.g. Cloud SQL or Firestore) to replace this
 * store later without rewriting business logic or UI components.
 */
export interface EphemeralStoreState {
  equipment: Equipment[];
  bookings: Booking[];
  projectRequests: ProjectAccessRequest[];
}

function cloneDataset(): EphemeralStoreState {
  const seed = createSeedDataset();
  return {
    equipment: seed.equipment.map((item) => ({ ...item, capabilities: [...item.capabilities] })),
    bookings: seed.bookings.map((item) => ({ ...item })),
    projectRequests: seed.projectRequests.map((item) => ({ ...item })),
  };
}

let storeState: EphemeralStoreState = cloneDataset();

export function getStoreState(): EphemeralStoreState {
  return storeState;
}

export function resetDemoStore(): EphemeralStoreState {
  storeState = cloneDataset();
  return storeState;
}
