import { SeatLockService } from '../services/SeatLockService';
import AWS from 'aws-sdk';

// Mock AWS SDK
jest.mock('aws-sdk');
const mockDynamoDB = {
  put: jest.fn(),
  get: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  scan: jest.fn()
};

(AWS.DynamoDB.DocumentClient as jest.Mock).mockImplementation(() => mockDynamoDB);

describe('SeatLockService', () => {
  let seatLockService: SeatLockService;
  const mockSeatId = 'seat-123';
  const mockEventId = 'event-456';
  const mockUserId = 'user-789';

  beforeEach(() => {
    jest.clearAllMocks();
    seatLockService = new SeatLockService();
  });

  describe('acquireLock', () => {
    it('should successfully acquire a lock when seat is available', async () => {
      // Arrange
      mockDynamoDB.put.mockReturnValue({
        promise: () => Promise.resolve({})
      });

      // Act
      const result = await seatLockService.acquireLock(mockSeatId, mockEventId, mockUserId);

      // Assert
      expect(result.success).toBe(true);
      expect(result.lockId).toBeDefined();
      expect(result.expiresAt).toBeDefined();
      expect(result.message).toBe('Seat locked successfully');

      expect(mockDynamoDB.put).toHaveBeenCalledWith({
        TableName: 'seat-locks',
        Item: expect.objectContaining({
          seatId: mockSeatId,
          eventId: mockEventId,
          userId: mockUserId,
          lockId: expect.any(String),
          expiresAt: expect.any(Number),
          createdAt: expect.any(Number)
        }),
        ConditionExpression: 'attribute_not_exists(seatId) OR expiresAt < :now',
        ExpressionAttributeValues: {
          ':now': expect.any(Number)
        }
      });
    });

    it('should fail to acquire lock when seat is already locked', async () => {
      // Arrange
      const conditionalCheckError = new Error('ConditionalCheckFailedException');
      conditionalCheckError.name = 'ConditionalCheckFailedException';
      (conditionalCheckError as any).code = 'ConditionalCheckFailedException';

      mockDynamoDB.put.mockReturnValue({
        promise: () => Promise.reject(conditionalCheckError)
      });

      // Act
      const result = await seatLockService.acquireLock(mockSeatId, mockEventId, mockUserId);

      // Assert
      expect(result.success).toBe(false);
      expect(result.message).toBe('Seat is already locked by another user');
      expect(result.lockId).toBeUndefined();
    });

    it('should handle system errors gracefully', async () => {
      // Arrange
      const systemError = new Error('DynamoDB unavailable');
      mockDynamoDB.put.mockReturnValue({
        promise: () => Promise.reject(systemError)
      });

      // Act
      const result = await seatLockService.acquireLock(mockSeatId, mockEventId, mockUserId);

      // Assert
      expect(result.success).toBe(false);
      expect(result.message).toBe('Failed to acquire seat lock due to system error');
    });
  });

  describe('extendLock', () => {
    const mockLockId = 'lock-123';

    it('should successfully extend a valid lock', async () => {
      // Arrange
      mockDynamoDB.update.mockReturnValue({
        promise: () => Promise.resolve({})
      });

      // Act
      const result = await seatLockService.extendLock(mockSeatId, mockEventId, mockUserId, mockLockId);

      // Assert
      expect(result.success).toBe(true);
      expect(result.expiresAt).toBeDefined();
      expect(result.message).toBe('Lock extended successfully');

      expect(mockDynamoDB.update).toHaveBeenCalledWith({
        TableName: 'seat-locks',
        Key: { seatId: mockSeatId },
        UpdateExpression: 'SET expiresAt = :newExpiresAt',
        ConditionExpression: 'userId = :userId AND lockId = :lockId AND expiresAt > :now',
        ExpressionAttributeValues: {
          ':userId': mockUserId,
          ':lockId': mockLockId,
          ':newExpiresAt': expect.any(Number),
          ':now': expect.any(Number)
        }
      });
    });

    it('should fail to extend invalid or expired lock', async () => {
      // Arrange
      const conditionalCheckError = new Error('ConditionalCheckFailedException');
      (conditionalCheckError as any).code = 'ConditionalCheckFailedException';

      mockDynamoDB.update.mockReturnValue({
        promise: () => Promise.reject(conditionalCheckError)
      });

      // Act
      const result = await seatLockService.extendLock(mockSeatId, mockEventId, mockUserId, mockLockId);

      // Assert
      expect(result.success).toBe(false);
      expect(result.message).toBe('Cannot extend lock - invalid lock or lock expired');
    });
  });

  describe('releaseLock', () => {
    const mockLockId = 'lock-123';

    it('should successfully release a valid lock', async () => {
      // Arrange
      mockDynamoDB.delete.mockReturnValue({
        promise: () => Promise.resolve({})
      });

      // Act
      const result = await seatLockService.releaseLock(mockSeatId, mockEventId, mockUserId, mockLockId);

      // Assert
      expect(result).toBe(true);

      expect(mockDynamoDB.delete).toHaveBeenCalledWith({
        TableName: 'seat-locks',
        Key: { seatId: mockSeatId },
        ConditionExpression: 'userId = :userId AND lockId = :lockId',
        ExpressionAttributeValues: {
          ':userId': mockUserId,
          ':lockId': mockLockId
        }
      });
    });

    it('should fail to release lock not owned by user', async () => {
      // Arrange
      const conditionalCheckError = new Error('ConditionalCheckFailedException');
      (conditionalCheckError as any).code = 'ConditionalCheckFailedException';

      mockDynamoDB.delete.mockReturnValue({
        promise: () => Promise.reject(conditionalCheckError)
      });

      // Act
      const result = await seatLockService.releaseLock(mockSeatId, mockEventId, mockUserId, mockLockId);

      // Assert
      expect(result).toBe(false);
    });
  });

  describe('isLocked', () => {
    it('should return true for valid active lock', async () => {
      // Arrange
      const futureTime = Date.now() + 300000; // 5 minutes in future
      mockDynamoDB.get.mockReturnValue({
        promise: () => Promise.resolve({
          Item: {
            seatId: mockSeatId,
            expiresAt: futureTime,
            userId: mockUserId
          }
        })
      });

      // Act
      const result = await seatLockService.isLocked(mockSeatId);

      // Assert
      expect(result).toBe(true);
    });

    it('should return false for expired lock', async () => {
      // Arrange
      const pastTime = Date.now() - 10000; // 10 seconds ago
      mockDynamoDB.get.mockReturnValue({
        promise: () => Promise.resolve({
          Item: {
            seatId: mockSeatId,
            expiresAt: pastTime,
            userId: mockUserId
          }
        })
      });

      // Act
      const result = await seatLockService.isLocked(mockSeatId);

      // Assert
      expect(result).toBe(false);
    });

    it('should return false when no lock exists', async () => {
      // Arrange
      mockDynamoDB.get.mockReturnValue({
        promise: () => Promise.resolve({})
      });

      // Act
      const result = await seatLockService.isLocked(mockSeatId);

      // Assert
      expect(result).toBe(false);
    });

    it('should return true on error for safety', async () => {
      // Arrange
      mockDynamoDB.get.mockReturnValue({
        promise: () => Promise.reject(new Error('DynamoDB error'))
      });

      // Act
      const result = await seatLockService.isLocked(mockSeatId);

      // Assert
      expect(result).toBe(true); // Fail safe - assume locked if error
    });
  });

  describe('validateLock', () => {
    const mockLockId = 'lock-123';

    it('should return true for valid lock owned by user', async () => {
      // Arrange
      const futureTime = Date.now() + 300000;
      mockDynamoDB.get.mockReturnValue({
        promise: () => Promise.resolve({
          Item: {
            seatId: mockSeatId,
            userId: mockUserId,
            lockId: mockLockId,
            expiresAt: futureTime
          }
        })
      });

      // Act
      const result = await seatLockService.validateLock(mockSeatId, mockUserId, mockLockId);

      // Assert
      expect(result).toBe(true);
    });

    it('should return false for lock owned by different user', async () => {
      // Arrange
      const futureTime = Date.now() + 300000;
      mockDynamoDB.get.mockReturnValue({
        promise: () => Promise.resolve({
          Item: {
            seatId: mockSeatId,
            userId: 'different-user',
            lockId: mockLockId,
            expiresAt: futureTime
          }
        })
      });

      // Act
      const result = await seatLockService.validateLock(mockSeatId, mockUserId, mockLockId);

      // Assert
      expect(result).toBe(false);
    });

    it('should return false for wrong lock ID', async () => {
      // Arrange
      const futureTime = Date.now() + 300000;
      mockDynamoDB.get.mockReturnValue({
        promise: () => Promise.resolve({
          Item: {
            seatId: mockSeatId,
            userId: mockUserId,
            lockId: 'different-lock-id',
            expiresAt: futureTime
          }
        })
      });

      // Act
      const result = await seatLockService.validateLock(mockSeatId, mockUserId, mockLockId);

      // Assert
      expect(result).toBe(false);
    });
  });

  describe('cleanupExpiredLocks', () => {
    it('should successfully clean up expired locks', async () => {
      // Arrange
      const expiredLocks = [
        { seatId: 'seat-1', expiresAt: Date.now() - 10000 },
        { seatId: 'seat-2', expiresAt: Date.now() - 20000 }
      ];

      mockDynamoDB.scan.mockReturnValue({
        promise: () => Promise.resolve({ Items: expiredLocks })
      });

      mockDynamoDB.delete.mockReturnValue({
        promise: () => Promise.resolve({})
      });

      // Act
      const deletedCount = await seatLockService.cleanupExpiredLocks();

      // Assert
      expect(deletedCount).toBe(2);
      expect(mockDynamoDB.delete).toHaveBeenCalledTimes(2);
    });

    it('should handle errors during cleanup gracefully', async () => {
      // Arrange
      mockDynamoDB.scan.mockReturnValue({
        promise: () => Promise.reject(new Error('Scan failed'))
      });

      // Act
      const deletedCount = await seatLockService.cleanupExpiredLocks();

      // Assert
      expect(deletedCount).toBe(0);
    });
  });
}); 