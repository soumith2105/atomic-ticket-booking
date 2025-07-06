import AWS from 'aws-sdk';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';

export interface SeatLock {
  seatId: string;
  eventId: string;
  userId: string;
  lockId: string;
  expiresAt: number;
  createdAt: number;
}

export interface LockResult {
  success: boolean;
  lockId?: string;
  expiresAt?: number;
  message?: string;
}

export class SeatLockService {
  private dynamoDB: AWS.DynamoDB.DocumentClient;
  private tableName: string;
  private lockDurationMs: number;

  constructor() {
    this.dynamoDB = new AWS.DynamoDB.DocumentClient({
      region: process.env.AWS_REGION || 'us-east-1',
      ...(process.env.NODE_ENV === 'development' && {
        endpoint: 'http://localhost:8000', // For local DynamoDB
        accessKeyId: 'dummy',
        secretAccessKey: 'dummy'
      })
    });
    
    this.tableName = process.env.DYNAMODB_SEAT_LOCKS_TABLE || 'seat-locks';
    this.lockDurationMs = parseInt(process.env.SEAT_LOCK_DURATION_MS || '300000'); // 5 minutes default
  }

  /**
   * Attempts to acquire a lock on a specific seat for an event
   * Uses DynamoDB conditional write to ensure atomicity
   */
  async acquireLock(seatId: string, eventId: string, userId: string): Promise<LockResult> {
    const lockId = uuidv4();
    const now = Date.now();
    const expiresAt = now + this.lockDurationMs;

    const seatLock: SeatLock = {
      seatId,
      eventId,
      userId,
      lockId,
      expiresAt,
      createdAt: now
    };

    try {
      // Use conditional write to ensure the seat is not already locked
      // This prevents race conditions in high-concurrency scenarios
      await this.dynamoDB.put({
        TableName: this.tableName,
        Item: seatLock,
        ConditionExpression: 'attribute_not_exists(seatId) OR expiresAt < :now',
        ExpressionAttributeValues: {
          ':now': now
        }
      }).promise();

      logger.info(`Seat lock acquired: ${seatId} for user ${userId}`, { 
        seatId, 
        eventId, 
        userId, 
        lockId,
        expiresAt: new Date(expiresAt).toISOString()
      });

      return {
        success: true,
        lockId,
        expiresAt,
        message: 'Seat locked successfully'
      };

    } catch (error: any) {
      if (error.code === 'ConditionalCheckFailedException') {
        logger.warn(`Seat lock failed - seat already locked: ${seatId}`, { 
          seatId, 
          eventId, 
          userId 
        });
        
        return {
          success: false,
          message: 'Seat is already locked by another user'
        };
      }

      logger.error('Error acquiring seat lock', { 
        error: error.message, 
        seatId, 
        eventId, 
        userId 
      });
      
      return {
        success: false,
        message: 'Failed to acquire seat lock due to system error'
      };
    }
  }

  /**
   * Extends an existing lock if the user owns it
   */
  async extendLock(seatId: string, eventId: string, userId: string, lockId: string): Promise<LockResult> {
    const now = Date.now();
    const newExpiresAt = now + this.lockDurationMs;

    try {
      await this.dynamoDB.update({
        TableName: this.tableName,
        Key: { seatId },
        UpdateExpression: 'SET expiresAt = :newExpiresAt',
        ConditionExpression: 'userId = :userId AND lockId = :lockId AND expiresAt > :now',
        ExpressionAttributeValues: {
          ':userId': userId,
          ':lockId': lockId,
          ':newExpiresAt': newExpiresAt,
          ':now': now
        }
      }).promise();

      logger.info(`Seat lock extended: ${seatId} for user ${userId}`, { 
        seatId, 
        eventId, 
        userId, 
        lockId,
        newExpiresAt: new Date(newExpiresAt).toISOString()
      });

      return {
        success: true,
        lockId,
        expiresAt: newExpiresAt,
        message: 'Lock extended successfully'
      };

    } catch (error: any) {
      if (error.code === 'ConditionalCheckFailedException') {
        return {
          success: false,
          message: 'Cannot extend lock - invalid lock or lock expired'
        };
      }

      logger.error('Error extending seat lock', { 
        error: error.message, 
        seatId, 
        eventId, 
        userId, 
        lockId 
      });
      
      return {
        success: false,
        message: 'Failed to extend lock due to system error'
      };
    }
  }

  /**
   * Releases a lock if the user owns it
   */
  async releaseLock(seatId: string, eventId: string, userId: string, lockId: string): Promise<boolean> {
    try {
      await this.dynamoDB.delete({
        TableName: this.tableName,
        Key: { seatId },
        ConditionExpression: 'userId = :userId AND lockId = :lockId',
        ExpressionAttributeValues: {
          ':userId': userId,
          ':lockId': lockId
        }
      }).promise();

      logger.info(`Seat lock released: ${seatId} by user ${userId}`, { 
        seatId, 
        eventId, 
        userId, 
        lockId 
      });

      return true;

    } catch (error: any) {
      if (error.code === 'ConditionalCheckFailedException') {
        logger.warn(`Cannot release lock - user doesn't own the lock: ${seatId}`, { 
          seatId, 
          eventId, 
          userId, 
          lockId 
        });
        return false;
      }

      logger.error('Error releasing seat lock', { 
        error: error.message, 
        seatId, 
        eventId, 
        userId, 
        lockId 
      });
      
      return false;
    }
  }

  /**
   * Checks if a seat is currently locked
   */
  async isLocked(seatId: string): Promise<boolean> {
    try {
      const result = await this.dynamoDB.get({
        TableName: this.tableName,
        Key: { seatId }
      }).promise();

      if (!result.Item) {
        return false;
      }

      const lock = result.Item as SeatLock;
      const now = Date.now();
      
      return lock.expiresAt > now;

    } catch (error: any) {
      logger.error('Error checking seat lock status', { 
        error: error.message, 
        seatId 
      });
      
      // In case of error, assume seat is locked for safety
      return true;
    }
  }

  /**
   * Gets lock information for a seat
   */
  async getLockInfo(seatId: string): Promise<SeatLock | null> {
    try {
      const result = await this.dynamoDB.get({
        TableName: this.tableName,
        Key: { seatId }
      }).promise();

      if (!result.Item) {
        return null;
      }

      const lock = result.Item as SeatLock;
      const now = Date.now();
      
      // Return lock info only if it's still valid
      return lock.expiresAt > now ? lock : null;

    } catch (error: any) {
      logger.error('Error getting seat lock info', { 
        error: error.message, 
        seatId 
      });
      
      return null;
    }
  }

  /**
   * Validates that a user owns a specific lock
   */
  async validateLock(seatId: string, userId: string, lockId: string): Promise<boolean> {
    try {
      const lockInfo = await this.getLockInfo(seatId);
      
      if (!lockInfo) {
        return false;
      }

      return lockInfo.userId === userId && lockInfo.lockId === lockId;

    } catch (error: any) {
      logger.error('Error validating seat lock', { 
        error: error.message, 
        seatId, 
        userId, 
        lockId 
      });
      
      return false;
    }
  }

  /**
   * Gets all locks for a specific user (useful for cleanup)
   */
  async getUserLocks(userId: string): Promise<SeatLock[]> {
    try {
      const result = await this.dynamoDB.scan({
        TableName: this.tableName,
        FilterExpression: 'userId = :userId AND expiresAt > :now',
        ExpressionAttributeValues: {
          ':userId': userId,
          ':now': Date.now()
        }
      }).promise();

      return (result.Items as SeatLock[]) || [];

    } catch (error: any) {
      logger.error('Error getting user locks', { 
        error: error.message, 
        userId 
      });
      
      return [];
    }
  }

  /**
   * Cleans up expired locks (usually called by a scheduled job)
   */
  async cleanupExpiredLocks(): Promise<number> {
    try {
      const now = Date.now();
      
      // Scan for expired locks
      const result = await this.dynamoDB.scan({
        TableName: this.tableName,
        FilterExpression: 'expiresAt <= :now',
        ExpressionAttributeValues: {
          ':now': now
        }
      }).promise();

      const expiredLocks = result.Items as SeatLock[];
      let deletedCount = 0;

      // Delete expired locks in batches
      for (const lock of expiredLocks) {
        try {
          await this.dynamoDB.delete({
            TableName: this.tableName,
            Key: { seatId: lock.seatId }
          }).promise();
          deletedCount++;
        } catch (error: any) {
          logger.warn('Failed to delete expired lock', { 
            seatId: lock.seatId, 
            error: error.message 
          });
        }
      }

      logger.info(`Cleaned up ${deletedCount} expired seat locks`);
      return deletedCount;

    } catch (error: any) {
      logger.error('Error cleaning up expired locks', { error: error.message });
      return 0;
    }
  }
} 