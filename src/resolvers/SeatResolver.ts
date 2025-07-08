import { Resolver, Query, Mutation, Arg, ID, Field, ObjectType, InputType } from 'type-graphql';
import { Service } from 'typedi';
import { getRepository } from 'typeorm';
import { Seat, SeatStatus } from '../entities/Seat';
import { SeatLockService, LockResult } from '../services/SeatLockService';
import { CacheService } from '../services/CacheService';
import { logger } from '../utils/logger';

@ObjectType()
class SeatLockResponse {
  @Field()
  success!: boolean;

  @Field({ nullable: true })
  lockId?: string;

  @Field({ nullable: true })
  expiresAt?: number;

  @Field({ nullable: true })
  message?: string;
}

@InputType()
class LockSeatsInput {
  @Field(() => [ID])
  seatIds!: string[];

  @Field(() => ID)
  eventId!: string;

  @Field(() => ID)
  userId!: string;
}

@Service()
@Resolver(() => Seat)
export class SeatResolver {
  constructor(
    private seatLockService: SeatLockService,
    private cacheService: CacheService
  ) {}

  @Query(() => [Seat])
  async availableSeats(@Arg('eventId', () => ID) eventId: string): Promise<Seat[]> {
    try {
      // Try cache first
      const cachedSeats = await this.cacheService.getCachedSeatAvailability(eventId);
      if (cachedSeats) {
        return cachedSeats;
      }

      const seatRepository = getRepository(Seat);
      const seats = await seatRepository.find({
        where: { 
          venue: { events: { id: eventId } },
          status: SeatStatus.AVAILABLE
        },
        relations: ['venue']
      });

      // Filter out locked seats
      const availableSeats = [];
      for (const seat of seats) {
        const isLocked = await this.seatLockService.isLocked(seat.id);
        if (!isLocked) {
          availableSeats.push(seat);
        }
      }

      // Cache for 5 minutes
      await this.cacheService.cacheSeatAvailability(eventId, availableSeats, 300);

      return availableSeats;

    } catch (error: any) {
      logger.error('Error retrieving available seats', { error: error.message, eventId });
      throw new Error('Failed to retrieve available seats');
    }
  }

  @Mutation(() => SeatLockResponse)
  async lockSeat(
    @Arg('seatId', () => ID) seatId: string,
    @Arg('eventId', () => ID) eventId: string,
    @Arg('userId', () => ID) userId: string
  ): Promise<SeatLockResponse> {
    try {
      const result = await this.seatLockService.acquireLock(seatId, eventId, userId);
      
      // Invalidate seat availability cache
      await this.cacheService.invalidateSeatAvailabilityCache(eventId);

      return {
        success: result.success,
        lockId: result.lockId,
        expiresAt: result.expiresAt,
        message: result.message
      };

    } catch (error: any) {
      logger.error('Error locking seat', { error: error.message, seatId, eventId, userId });
      return {
        success: false,
        message: 'Failed to lock seat due to system error'
      };
    }
  }

  @Mutation(() => SeatLockResponse)
  async extendSeatLock(
    @Arg('seatId', () => ID) seatId: string,
    @Arg('eventId', () => ID) eventId: string,
    @Arg('userId', () => ID) userId: string,
    @Arg('lockId', () => ID) lockId: string
  ): Promise<SeatLockResponse> {
    try {
      const result = await this.seatLockService.extendLock(seatId, eventId, userId, lockId);

      return {
        success: result.success,
        lockId: result.lockId,
        expiresAt: result.expiresAt,
        message: result.message
      };

    } catch (error: any) {
      logger.error('Error extending seat lock', { error: error.message, seatId, lockId });
      return {
        success: false,
        message: 'Failed to extend lock due to system error'
      };
    }
  }

  @Mutation(() => Boolean)
  async releaseSeatLock(
    @Arg('seatId', () => ID) seatId: string,
    @Arg('eventId', () => ID) eventId: string,
    @Arg('userId', () => ID) userId: string,
    @Arg('lockId', () => ID) lockId: string
  ): Promise<boolean> {
    try {
      const result = await this.seatLockService.releaseLock(seatId, eventId, userId, lockId);
      
      // Invalidate seat availability cache
      await this.cacheService.invalidateSeatAvailabilityCache(eventId);

      return result;

    } catch (error: any) {
      logger.error('Error releasing seat lock', { error: error.message, seatId, lockId });
      return false;
    }
  }
} 