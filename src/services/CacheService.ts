import { Service } from 'typedi';
import Redis from 'ioredis';
import { logger } from '../utils/logger';

@Service()
export class CacheService {
  private redis: Redis;
  private readonly defaultTTL = 3600; // 1 hour in seconds

  constructor() {
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
      db: parseInt(process.env.REDIS_DB || '0'),
    });
  }

  /**
   * Cache event data
   */
  async cacheEvent(eventId: string, eventData: any, ttl: number = this.defaultTTL): Promise<void> {
    try {
      const key = `event:${eventId}`;
      await this.redis.setex(key, ttl, JSON.stringify(eventData));
      logger.debug(`Cached event data: ${eventId}`);
    } catch (error: any) {
      logger.error('Error caching event data', { error: error.message, eventId });
    }
  }

  /**
   * Get cached event data
   */
  async getCachedEvent(eventId: string): Promise<any | null> {
    try {
      const key = `event:${eventId}`;
      const data = await this.redis.get(key);
      if (data) {
        logger.debug(`Cache hit for event: ${eventId}`);
        return JSON.parse(data);
      }
      logger.debug(`Cache miss for event: ${eventId}`);
      return null;
    } catch (error: any) {
      logger.error('Error getting cached event data', { error: error.message, eventId });
      return null;
    }
  }

  /**
   * Cache seat availability for an event
   */
  async cacheSeatAvailability(eventId: string, seatData: any, ttl: number = 300): Promise<void> {
    try {
      const key = `seats:${eventId}`;
      await this.redis.setex(key, ttl, JSON.stringify(seatData));
      logger.debug(`Cached seat availability: ${eventId}`);
    } catch (error: any) {
      logger.error('Error caching seat availability', { error: error.message, eventId });
    }
  }

  /**
   * Get cached seat availability
   */
  async getCachedSeatAvailability(eventId: string): Promise<any | null> {
    try {
      const key = `seats:${eventId}`;
      const data = await this.redis.get(key);
      if (data) {
        logger.debug(`Cache hit for seat availability: ${eventId}`);
        return JSON.parse(data);
      }
      logger.debug(`Cache miss for seat availability: ${eventId}`);
      return null;
    } catch (error: any) {
      logger.error('Error getting cached seat availability', { error: error.message, eventId });
      return null;
    }
  }

  /**
   * Invalidate event cache
   */
  async invalidateEventCache(eventId: string): Promise<void> {
    try {
      const key = `event:${eventId}`;
      await this.redis.del(key);
      logger.debug(`Invalidated event cache: ${eventId}`);
    } catch (error: any) {
      logger.error('Error invalidating event cache', { error: error.message, eventId });
    }
  }

  /**
   * Invalidate seat availability cache
   */
  async invalidateSeatAvailabilityCache(eventId: string): Promise<void> {
    try {
      const key = `seats:${eventId}`;
      await this.redis.del(key);
      logger.debug(`Invalidated seat availability cache: ${eventId}`);
    } catch (error: any) {
      logger.error('Error invalidating seat availability cache', { error: error.message, eventId });
    }
  }

  /**
   * Cache user session data
   */
  async cacheUserSession(sessionId: string, userData: any, ttl: number = 1800): Promise<void> {
    try {
      const key = `session:${sessionId}`;
      await this.redis.setex(key, ttl, JSON.stringify(userData));
      logger.debug(`Cached user session: ${sessionId}`);
    } catch (error: any) {
      logger.error('Error caching user session', { error: error.message, sessionId });
    }
  }

  /**
   * Get cached user session
   */
  async getCachedUserSession(sessionId: string): Promise<any | null> {
    try {
      const key = `session:${sessionId}`;
      const data = await this.redis.get(key);
      if (data) {
        return JSON.parse(data);
      }
      return null;
    } catch (error: any) {
      logger.error('Error getting cached user session', { error: error.message, sessionId });
      return null;
    }
  }

  /**
   * Increment a counter (useful for rate limiting)
   */
  async incrementCounter(key: string, ttl: number = 3600): Promise<number> {
    try {
      const count = await this.redis.incr(key);
      if (count === 1) {
        await this.redis.expire(key, ttl);
      }
      return count;
    } catch (error: any) {
      logger.error('Error incrementing counter', { error: error.message, key });
      return 0;
    }
  }

  /**
   * Set with expiration
   */
  async setex(key: string, value: string, ttl: number): Promise<void> {
    try {
      await this.redis.setex(key, ttl, value);
    } catch (error: any) {
      logger.error('Error setting cache value', { error: error.message, key });
    }
  }

  /**
   * Get value
   */
  async get(key: string): Promise<string | null> {
    try {
      return await this.redis.get(key);
    } catch (error: any) {
      logger.error('Error getting cache value', { error: error.message, key });
      return null;
    }
  }

  /**
   * Delete key
   */
  async del(key: string): Promise<void> {
    try {
      await this.redis.del(key);
    } catch (error: any) {
      logger.error('Error deleting cache key', { error: error.message, key });
    }
  }

  /**
   * Check if Redis is connected
   */
  async isConnected(): Promise<boolean> {
    try {
      await this.redis.ping();
      return true;
    } catch (error) {
      return false;
    }
  }
} 