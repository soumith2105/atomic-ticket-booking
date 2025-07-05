import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToMany } from 'typeorm';
import { ObjectType, Field, ID, Int } from 'type-graphql';
import { Event } from './Event';
import { Seat } from './Seat';

@ObjectType()
@Entity('venues')
export class Venue {
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
  address!: string;

  @Field()
  @Column()
  city!: string;

  @Field()
  @Column()
  state!: string;

  @Field()
  @Column()
  zipCode!: string;

  @Field()
  @Column()
  country!: string;

  @Field(() => Int)
  @Column('int')
  totalCapacity!: number;

  @Field(() => [Event])
  @OneToMany(() => Event, event => event.venue)
  events!: Event[];

  @Field(() => [Seat])
  @OneToMany(() => Seat, seat => seat.venue)
  seats!: Seat[];

  @Field()
  @CreateDateColumn()
  createdAt!: Date;

  @Field()
  @UpdateDateColumn()
  updatedAt!: Date;
} 