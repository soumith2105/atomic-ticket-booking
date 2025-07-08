import { getConnection, QueryRunner } from 'typeorm';
import { Service } from 'typedi';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';
import { SeatLockService } from './SeatLockService';
import { CacheService } from './CacheService';
import { Booking } from '../entities/Booking';
import { BookingSeat } from '../entities/BookingSeat';
import { Event } from '../entities/Event';
import { Seat, SeatStatus } from '../entities/Seat';
import { User } from '../entities/User';

export interface BookingRequest {
  userId: string;
  eventId: string;
  seatIds: string[];
  lockIds: string[];
  paymentIntentId?: string;
}

export interface BookingResult {
  success: boolean;
  booking?: Booking;
  message?: string;
  failureReason?: string;
}

export enum BookingStatus {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  CANCELLED = 'CANCELLED',
  REFUNDED = 'REFUNDED'
}

@Service()
export class BookingService {
  constructor(
    private seatLockService: SeatLockService,
    private cacheService: CacheService
  ) {}

  /**
   * Creates a booking atomically by converting seat locks to permanent reservations
   * This is the critical method that prevents double-booking
   */
  async createBooking(request: BookingRequest): Promise<BookingResult> {
    const { userId, eventId, seatIds, lockIds, paymentIntentId } = request;
    
    // Validate that we have matching seat IDs and lock IDs
    if (seatIds.length !== lockIds.length) {
      return {
        success: false,
        message: 'Mismatch between seat IDs and lock IDs',
        failureReason: 'INVALID_REQUEST'
      };
    }

    let queryRunner: QueryRunner | null = null;

    try {
      // Start database transaction
      const connection = getConnection();
      queryRunner = connection.createQueryRunner();
      await queryRunner.connect();
      await queryRunner.startTransaction();

      // 1. Validate all seat locks belong to the user and are still valid
      const validationResult = await this.validateSeatLocks(userId, eventId, seatIds, lockIds);
      if (!validationResult.success) {
        await queryRunner.rollbackTransaction();
        return validationResult;
      }

      // 2. Get event and seat information
      const event = await queryRunner.manager.findOne(Event, { 
        where: { id: eventId },
        relations: ['venue']
      });

      if (!event) {
        await queryRunner.rollbackTransaction();
        return {
          success: false,
          message: 'Event not found',
          failureReason: 'EVENT_NOT_FOUND'
        };
      }

      if (!event.canPurchaseTickets) {
        await queryRunner.rollbackTransaction();
        return {
          success: false,
          message: 'Tickets are not available for purchase',
          failureReason: 'SALES_CLOSED'
        };
      }

      // 3. Get seat details and calculate total price
      const seats = await queryRunner.manager.findByIds(Seat, seatIds);
      if (seats.length !== seatIds.length) {
        await queryRunner.rollbackTransaction();
        return {
          success: false,
          message: 'Some seats not found',
          failureReason: 'SEATS_NOT_FOUND'
        };
      }

      const totalPrice = this.calculateTotalPrice(event, seats);

      // 4. Create booking record
      const booking = new Booking();
      booking.id = uuidv4();
      booking.userId = userId;
      booking.eventId = eventId;
      booking.totalPrice = totalPrice;
      booking.status = BookingStatus.PENDING;
      booking.paymentIntentId = paymentIntentId;
      booking.bookingDate = new Date();

      await queryRunner.manager.save(booking);

      // 5. Create booking seat records
      const bookingSeats: BookingSeat[] = [];
      for (let i = 0; i < seats.length; i++) {
        const seat = seats[i];
        const bookingSeat = new BookingSeat();
        bookingSeat.id = uuidv4();
        bookingSeat.bookingId = booking.id;
        bookingSeat.seatId = seat.id;
        bookingSeat.priceAtBooking = this.calculateSeatPrice(event, seat);

        bookingSeats.push(bookingSeat);
      }

      await queryRunner.manager.save(bookingSeats);

      // 6. Update event availability (this is crucial for preventing overselling)
      await queryRunner.manager.update(Event, eventId, {
        availableSeats: () => `available_seats - ${seatIds.length}`
      });

      // 7. Update seat status to booked
      await queryRunner.manager.update(Seat, seatIds, {
        status: SeatStatus.BOOKED
      });

      // Commit the transaction first
      await queryRunner.commitTransaction();

      // 8. After successful commit, release the DynamoDB locks
      const lockReleasePromises = seatIds.map((seatId, index) => 
        this.seatLockService.releaseLock(seatId, eventId, userId, lockIds[index])
      );
      
      await Promise.allSettled(lockReleasePromises);

      // 9. Invalidate cache
      await this.cacheService.invalidateEventCache(eventId);
      await this.cacheService.invalidateSeatAvailabilityCache(eventId);

      // Load the full booking with relations for return
      const fullBooking = await connection.manager.findOne(Booking, {
        where: { id: booking.id },
        relations: ['user', 'event', 'bookingSeats', 'bookingSeats.seat']
      });

      logger.info(`Booking created successfully: ${booking.id}`, {
        bookingId: booking.id,
        userId,
        eventId,
        seatCount: seatIds.length,
        totalPrice
      });

      return {
        success: true,
        booking: fullBooking!,
        message: 'Booking created successfully'
      };

    } catch (error: any) {
      // Rollback transaction if it's still active
      if (queryRunner && queryRunner.isTransactionActive) {
        await queryRunner.rollbackTransaction();
      }

      logger.error('Error creating booking', {
        error: error.message,
        stack: error.stack,
        userId,
        eventId,
        seatIds
      });

      return {
        success: false,
        message: 'Failed to create booking due to system error',
        failureReason: 'SYSTEM_ERROR'
      };

    } finally {
      // Always release the query runner
      if (queryRunner) {
        await queryRunner.release();
      }
    }
  }

  /**
   * Validates that all seat locks are owned by the user and are still valid
   */
  private async validateSeatLocks(
    userId: string, 
    eventId: string, 
    seatIds: string[], 
    lockIds: string[]
  ): Promise<BookingResult> {
    const validationPromises = seatIds.map((seatId, index) => 
      this.seatLockService.validateLock(seatId, userId, lockIds[index])
    );

    const validationResults = await Promise.all(validationPromises);
    const invalidLocks = validationResults.some(result => !result);

    if (invalidLocks) {
      logger.warn('Seat lock validation failed', {
        userId,
        eventId,
        seatIds,
        lockIds
      });

      return {
        success: false,
        message: 'One or more seat locks are invalid or have expired',
        failureReason: 'INVALID_LOCKS'
      };
    }

    return { success: true };
  }

  /**
   * Calculates the total price for a booking
   */
  private calculateTotalPrice(event: Event, seats: Seat[]): number {
    const basePrice = event.basePrice || 0;
    
    return seats.reduce((total, seat) => {
      const seatPrice = this.calculateSeatPrice(event, seat);
      return total + seatPrice;
    }, 0);
  }

  /**
   * Calculates the price for a specific seat
   */
  private calculateSeatPrice(event: Event, seat: Seat): number {
    const basePrice = event.basePrice || 0;
    const priceModifier = seat.priceModifier || 1;
    
    return basePrice * priceModifier;
  }

  /**
   * Confirms a booking after payment is successful
   */
  async confirmBooking(bookingId: string, paymentIntentId: string): Promise<BookingResult> {
    try {
      const connection = getConnection();
      const booking = await connection.manager.findOne(Booking, {
        where: { id: bookingId, paymentIntentId },
        relations: ['event', 'bookingSeats']
      });

      if (!booking) {
        return {
          success: false,
          message: 'Booking not found or payment intent mismatch',
          failureReason: 'BOOKING_NOT_FOUND'
        };
      }

      if (booking.status !== BookingStatus.PENDING) {
        return {
          success: false,
          message: 'Booking is not in pending status',
          failureReason: 'INVALID_STATUS'
        };
      }

      // Update booking status
      await connection.manager.update(Booking, bookingId, {
        status: BookingStatus.CONFIRMED,
        confirmedAt: new Date()
      });

      logger.info(`Booking confirmed: ${bookingId}`, {
        bookingId,
        paymentIntentId,
        userId: booking.userId,
        eventId: booking.eventId
      });

      const confirmedBooking = await connection.manager.findOne(Booking, {
        where: { id: bookingId },
        relations: ['user', 'event', 'bookingSeats', 'bookingSeats.seat']
      });

      return {
        success: true,
        booking: confirmedBooking!,
        message: 'Booking confirmed successfully'
      };

    } catch (error: any) {
      logger.error('Error confirming booking', {
        error: error.message,
        bookingId,
        paymentIntentId
      });

      return {
        success: false,
        message: 'Failed to confirm booking',
        failureReason: 'SYSTEM_ERROR'
      };
    }
  }

  /**
   * Cancels a booking and releases the seats
   */
  async cancelBooking(bookingId: string, userId: string, reason?: string): Promise<BookingResult> {
    let queryRunner: QueryRunner | null = null;

    try {
      const connection = getConnection();
      queryRunner = connection.createQueryRunner();
      await queryRunner.connect();
      await queryRunner.startTransaction();

      const booking = await queryRunner.manager.findOne(Booking, {
        where: { id: bookingId, userId },
        relations: ['event', 'bookingSeats']
      });

      if (!booking) {
        await queryRunner.rollbackTransaction();
        return {
          success: false,
          message: 'Booking not found or unauthorized',
          failureReason: 'BOOKING_NOT_FOUND'
        };
      }

      if (booking.status === BookingStatus.CANCELLED) {
        await queryRunner.rollbackTransaction();
        return {
          success: false,
          message: 'Booking is already cancelled',
          failureReason: 'ALREADY_CANCELLED'
        };
      }

      // Update booking status
      await queryRunner.manager.update(Booking, bookingId, {
        status: BookingStatus.CANCELLED,
        cancelledAt: new Date(),
        cancellationReason: reason
      });

      // Release seats and update event availability
      const seatIds = booking.bookingSeats.map(bs => bs.seatId);
      
      await queryRunner.manager.update(Seat, seatIds, {
        status: SeatStatus.AVAILABLE
      });

      await queryRunner.manager.update(Event, booking.eventId, {
        availableSeats: () => `available_seats + ${seatIds.length}`
      });

      await queryRunner.commitTransaction();

      // Invalidate cache
      await this.cacheService.invalidateEventCache(booking.eventId);
      await this.cacheService.invalidateSeatAvailabilityCache(booking.eventId);

      logger.info(`Booking cancelled: ${bookingId}`, {
        bookingId,
        userId,
        eventId: booking.eventId,
        reason
      });

      return {
        success: true,
        message: 'Booking cancelled successfully'
      };

    } catch (error: any) {
      if (queryRunner && queryRunner.isTransactionActive) {
        await queryRunner.rollbackTransaction();
      }

      logger.error('Error cancelling booking', {
        error: error.message,
        bookingId,
        userId
      });

      return {
        success: false,
        message: 'Failed to cancel booking',
        failureReason: 'SYSTEM_ERROR'
      };

    } finally {
      if (queryRunner) {
        await queryRunner.release();
      }
    }
  }
} 