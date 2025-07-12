# 🎫 Production-Ready Ticket Booking Platform

A cloud-native, high-performance ticket booking system built with TypeScript, Node.js, GraphQL, and AWS services. This platform implements **real-time seat locking** and **guaranteed double-booking prevention** for high-traffic events.

## 🏗️ Architecture Overview

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Frontend      │    │   GraphQL API   │    │   Database      │
│   (React/Vue)   │───▶│   (Apollo)      │───▶│   (PostgreSQL)  │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                                │
                                ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Redis Cache   │◀───│  Seat Locking   │───▶│   DynamoDB      │
│   (Seat Maps)   │    │   Service       │    │   (Locks+TTL)   │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## 🎯 Key Features

### ✨ **Real-Time Seat Locking**
- **DynamoDB-based locking** with TTL for automatic expiration
- **Conditional writes** prevent race conditions under high concurrency
- **5-minute lock duration** with extension capability
- **Atomic lock acquisition** ensures only one user can lock a seat

### 🛡️ **Double-Booking Prevention**
- **ACID transactions** for seat-to-booking conversion
- **Lock validation** before final booking creation
- **Inventory management** with real-time availability updates
- **Rollback mechanisms** for failure scenarios

### ⚡ **High Performance**
- **Redis caching** for rapid seat map delivery
- **Database connection pooling** for optimal resource usage
- **GraphQL** for efficient data fetching
- **Rate limiting** to prevent abuse

### 🏗️ **Production Ready**
- **Comprehensive logging** with Winston
- **Error handling** with structured responses
- **Health checks** and monitoring endpoints
- **Environment-based configuration**

## 🛠️ Technology Stack

| Component | Technology | Purpose |
|-----------|------------|---------|
| **Backend** | Node.js + TypeScript | Type-safe server-side logic |
| **API Layer** | GraphQL + Apollo Server | Flexible, efficient data fetching |
| **Database** | PostgreSQL + TypeORM | Persistent data storage with ORM |
| **Seat Locking** | DynamoDB | Real-time locks with TTL |
| **Caching** | Redis | Fast seat availability queries |
| **Cloud** | AWS (Lambda, RDS, ElastiCache) | Scalable cloud infrastructure |
| **Logging** | Winston | Structured application logging |

## 📊 Database Schema

### Core Entities

```typescript
// Events - Concert, sports, etc.
Event {
  id: UUID
  name: string
  description?: string
  eventDate: Date
  venueId: UUID
  status: EventStatus
  basePrice?: number
  maxCapacity: number
  availableSeats: number
}

// Venues - Physical locations
Venue {
  id: UUID
  name: string
  address: string
  totalCapacity: number
}

// Seats - Individual seats in venues
Seat {
  id: UUID
  venueId: UUID
  section: string
  row: string
  number: number
  type: SeatType
  status: SeatStatus
  priceModifier?: number
}

// Users - Customer accounts
User {
  id: UUID
  email: string
  firstName: string
  lastName: string
  passwordHash: string
}

// Bookings - Finalized purchases
Booking {
  id: UUID
  userId: UUID
  eventId: UUID
  totalPrice: number
  status: BookingStatus
  bookingDate: Date
  paymentIntentId?: string
}
```

### DynamoDB Seat Locks

```typescript
SeatLock {
  seatId: string        // Partition key
  eventId: string
  userId: string
  lockId: string        // Unique lock identifier
  expiresAt: number     // TTL for automatic cleanup
  createdAt: number
}
```

## 🔒 Seat Locking Implementation

### How It Works

1. **Lock Acquisition**
   ```typescript
   // Atomic conditional write to DynamoDB
   await dynamoDB.put({
     Item: seatLock,
     ConditionExpression: 'attribute_not_exists(seatId) OR expiresAt < :now'
   });
   ```

2. **Lock Validation**
   ```typescript
   // Verify user owns valid lock before booking
   const isValid = await seatLockService.validateLock(seatId, userId, lockId);
   ```

3. **Booking Conversion**
   ```typescript
   // ACID transaction converts locks to permanent bookings
   await queryRunner.startTransaction();
   // 1. Validate locks
   // 2. Create booking
   // 3. Update seat status
   // 4. Release locks
   await queryRunner.commitTransaction();
   ```

### Concurrency Handling

- **Conditional writes** prevent multiple users from locking the same seat
- **TTL expiration** automatically releases abandoned locks
- **Lock validation** ensures only valid lock holders can complete bookings
- **Transaction rollback** handles failure scenarios gracefully

## 🚀 API Documentation

### GraphQL Queries

```graphql
# Get available events
query GetEvents($limit: Int, $status: EventStatus) {
  events(limit: $limit, status: $status) {
    id
    name
    eventDate
    venue {
      name
      address
    }
    availableSeats
    canPurchaseTickets
  }
}

# Get available seats for an event
query GetAvailableSeats($eventId: ID!) {
  availableSeats(eventId: $eventId) {
    id
    section
    row
    number
    type
    priceModifier
  }
}
```

### GraphQL Mutations

```graphql
# Lock a seat (critical for preventing double-booking)
mutation LockSeat($seatId: ID!, $eventId: ID!, $userId: ID!) {
  lockSeat(seatId: $seatId, eventId: $eventId, userId: $userId) {
    success
    lockId
    expiresAt
    message
  }
}

# Create booking (converts locks to permanent reservation)
mutation CreateBooking($input: CreateBookingInput!, $userId: ID!) {
  createBooking(input: $input, userId: $userId) {
    success
    booking {
      id
      bookingReference
      totalPrice
      status
    }
    message
    failureReason
  }
}
```

## 🔧 Setup Instructions

### Prerequisites

- Node.js 18+
- PostgreSQL 12+
- Redis 6+
- AWS Account (for DynamoDB)

### Installation

1. **Clone Repository**
   ```bash
   git clone <repository-url>
   cd ticket-booking
   ```

2. **Install Dependencies**
   ```bash
   npm install
   ```

3. **Environment Setup**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

4. **Database Setup**
   ```bash
   # Create PostgreSQL database
   createdb ticket_booking
   
   # Run migrations
   npm run db:migrate
   
   # Seed sample data
   npm run db:seed
   ```

5. **AWS DynamoDB Setup**
   ```bash
   # Create DynamoDB table for seat locks
   aws dynamodb create-table \
     --table-name seat-locks \
     --attribute-definitions AttributeName=seatId,AttributeType=S \
     --key-schema AttributeName=seatId,KeyType=HASH \
     --billing-mode PAY_PER_REQUEST \
     --time-to-live-specification AttributeName=expiresAt,Enabled=true
   ```

6. **Start Development Server**
   ```bash
   npm run dev
   ```

### Production Deployment

1. **Build Application**
   ```bash
   npm run build
   ```

2. **Deploy to AWS Lambda**
   ```bash
   # Using AWS CDK or Serverless Framework
   npm run deploy
   ```

## 🧪 Testing

### Unit Tests

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Watch mode
npm run test:watch
```

### Critical Test Cases

- **Seat Lock Race Conditions**: Verify only one user can lock a seat
- **Booking Atomicity**: Ensure bookings are created or rolled back completely
- **Lock Expiration**: Validate TTL-based automatic cleanup
- **Inventory Management**: Confirm seat availability is accurately maintained

### Load Testing

```bash
# Simulate high concurrency for popular events
artillery run load-tests/seat-locking.yml
```

## 📈 Performance Considerations

### Scalability Features

- **Horizontal scaling** with AWS Lambda
- **Database read replicas** for query distribution
- **Redis clustering** for cache high availability
- **DynamoDB auto-scaling** for lock table

### Optimization Strategies

- **Connection pooling** minimizes database overhead
- **Query optimization** with proper indexing
- **Cache warming** for popular events
- **TTL cleanup** prevents lock table bloat

## 🏥 Monitoring & Operations

### Health Checks

```bash
# Application health
GET /health

# Database connectivity
GET /health/db

# Redis connectivity
GET /health/cache
```

### Logging

- **Structured JSON logging** with Winston
- **Request/response logging** for debugging
- **Performance metrics** for optimization
- **Error tracking** with stack traces

### Metrics to Monitor

- **Lock acquisition rate** and success percentage
- **Booking conversion rate** from locks
- **Database connection pool** utilization
- **Cache hit/miss ratios**
- **API response times** and error rates

## 🔐 Security Features

- **Rate limiting** to prevent abuse
- **Input validation** with Joi schemas
- **CORS configuration** for cross-origin requests
- **Helmet.js** for security headers
- **Environment-based secrets** management

## 📝 API Examples

### Complete Booking Flow

```typescript
// 1. Get available seats
const seats = await client.query({
  query: GET_AVAILABLE_SEATS,
  variables: { eventId: "event-123" }
});

// 2. Lock selected seat
const lockResult = await client.mutate({
  mutation: LOCK_SEAT,
  variables: {
    seatId: "seat-456",
    eventId: "event-123",
    userId: "user-789"
  }
});

// 3. Create booking (if lock successful)
if (lockResult.data.lockSeat.success) {
  const booking = await client.mutate({
    mutation: CREATE_BOOKING,
    variables: {
      input: {
        eventId: "event-123",
        seatIds: ["seat-456"],
        lockIds: [lockResult.data.lockSeat.lockId]
      },
      userId: "user-789"
    }
  });
}
```

## 🤝 Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🎯 Production Readiness Checklist

- ✅ **Real-time seat locking** with DynamoDB + TTL
- ✅ **Double-booking prevention** with ACID transactions
- ✅ **High concurrency handling** with conditional writes
- ✅ **Caching strategy** with Redis
- ✅ **Error handling** and logging
- ✅ **Health checks** and monitoring
- ✅ **Environment configuration**
- ✅ **Rate limiting** and security
- ✅ **Comprehensive testing**
- ✅ **Documentation** and examples

---

**Built for high-traffic scenarios** • **Designed for production** • **Optimized for performance** 