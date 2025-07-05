import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, OneToMany, JoinColumn, Index } from 'typeorm';
import { ObjectType, Field, ID, Int, Float } from 'type-graphql';
import { Venue } from './Venue';
import { BookingSeat } from './BookingSeat';

export enum SeatType {
  STANDARD = 'STANDARD',
  PREMIUM = 'PREMIUM',
  VIP = 'VIP',
  WHEELCHAIR_ACCESSIBLE = 'WHEELCHAIR_ACCESSIBLE'
}

export enum SeatStatus {
  AVAILABLE = 'AVAILABLE',
  BOOKED = 'BOOKED',
  MAINTENANCE = 'MAINTENANCE'
}

@ObjectType()
@Entity('seats')
@Index(['venueId', 'section', 'row', 'number'], { unique: true })
export class Seat {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Field()
  @Column()
  venueId!: string;

  @Field(() => Venue)
  @ManyToOne(() => Venue, venue => venue.seats)
  @JoinColumn({ name: 'venueId' })
  venue!: Venue;

  @Field()
  @Column()
  section!: string;

  @Field()
  @Column()
  row!: string;

  @Field(() => Int)
  @Column('int')
  number!: number;

  @Field(() => SeatType)
  @Column({
    type: 'enum',
    enum: SeatType,
    default: SeatType.STANDARD
  })
  type!: SeatType;

  @Field(() => SeatStatus)
  @Column({
    type: 'enum',
    enum: SeatStatus,
    default: SeatStatus.AVAILABLE
  })
  status!: SeatStatus;

  @Field(() => Float, { nullable: true })
  @Column('decimal', { precision: 10, scale: 2, nullable: true })
  priceModifier?: number;

  @Field(() => [BookingSeat])
  @OneToMany(() => BookingSeat, bookingSeat => bookingSeat.seat)
  bookingSeats!: BookingSeat[];

  @Field()
  @CreateDateColumn()
  createdAt!: Date;

  @Field()
  @UpdateDateColumn()
  updatedAt!: Date;

  // Virtual field for seat identifier
  @Field()
  get identifier(): string {
    return `${this.section}-${this.row}-${this.number}`;
  }
} 