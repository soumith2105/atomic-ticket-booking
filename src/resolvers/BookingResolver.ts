import { Resolver, Query, Mutation, Arg, ID, Field, ObjectType, InputType } from 'type-graphql';
import { Service } from 'typedi';
import { Booking } from '../entities/Booking';
import { BookingService, BookingRequest } from '../services/BookingService';
import { logger } from '../utils/logger';

@InputType()
class CreateBookingInput {
  @Field(() => ID)
  eventId!: string;

  @Field(() => [ID])
  seatIds!: string[];

  @Field(() => [ID])
  lockIds!: string[];

  @Field({ nullable: true })
  paymentIntentId?: string;
}

@ObjectType()
class BookingResponse {
  @Field()
  success!: boolean;

  @Field(() => Booking, { nullable: true })
  booking?: Booking;

  @Field({ nullable: true })
  message?: string;

  @Field({ nullable: true })
  failureReason?: string;
}

@Service()
@Resolver(() => Booking)
export class BookingResolver {
  constructor(private bookingService: BookingService) {}

  @Mutation(() => BookingResponse)
  async createBooking(
    @Arg('input') input: CreateBookingInput,
    @Arg('userId', () => ID) userId: string
  ): Promise<BookingResponse> {
    try {
      const bookingRequest: BookingRequest = {
        userId,
        eventId: input.eventId,
        seatIds: input.seatIds,
        lockIds: input.lockIds,
        paymentIntentId: input.paymentIntentId
      };

      const result = await this.bookingService.createBooking(bookingRequest);

      return {
        success: result.success,
        booking: result.booking,
        message: result.message,
        failureReason: result.failureReason
      };

    } catch (error: any) {
      logger.error('Error in createBooking resolver', { error: error.message, input, userId });
      return {
        success: false,
        message: 'Failed to create booking',
        failureReason: 'SYSTEM_ERROR'
      };
    }
  }

  @Mutation(() => BookingResponse)
  async confirmBooking(
    @Arg('bookingId', () => ID) bookingId: string,
    @Arg('paymentIntentId') paymentIntentId: string
  ): Promise<BookingResponse> {
    try {
      const result = await this.bookingService.confirmBooking(bookingId, paymentIntentId);

      return {
        success: result.success,
        booking: result.booking,
        message: result.message,
        failureReason: result.failureReason
      };

    } catch (error: any) {
      logger.error('Error in confirmBooking resolver', { error: error.message, bookingId });
      return {
        success: false,
        message: 'Failed to confirm booking',
        failureReason: 'SYSTEM_ERROR'
      };
    }
  }
} 