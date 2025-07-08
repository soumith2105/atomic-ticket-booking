import { Resolver, Query, Mutation, Arg, ID, Int, Field, ObjectType, InputType } from 'type-graphql';
import { Service } from 'typedi';
import { getRepository } from 'typeorm';
import { Event, EventStatus } from '../entities/Event';
import { Venue } from '../entities/Venue';
import { CacheService } from '../services/CacheService';
import { logger } from '../utils/logger';

@InputType()
class CreateEventInput {
  @Field()
  name: string;

  @Field({ nullable: true })
  description?: string;

  @Field()
  eventDate: Date;

  @Field({ nullable: true })
  eventEndDate?: Date;

  @Field()
  venueId: string;

  @Field({ nullable: true })
  basePrice?: number;

  @Field(() => Int)
  maxCapacity: number;
}

@InputType()
class UpdateEventInput {
  @Field({ nullable: true })
  name?: string;

  @Field({ nullable: true })
  description?: string;

  @Field({ nullable: true })
  eventDate?: Date;

  @Field({ nullable: true })
  eventEndDate?: Date;

  @Field({ nullable: true })
  basePrice?: number;

  @Field(() => EventStatus, { nullable: true })
  status?: EventStatus;
}

@ObjectType()
class EventsResponse {
  @Field(() => [Event])
  events: Event[];

  @Field(() => Int)
  total: number;

  @Field(() => Int)
  page: number;

  @Field(() => Int)
  limit: number;
}

@Service()
@Resolver(() => Event)
export class EventResolver {
  constructor(private cacheService: CacheService) {}

  @Query(() => [Event])
  async events(
    @Arg('limit', () => Int, { defaultValue: 10 }) limit: number,
    @Arg('offset', () => Int, { defaultValue: 0 }) offset: number,
    @Arg('status', () => EventStatus, { nullable: true }) status?: EventStatus
  ): Promise<Event[]> {
    try {
      const eventRepository = getRepository(Event);
      
      const queryBuilder = eventRepository.createQueryBuilder('event')
        .leftJoinAndSelect('event.venue', 'venue')
        .orderBy('event.eventDate', 'ASC')
        .limit(limit)
        .offset(offset);

      if (status) {
        queryBuilder.where('event.status = :status', { status });
      }

      const events = await queryBuilder.getMany();

      // Cache the results
      for (const event of events) {
        await this.cacheService.cacheEvent(event.id, event, 1800); // 30 minutes
      }

      logger.info(`Retrieved ${events.length} events`, { limit, offset, status });
      return events;

    } catch (error: any) {
      logger.error('Error retrieving events', { error: error.message, limit, offset, status });
      throw new Error('Failed to retrieve events');
    }
  }

  @Query(() => Event, { nullable: true })
  async event(@Arg('id', () => ID) id: string): Promise<Event | null> {
    try {
      // Try cache first
      const cachedEvent = await this.cacheService.getCachedEvent(id);
      if (cachedEvent) {
        return cachedEvent;
      }

      const eventRepository = getRepository(Event);
      const event = await eventRepository.findOne({
        where: { id },
        relations: ['venue', 'bookings']
      });

      if (event) {
        // Cache for 30 minutes
        await this.cacheService.cacheEvent(id, event, 1800);
      }

      return event || null;

    } catch (error: any) {
      logger.error('Error retrieving event', { error: error.message, eventId: id });
      throw new Error('Failed to retrieve event');
    }
  }

  @Query(() => EventsResponse)
  async searchEvents(
    @Arg('query', { nullable: true }) query?: string,
    @Arg('venueId', () => ID, { nullable: true }) venueId?: string,
    @Arg('startDate', { nullable: true }) startDate?: Date,
    @Arg('endDate', { nullable: true }) endDate?: Date,
    @Arg('page', () => Int, { defaultValue: 1, nullable: true }) page?: number,
    @Arg('limit', () => Int, { defaultValue: 10, nullable: true }) limit?: number
  ): Promise<EventsResponse> {
    try {
      const eventRepository = getRepository(Event);
      const offset = ((page || 1) - 1) * (limit || 10);

      const queryBuilder = eventRepository.createQueryBuilder('event')
        .leftJoinAndSelect('event.venue', 'venue')
        .where('event.status IN (:...statuses)', { 
          statuses: [EventStatus.PUBLISHED, EventStatus.SALES_OPEN] 
        });

      if (query) {
        queryBuilder.andWhere(
          '(LOWER(event.name) LIKE LOWER(:query) OR LOWER(event.description) LIKE LOWER(:query))',
          { query: `%${query}%` }
        );
      }

      if (venueId) {
        queryBuilder.andWhere('event.venueId = :venueId', { venueId });
      }

      if (startDate) {
        queryBuilder.andWhere('event.eventDate >= :startDate', { startDate });
      }

      if (endDate) {
        queryBuilder.andWhere('event.eventDate <= :endDate', { endDate });
      }

      const [events, total] = await queryBuilder
        .orderBy('event.eventDate', 'ASC')
        .limit(limit || 10)
        .offset(offset)
        .getManyAndCount();

      return {
        events,
        total,
        page: page || 1,
        limit: limit || 10
      };

    } catch (error: any) {
      logger.error('Error searching events', { error: error.message, query, venueId });
      throw new Error('Failed to search events');
    }
  }

  @Mutation(() => Event)
  async createEvent(@Arg('input') input: CreateEventInput): Promise<Event> {
    try {
      const eventRepository = getRepository(Event);
      const venueRepository = getRepository(Venue);

      // Verify venue exists
      const venue = await venueRepository.findOne({ where: { id: input.venueId } });
      if (!venue) {
        throw new Error('Venue not found');
      }

      // Validate capacity doesn't exceed venue capacity
      if (input.maxCapacity > venue.totalCapacity) {
        throw new Error('Event capacity exceeds venue capacity');
      }

      const event = eventRepository.create({
        ...input,
        availableSeats: input.maxCapacity,
        status: EventStatus.DRAFT
      });

      const savedEvent = await eventRepository.save(event);

      logger.info(`Event created: ${savedEvent.id}`, {
        eventId: savedEvent.id,
        name: savedEvent.name,
        venueId: input.venueId
      });

      return savedEvent;

    } catch (error: any) {
      logger.error('Error creating event', { error: error.message, input });
      throw new Error(error.message || 'Failed to create event');
    }
  }

  @Mutation(() => Event)
  async updateEvent(
    @Arg('id', () => ID) id: string,
    @Arg('input') input: UpdateEventInput
  ): Promise<Event> {
    try {
      const eventRepository = getRepository(Event);
      
      const event = await eventRepository.findOne({ where: { id } });
      if (!event) {
        throw new Error('Event not found');
      }

      // Update fields
      Object.assign(event, input);

      const updatedEvent = await eventRepository.save(event);

      // Invalidate cache
      await this.cacheService.invalidateEventCache(id);

      logger.info(`Event updated: ${id}`, { eventId: id, changes: input });

      return updatedEvent;

    } catch (error: any) {
      logger.error('Error updating event', { error: error.message, eventId: id, input });
      throw new Error(error.message || 'Failed to update event');
    }
  }

  @Mutation(() => Boolean)
  async deleteEvent(@Arg('id', () => ID) id: string): Promise<boolean> {
    try {
      const eventRepository = getRepository(Event);
      
      const event = await eventRepository.findOne({ 
        where: { id },
        relations: ['bookings']
      });

      if (!event) {
        throw new Error('Event not found');
      }

      // Don't allow deletion if there are confirmed bookings
      const hasConfirmedBookings = event.bookings.some(
        booking => booking.status === 'CONFIRMED'
      );

      if (hasConfirmedBookings) {
        throw new Error('Cannot delete event with confirmed bookings');
      }

      await eventRepository.remove(event);

      // Invalidate cache
      await this.cacheService.invalidateEventCache(id);

      logger.info(`Event deleted: ${id}`, { eventId: id });

      return true;

    } catch (error: any) {
      logger.error('Error deleting event', { error: error.message, eventId: id });
      throw new Error(error.message || 'Failed to delete event');
    }
  }

  @Mutation(() => Event)
  async publishEvent(@Arg('id', () => ID) id: string): Promise<Event> {
    try {
      const eventRepository = getRepository(Event);
      
      const event = await eventRepository.findOne({ where: { id } });
      if (!event) {
        throw new Error('Event not found');
      }

      if (event.status !== EventStatus.DRAFT) {
        throw new Error('Only draft events can be published');
      }

      event.status = EventStatus.PUBLISHED;
      const updatedEvent = await eventRepository.save(event);

      // Invalidate cache
      await this.cacheService.invalidateEventCache(id);

      logger.info(`Event published: ${id}`, { eventId: id });

      return updatedEvent;

    } catch (error: any) {
      logger.error('Error publishing event', { error: error.message, eventId: id });
      throw new Error(error.message || 'Failed to publish event');
    }
  }

  @Mutation(() => Event)
  async openSales(@Arg('id', () => ID) id: string): Promise<Event> {
    try {
      const eventRepository = getRepository(Event);
      
      const event = await eventRepository.findOne({ where: { id } });
      if (!event) {
        throw new Error('Event not found');
      }

      if (event.status !== EventStatus.PUBLISHED) {
        throw new Error('Event must be published before opening sales');
      }

      event.status = EventStatus.SALES_OPEN;
      const updatedEvent = await eventRepository.save(event);

      // Invalidate cache
      await this.cacheService.invalidateEventCache(id);

      logger.info(`Sales opened for event: ${id}`, { eventId: id });

      return updatedEvent;

    } catch (error: any) {
      logger.error('Error opening sales for event', { error: error.message, eventId: id });
      throw new Error(error.message || 'Failed to open sales');
    }
  }
} 