import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { NagSuppressions } from 'cdk-nag';

interface FoundationStackProps extends cdk.StackProps {
  prefix: string;
}

export class FoundationStack extends cdk.Stack {
  // IAM Roles
  readonly ecsTaskRole: iam.Role;
  readonly ecsExecutionRole: iam.Role;
  readonly lambdaExecutionRole: iam.Role;
  readonly apiGatewayRole: iam.Role;
  readonly cloudFrontRole: iam.Role;

  // KMS Keys
  readonly dataKey: kms.Key;
  readonly secretsKey: kms.Key;

  // Log Groups
  readonly logRetention: logs.RetentionDays;

  // SSM Parameters
  readonly parameterStore: ssm.IParameterStore;

  constructor(scope: Construct, id: string, props: FoundationStackProps) {
    super(scope, id, props);

    const { prefix } = props;

    // Create KMS keys for encryption
    this.dataKey = new kms.Key(this, 'DataKey', {
      keyName: `${prefix}-data-key`,
      description: 'KMS key for encrypting application data',
      enableKeyRotation: true,
      policy: new iam.PolicyDocument({
        statements: [
          new iam.PolicyStatement({
            actions: ['kms:*'],
            principals: [new iam.AccountRootPrincipal()],
            resources: ['*'],
          }),
        ],
      }),
    });

    this.secretsKey = new kms.Key(this, 'SecretsKey', {
      keyName: `${prefix}-secrets-key`,
      description: 'KMS key for encrypting secrets',
      enableKeyRotation: true,
      policy: new iam.PolicyDocument({
        statements: [
          new iam.PolicyStatement({
            actions: ['kms:*'],
            principals: [new iam.AccountRootPrincipal()],
            resources: ['*'],
          }),
        ],
      }),
    });

    // IAM Role for ECS Task
    this.ecsTaskRole = new iam.Role(this, 'EcsTaskRole', {
      roleName: `${prefix}-ecs-task-role`,
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      description: 'Role for ECS Fargate tasks',
    });

    // IAM Role for ECS Execution
    this.ecsExecutionRole = new iam.Role(this, 'EcsExecutionRole', {
      roleName: `${prefix}-ecs-execution-role`,
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      description: 'Role for ECS task execution',
    });

    // Add managed policies to ECS execution role
    this.ecsExecutionRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy')
    );

    // IAM Role for Lambda Functions
    this.lambdaExecutionRole = new iam.Role(this, 'LambdaExecutionRole', {
      roleName: `${prefix}-lambda-execution-role`,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'Role for Lambda function execution',
    });

    // Add basic Lambda execution policy
    this.lambdaExecutionRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
    );

    // IAM Role for API Gateway
    this.apiGatewayRole = new iam.Role(this, 'ApiGatewayRole', {
      roleName: `${prefix}-api-gateway-role`,
      assumedBy: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      description: 'Role for API Gateway',
    });

    // IAM Role for CloudFront
    this.cloudFrontRole = new iam.Role(this, 'CloudFrontRole', {
      roleName: `${prefix}-cloudfront-role`,
      assumedBy: new iam.ServicePrincipal('cloudfront.amazonaws.com'),
      description: 'Role for CloudFront distributions',
    });

    // Log retention policy (30 days for dev, 365 days for prod)
    const isProd = this.node.tryGetContext('environment') === 'production';
    this.logRetention = isProd 
      ? logs.RetentionDays.ONE_YEAR 
      : logs.RetentionDays.THIRTY_DAYS;

    // SSM Parameter Store reference
    this.parameterStore = ssm.ParameterStore.of(this);

    // Add CDK Nag suppressions for known issues
    NagSuppressions.addStackSuppressions(this, [
      {
        id: 'AwsSolutions-IAM4',
        reason: 'Using AWS managed policies for service roles is acceptable',
        appliesTo: ['Policy::arn:<AWS::IAM::Policy>:*'],
      },
      {
        id: 'AwsSolutions-IAM5',
        reason: 'Wildcard permissions are needed for service roles',
        appliesTo: ['Policy::arn:<AWS::IAM::Policy>:*'],
      },
    ]);
  }
}
