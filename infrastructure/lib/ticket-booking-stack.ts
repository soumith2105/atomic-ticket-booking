import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

export class TicketBookingStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // VPC for secure networking
    const vpc = new ec2.Vpc(this, 'TicketBookingVPC', {
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
        {
          cidrMask: 24,
          name: 'Isolated',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
      ],
    });

    // DynamoDB Table for Seat Locks (Critical for double-booking prevention)
    const seatLocksTable = new dynamodb.Table(this, 'SeatLocksTable', {
      tableName: 'seat-locks',
      partitionKey: {
        name: 'seatId',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'expiresAt', // Automatic cleanup of expired locks
      pointInTimeRecovery: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN, // Keep data on stack deletion
    });

    // Add GSI for querying by userId (for user lock management)
    seatLocksTable.addGlobalSecondaryIndex({
      indexName: 'UserIdIndex',
      partitionKey: {
        name: 'userId',
        type: dynamodb.AttributeType.STRING,
      },
    });

    // RDS PostgreSQL for main application data
    const dbCredentials = rds.Credentials.fromGeneratedSecret('admin', {
      secretName: 'ticket-booking-db-credentials',
    });

    const database = new rds.DatabaseInstance(this, 'TicketBookingDB', {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_14,
      }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
      credentials: dbCredentials,
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
      },
      multiAz: true, // High availability
      storageEncrypted: true,
      backupRetention: cdk.Duration.days(7),
      deletionProtection: true,
      databaseName: 'ticket_booking',
    });

    // ElastiCache Redis for caching
    const redisSubnetGroup = new elasticache.CfnSubnetGroup(this, 'RedisSubnetGroup', {
      description: 'Subnet group for Redis cluster',
      subnetIds: vpc.selectSubnets({
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      }).subnetIds,
    });

    const redisSecurityGroup = new ec2.SecurityGroup(this, 'RedisSecurityGroup', {
      vpc,
      description: 'Security group for Redis cluster',
      allowAllOutbound: false,
    });

    redisSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(vpc.vpcCidrBlock),
      ec2.Port.tcp(6379),
      'Allow Redis access from VPC'
    );

    const redisCluster = new elasticache.CfnCacheCluster(this, 'RedisCache', {
      cacheNodeType: 'cache.t3.micro',
      engine: 'redis',
      numCacheNodes: 1,
      cacheSubnetGroupName: redisSubnetGroup.ref,
      vpcSecurityGroupIds: [redisSecurityGroup.securityGroupId],
      port: 6379,
    });

    // IAM Role for Lambda
    const lambdaRole = new iam.Role(this, 'LambdaExecutionRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole'),
      ],
    });

    // Grant DynamoDB permissions
    seatLocksTable.grantFullAccess(lambdaRole);

    // Grant RDS permissions (through VPC security group)
    database.connections.allowDefaultPortFrom(
      ec2.Peer.securityGroupId(lambdaRole.roleId),
      'Allow Lambda access to RDS'
    );

    // Lambda Layer for node_modules (commented out for now)
    // const nodeModulesLayer = new lambda.LayerVersion(this, 'NodeModulesLayer', {
    //   code: lambda.Code.fromAsset('../dist'),
    //   compatibleRuntimes: [lambda.Runtime.NODEJS_18_X],
    //   description: 'Application code for ticket booking',
    // });

    // Main Lambda Function
    const ticketBookingFunction = new lambda.Function(this, 'TicketBookingFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('dist'),
      role: lambdaRole,
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      // layers: [nodeModulesLayer], // Commented out until layer is configured
      timeout: cdk.Duration.seconds(30),
      memorySize: 1024,
      environment: {
        NODE_ENV: 'production',
        DYNAMODB_SEAT_LOCKS_TABLE: seatLocksTable.tableName,
        DB_HOST: database.instanceEndpoint.hostname,
        DB_PORT: database.instanceEndpoint.port.toString(),
        DB_NAME: 'ticket_booking',
        REDIS_HOST: redisCluster.attrRedisEndpointAddress,
        REDIS_PORT: '6379',
        SEAT_LOCK_DURATION_MS: '300000', // 5 minutes
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    // API Gateway
    const api = new apigateway.RestApi(this, 'TicketBookingAPI', {
      restApiName: 'Ticket Booking Service',
      description: 'Production-ready ticket booking platform API',
      deployOptions: {
        stageName: 'prod',
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        dataTraceEnabled: true,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: ['GET', 'POST', 'OPTIONS'],
        allowHeaders: ['Content-Type', 'Authorization'],
      },
    });

    // GraphQL endpoint
    const graphqlIntegration = new apigateway.LambdaIntegration(ticketBookingFunction);
    const graphqlResource = api.root.addResource('graphql');
    graphqlResource.addMethod('POST', graphqlIntegration);
    graphqlResource.addMethod('GET', graphqlIntegration); // For GraphQL Playground

    // Health check endpoint
    const healthResource = api.root.addResource('health');
    healthResource.addMethod('GET', graphqlIntegration);

    // CloudWatch Alarms for monitoring
    const errorAlarm = new cdk.aws_cloudwatch.Alarm(this, 'LambdaErrorAlarm', {
      metric: ticketBookingFunction.metricErrors({
        period: cdk.Duration.minutes(5),
      }),
      threshold: 10,
      evaluationPeriods: 2,
      treatMissingData: cdk.aws_cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    const durationAlarm = new cdk.aws_cloudwatch.Alarm(this, 'LambdaDurationAlarm', {
      metric: ticketBookingFunction.metricDuration({
        period: cdk.Duration.minutes(5),
      }),
      threshold: 25000, // 25 seconds (near timeout)
      evaluationPeriods: 2,
    });

    // DynamoDB monitoring
    const throttleAlarm = new cdk.aws_cloudwatch.Alarm(this, 'DynamoDBThrottleAlarm', {
      metric: seatLocksTable.metricThrottledRequests({
        period: cdk.Duration.minutes(5),
      }),
      threshold: 1,
      evaluationPeriods: 1,
    });

    // Outputs
    new cdk.CfnOutput(this, 'APIEndpoint', {
      value: api.url,
      description: 'API Gateway endpoint URL',
    });

    new cdk.CfnOutput(this, 'GraphQLEndpoint', {
      value: `${api.url}graphql`,
      description: 'GraphQL endpoint URL',
    });

    new cdk.CfnOutput(this, 'DynamoDBTableName', {
      value: seatLocksTable.tableName,
      description: 'DynamoDB table name for seat locks',
    });

    new cdk.CfnOutput(this, 'DatabaseEndpoint', {
      value: database.instanceEndpoint.hostname,
      description: 'RDS PostgreSQL endpoint',
    });

    new cdk.CfnOutput(this, 'RedisEndpoint', {
      value: redisCluster.attrRedisEndpointAddress,
      description: 'ElastiCache Redis endpoint',
    });
  }
} 