import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, OneToMany, JoinColumn } from 'typeorm';
import { ObjectType, Field, ID, Int, Float } from 'type-graphql';
import { Venue } from './Venue';
import { Booking } from './Booking';

export enum EventStatus {
  DRAFT = 'DRAFT',
  PUBLISHED = 'PUBLISHED',
  SALES_OPEN = 'SALES_OPEN',
  SALES_CLOSED = 'SALES_CLOSED',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED'
}

@ObjectType()
@Entity('events')
export class Event {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Field()
  @Column()
  name!: string;

  @Field({ nullable: true })
  @Column('text', { nullable: true })
  description?: string;

  @Field()
  @Column()
  eventDate!: Date;

  @Field({ nullable: true })
  @Column({ nullable: true })
  eventEndDate?: Date;

  @Field(() => EventStatus)
  @Column({
    type: 'enum',
    enum: EventStatus,
    default: EventStatus.DRAFT
  })
  status!: EventStatus;

  @Field(() => Float, { nullable: true })
  @Column('decimal', { precision: 10, scale: 2, nullable: true })
  basePrice?: number;

  @Field(() => Int)
  @Column('int', { default: 0 })
  maxCapacity!: number;

  @Field(() => Int)
  @Column('int', { default: 0 })
  availableSeats!: number;

  @Field()
  @Column()
  venueId!: string;

  @Field(() => Venue)
  @ManyToOne(() => Venue, venue => venue.events, { eager: true })
  @JoinColumn({ name: 'venueId' })
  venue!: Venue;

  @Field(() => [Booking])
  @OneToMany(() => Booking, booking => booking.event)
  bookings!: Booking[];

  @Field()
  @CreateDateColumn()
  createdAt!: Date;

  @Field()
  @UpdateDateColumn()
  updatedAt!: Date;

  // Virtual fields
  @Field(() => Int)
  get soldSeats(): number {
    return this.maxCapacity - this.availableSeats;
  }

  @Field(() => Boolean)
  get isSoldOut(): boolean {
    return this.availableSeats === 0;
  }

  @Field(() => Boolean)
  get canPurchaseTickets(): boolean {
    return this.status === EventStatus.SALES_OPEN && 
           this.availableSeats > 0 && 
           new Date() < this.eventDate;
  }
} 