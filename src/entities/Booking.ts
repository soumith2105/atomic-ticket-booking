import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, OneToMany, JoinColumn } from 'typeorm';
import { ObjectType, Field, ID, Float } from 'type-graphql';
import { User } from './User';
import { Event } from './Event';
import { BookingSeat } from './BookingSeat';

export enum BookingStatus {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  CANCELLED = 'CANCELLED',
  REFUNDED = 'REFUNDED'
}

@ObjectType()
@Entity('bookings')
export class Booking {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Field()
  @Column()
  userId!: string;

  @Field(() => User)
  @ManyToOne(() => User, user => user.bookings, { eager: true })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Field()
  @Column()
  eventId!: string;

  @Field(() => Event)
  @ManyToOne(() => Event, event => event.bookings, { eager: true })
  @JoinColumn({ name: 'eventId' })
  event!: Event;

  @Field(() => Float)
  @Column('decimal', { precision: 10, scale: 2 })
  totalPrice!: number;

  @Field(() => BookingStatus)
  @Column({
    type: 'enum',
    enum: BookingStatus,
    default: BookingStatus.PENDING
  })
  status!: BookingStatus;

  @Field({ nullable: true })
  @Column({ nullable: true })
  paymentIntentId?: string;

  @Field()
  @Column()
  bookingDate!: Date;

  @Field({ nullable: true })
  @Column({ nullable: true })
  confirmedAt?: Date;

  @Field({ nullable: true })
  @Column({ nullable: true })
  cancelledAt?: Date;

  @Field({ nullable: true })
  @Column('text', { nullable: true })
  cancellationReason?: string;

  @Field(() => [BookingSeat])
  @OneToMany(() => BookingSeat, bookingSeat => bookingSeat.booking)
  bookingSeats!: BookingSeat[];

  @Field()
  @CreateDateColumn()
  createdAt!: Date;

  @Field()
  @UpdateDateColumn()
  updatedAt!: Date;

  // Virtual fields
  @Field()
  get bookingReference(): string {
    return `TB-${this.id.substr(0, 8).toUpperCase()}`;
  }

  @Field()
  get isActive(): boolean {
    return this.status === BookingStatus.CONFIRMED;
  }
} 