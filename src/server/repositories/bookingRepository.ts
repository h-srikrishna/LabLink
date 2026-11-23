import type { Booking, BookingStatus } from '../../shared/types.js';
import { getStoreState } from '../data/store.js';

export interface BookingFilters {
  equipmentId?: string;
  date?: string;
  status?: BookingStatus;
}

/**
 * Pure data-access repository for booking records.
 * Contains zero overlap detection or business validation.
 */
function cloneBooking(item: Booking): Booking {
  return { ...item };
}

export function getBookings(filters?: BookingFilters): Booking[] {
  return getStoreState()
    .bookings.filter((item) => {
      if (filters?.equipmentId && item.equipmentId !== filters.equipmentId) return false;
      if (filters?.date && item.date !== filters.date) return false;
      if (filters?.status && item.status !== filters.status) return false;
      return true;
    })
    .map(cloneBooking);
}

export function getBookingById(id: string): Booking | undefined {
  const found = getStoreState().bookings.find((item) => item.id === id);
  return found ? cloneBooking(found) : undefined;
}

export function createBooking(record: Booking): Booking {
  const stored = cloneBooking(record);
  getStoreState().bookings.push(stored);
  return cloneBooking(stored);
}

export function updateBookingStatus(id: string, status: BookingStatus): Booking | undefined {
  const list = getStoreState().bookings;
  const index = list.findIndex((item) => item.id === id);
  if (index === -1) {
    return undefined;
  }

  const updated: Booking = {
    ...list[index],
    status,
  };
  list[index] = updated;
  return cloneBooking(updated);
}
