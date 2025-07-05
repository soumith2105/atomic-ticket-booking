import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { ObjectType, Field, ID, Float } from 'type-graphql';
import { Booking } from './Booking';
import { Seat } from './Seat';

@ObjectType()
@Entity('booking_seats')
export class BookingSeat {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Field()
  @Column()
  bookingId!: string;

  @Field(() => Booking)
  @ManyToOne(() => Booking, booking => booking.bookingSeats)
  @JoinColumn({ name: 'bookingId' })
  booking!: Booking;

  @Field()
  @Column()
  seatId!: string;

  @Field(() => Seat)
  @ManyToOne(() => Seat, seat => seat.bookingSeats, { eager: true })
  @JoinColumn({ name: 'seatId' })
  seat!: Seat;

  @Field(() => Float)
  @Column('decimal', { precision: 10, scale: 2 })
  priceAtBooking!: number;

  @Field()
  @CreateDateColumn()
  createdAt!: Date;
} 