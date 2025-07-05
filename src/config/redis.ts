import Redis from 'ioredis';
import { logger } from '../utils/logger';

export function createRedisClient(): Redis {
  const redis = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD,
    db: parseInt(process.env.REDIS_DB || '0'),
    maxRetriesPerRequest: 3,
    lazyConnect: true,
    connectTimeout: 10000,
    commandTimeout: 5000,
  });

  redis.on('connect', () => {
    logger.info('Redis client connected');
  });

  redis.on('error', (err) => {
    logger.error('Redis client error:', err);
  });

  redis.on('reconnecting', () => {
    logger.info('Redis client reconnecting');
  });

  redis.on('close', () => {
    logger.info('Redis client connection closed');
  });

  return redis;
} 