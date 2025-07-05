import { ConnectionOptions } from 'typeorm';
import { Event } from '../entities/Event';
import { Venue } from '../entities/Venue';
import { Seat } from '../entities/Seat';
import { User } from '../entities/User';
import { Booking } from '../entities/Booking';
import { BookingSeat } from '../entities/BookingSeat';

export function createTypeOrmConfig(): ConnectionOptions {
  return {
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    username: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || 'password',
    database: process.env.DB_NAME || 'ticket_booking',
    entities: [Event, Venue, Seat, User, Booking, BookingSeat],
    migrations: ['src/database/migrations/*.ts'],
    synchronize: process.env.NODE_ENV !== 'production',
    logging: process.env.NODE_ENV === 'development',
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    extra: {
      max: 20, // Maximum number of clients in the pool
      idleTimeoutMillis: 30000, // How long a client is allowed to remain idle
      connectionTimeoutMillis: 2000, // How long to wait when connecting
    },
  };
} 