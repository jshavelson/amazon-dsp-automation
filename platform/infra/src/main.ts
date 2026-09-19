import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

// Import stacks
import { FoundationStack } from './stacks/foundation-stack';
import { NetworkStack } from './stacks/network-stack';
import { DatabaseStack } from './stacks/database-stack';
import { StorageStack } from './stacks/storage-stack';
import { AuthStack } from './stacks/auth-stack';
import { ApiStack } from './stacks/api-stack';
import { FrontendStack } from './stacks/frontend-stack';
import { MonitoringStack } from './stacks/monitoring-stack';

// Application configuration
interface AppConfig {
  env: cdk.Environment;
  prefix: string;
  domainName?: string;
  certificateArn?: string;
  hostedZoneId?: string;
}

// Get configuration from context or environment
const getConfig = (app: cdk.App): AppConfig => {
  const env = app.node.tryGetContext('env') as cdk.Environment || {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
  };

  const prefix = app.node.tryGetContext('prefix') as string || 'amazon-dsp';
  const domainName = app.node.tryGetContext('domainName') as string;
  const certificateArn = app.node.tryGetContext('certificateArn') as string;
  const hostedZoneId = app.node.tryGetContext('hostedZoneId') as string;

  return {
    env,
    prefix,
    domainName,
    certificateArn,
    hostedZoneId,
  };
};

// Main CDK App
const app = new cdk.App();

// Get configuration
const config = getConfig(app);

// Create stacks with proper dependencies
const foundationStack = new FoundationStack(app, `${config.prefix}-foundation`, {
  env: config.env,
  prefix: config.prefix,
  description: 'Foundation stack with IAM roles, parameters, and base resources',
});

const networkStack = new NetworkStack(app, `${config.prefix}-network`, {
  env: config.env,
  prefix: config.prefix,
  description: 'Network stack with VPC, subnets, and security groups',
});

const databaseStack = new DatabaseStack(app, `${config.prefix}-database`, {
  env: config.env,
  prefix: config.prefix,
  vpc: networkStack.vpc,
  securityGroups: networkStack.securityGroups,
  description: 'Database stack with RDS PostgreSQL and related resources',
});

const storageStack = new StorageStack(app, `${config.prefix}-storage`, {
  env: config.env,
  prefix: config.prefix,
  description: 'Storage stack with S3 buckets for static assets and data',
});

const authStack = new AuthStack(app, `${config.prefix}-auth`, {
  env: config.env,
  prefix: config.prefix,
  description: 'Authentication stack with Cognito User Pool',
});

const apiStack = new ApiStack(app, `${config.prefix}-api`, {
  env: config.env,
  prefix: config.prefix,
  vpc: networkStack.vpc,
  securityGroups: networkStack.securityGroups,
  database: databaseStack.database,
  databaseSecret: databaseStack.databaseSecret,
  description: 'API stack with API Gateway, ALB, and ECS Fargate service',
});

const frontendStack = new FrontendStack(app, `${config.prefix}-frontend`, {
  env: config.env,
  prefix: config.prefix,
  domainName: config.domainName,
  certificateArn: config.certificateArn,
  hostedZoneId: config.hostedZoneId,
  storage: storageStack.buckets,
  auth: authStack.userPool,
  api: apiStack,
  description: 'Frontend stack with CloudFront CDN and S3 static hosting',
});

const monitoringStack = new MonitoringStack(app, `${config.prefix}-monitoring`, {
  env: config.env,
  prefix: config.prefix,
  foundation: foundationStack,
  network: networkStack,
  database: databaseStack,
  storage: storageStack,
  auth: authStack,
  api: apiStack,
  frontend: frontendStack,
  description: 'Monitoring stack with CloudWatch alarms, dashboards, and logs',
});

// Add dependencies between stacks
frontendStack.addDependency(apiStack);
frontendStack.addDependency(authStack);
frontendStack.addDependency(storageStack);
apiStack.addDependency(databaseStack);
apiStack.addDependency(networkStack);
apiStack.addDependency(foundationStack);
databaseStack.addDependency(networkStack);
databaseStack.addDependency(foundationStack);
monitoringStack.addDependency(foundationStack);
monitoringStack.addDependency(networkStack);
monitoringStack.addDependency(databaseStack);
monitoringStack.addDependency(storageStack);
monitoringStack.addDependency(authStack);
monitoringStack.addDependency(apiStack);
monitoringStack.addDependency(frontendStack);

// Tag all resources
cdk.Tags.of(app).add('Application', 'AmazonDSP');
cdk.Tags.of(app).add('Environment', config.env.region);
cdk.Tags.of(app).add('ManagedBy', 'CDK');
cdk.Tags.of(app).add('Project', config.prefix);

// Synth the app
app.synth();
