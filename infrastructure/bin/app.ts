#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { TicketBookingStack } from '../lib/ticket-booking-stack';

const app = new cdk.App();

new TicketBookingStack(app, 'TicketBookingStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  description: 'Production-ready ticket booking platform with seat locking and double-booking prevention',
});

app.synth(); 