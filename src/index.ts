import 'reflect-metadata';
import express from 'express';
import { ApolloServer } from 'apollo-server-express';
import { createConnection } from 'typeorm';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import { buildSchema } from 'type-graphql';
import { Container } from 'typedi';

import { logger } from './utils/logger';
import { ErrorHandler } from './middleware/errorHandler';
import { createTypeOrmConfig } from './config/database';
import { createRedisClient } from './config/redis';
import { SeatLockService } from './services/SeatLockService';
import { BookingService } from './services/BookingService';
import { CacheService } from './services/CacheService';
import { EventResolver } from './resolvers/EventResolver';
import { BookingResolver } from './resolvers/BookingResolver';
import { SeatResolver } from './resolvers/SeatResolver';

// Load environment variables
dotenv.config();

async function createServer() {
  const app = express();
  
  // Security middleware
  app.use(helmet({
    contentSecurityPolicy: false, // Disable for GraphQL Playground in development
  }));
  
  // CORS configuration
  app.use(cors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
    credentials: true,
  }));

  
  // Rate limiting
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: process.env.NODE_ENV === 'production' ? 100 : 1000, // More restrictive in production
    message: 'Too many requests from this IP, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use(limiter);

  // Initialize database connection
  const connection = await createConnection(createTypeOrmConfig());
  logger.info('Database connection established');

  // Initialize Redis
  const redis = createRedisClient();
  logger.info('Redis connection established');

  // Register services in dependency injection container
  Container.set('redis', redis);
  const seatLockService = new SeatLockService();
  const cacheService = new CacheService();
  Container.set('seatLockService', seatLockService);
  Container.set('cacheService', cacheService);
  Container.set('bookingService', new BookingService(seatLockService, cacheService));

  // Build GraphQL schema
  const schema = await buildSchema({
    resolvers: [EventResolver, BookingResolver, SeatResolver],
    container: Container,
    validate: false,
  });

  // Create Apollo Server
  const server = new ApolloServer({
    schema,
    context: ({ req, res }) => ({
      req,
      res,
      user: (req as any).user, // Assuming authentication middleware adds user to request
    }),
    introspection: process.env.NODE_ENV !== 'production',
    debug: process.env.NODE_ENV !== 'production',
  });

  await server.start();
  server.applyMiddleware({ app: app as any, path: '/graphql' });

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.json({ 
      status: 'healthy', 
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '1.0.0'
    });
  });

  // Error handling middleware
  app.use(ErrorHandler.handle);

  return { app, server };
}

async function startServer() {
  try {
    const { app } = await createServer();
    const port = process.env.PORT || 4000;
    
    app.listen(port, () => {
      logger.info(`🚀 Server ready at http://localhost:${port}/graphql`);
      logger.info(`📊 Health check at http://localhost:${port}/health`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  process.exit(0);
});

if (require.main === module) {
  startServer();
}

export { createServer }; 