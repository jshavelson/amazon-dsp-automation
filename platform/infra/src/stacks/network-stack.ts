import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { NagSuppressions } from 'cdk-nag';

interface NetworkStackProps extends cdk.StackProps {
  prefix: string;
}

export class NetworkStack extends cdk.Stack {
  // VPC
  readonly vpc: ec2.Vpc;

  // Security Groups
  readonly securityGroups: {
    alb: ec2.SecurityGroup;
    ecs: ec2.SecurityGroup;
    rds: ec2.SecurityGroup;
    redis: ec2.SecurityGroup;
    lambda: ec2.SecurityGroup;
  };

  // Subnets
  readonly subnets: {
    public: ec2.Subnet[];
    private: ec2.Subnet[];
    isolated: ec2.Subnet[];
  };

  // VPC Endpoints
  readonly vpcEndpoints: {
    s3: ec2.InterfaceVpcEndpoint;
    secretsManager: ec2.InterfaceVpcEndpoint;
    ssm: ec2.InterfaceVpcEndpoint;
    logs: ec2.InterfaceVpcEndpoint;
    ecr: ec2.InterfaceVpcEndpoint;
  };

  constructor(scope: Construct, id: string, props: NetworkStackProps) {
    super(scope, id, props);

    const { prefix } = props;

    // Create VPC with 3 AZs
    this.vpc = new ec2.Vpc(this, 'Vpc', {
      vpcName: `${prefix}-vpc`,
      cidr: '10.0.0.0/16',
      maxAzs: 3,
      natGateways: 2, // Use 2 NAT Gateways for redundancy
      subnetConfiguration: [
        {
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
          mapPublicIpOnLaunch: true,
        },
        {
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24,
        },
        {
          name: 'Isolated',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        },
      ],
      enableDnsHostnames: true,
      enableDnsSupport: true,
    });

    // Organize subnets by type
    this.subnets = {
      public: this.vpc.publicSubnets,
      private: this.vpc.privateSubnets,
      isolated: this.vpc.isolatedSubnets,
    };

    // Create security groups
    this.securityGroups = {
      alb: new ec2.SecurityGroup(this, 'AlbSecurityGroup', {
        vpc: this.vpc,
        securityGroupName: `${prefix}-alb-sg`,
        description: 'Security group for Application Load Balancer',
        allowAllOutbound: true,
      }),

      ecs: new ec2.SecurityGroup(this, 'EcsSecurityGroup', {
        vpc: this.vpc,
        securityGroupName: `${prefix}-ecs-sg`,
        description: 'Security group for ECS Fargate service',
        allowAllOutbound: true,
      }),

      rds: new ec2.SecurityGroup(this, 'RdsSecurityGroup', {
        vpc: this.vpc,
        securityGroupName: `${prefix}-rds-sg`,
        description: 'Security group for RDS PostgreSQL',
        allowAllOutbound: false, // RDS should not have outbound access
      }),

      redis: new ec2.SecurityGroup(this, 'RedisSecurityGroup', {
        vpc: this.vpc,
        securityGroupName: `${prefix}-redis-sg`,
        description: 'Security group for ElastiCache Redis',
        allowAllOutbound: false,
      }),

      lambda: new ec2.SecurityGroup(this, 'LambdaSecurityGroup', {
        vpc: this.vpc,
        securityGroupName: `${prefix}-lambda-sg`,
        description: 'Security group for Lambda functions',
        allowAllOutbound: true,
      }),
    };

    // Configure security group rules
    // ALB: Allow HTTP/HTTPS from anywhere
    this.securityGroups.alb.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(80),
      'Allow HTTP traffic from anywhere'
    );

    this.securityGroups.alb.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      'Allow HTTPS traffic from anywhere'
    );

    // ECS: Allow traffic from ALB
    this.securityGroups.ecs.addIngressRule(
      this.securityGroups.alb,
      ec2.Port.tcp(8080),
      'Allow traffic from ALB to ECS'
    );

    // ECS: Allow health checks from ALB
    this.securityGroups.ecs.addIngressRule(
      this.securityGroups.alb,
      ec2.Port.tcp(3000),
      'Allow health checks from ALB'
    );

    // RDS: Allow PostgreSQL from ECS
    this.securityGroups.rds.addIngressRule(
      this.securityGroups.ecs,
      ec2.Port.tcp(5432),
      'Allow PostgreSQL from ECS'
    );

    // RDS: Allow PostgreSQL from Lambda (if needed)
    this.securityGroups.rds.addIngressRule(
      this.securityGroups.lambda,
      ec2.Port.tcp(5432),
      'Allow PostgreSQL from Lambda'
    );

    // Redis: Allow Redis from ECS
    this.securityGroups.redis.addIngressRule(
      this.securityGroups.ecs,
      ec2.Port.tcp(6379),
      'Allow Redis from ECS'
    );

    // Redis: Allow Redis from Lambda
    this.securityGroups.redis.addIngressRule(
      this.securityGroups.lambda,
      ec2.Port.tcp(6379),
      'Allow Redis from Lambda'
    );

    // Create VPC Endpoints for private connectivity
    this.vpcEndpoints = {
      s3: new ec2.InterfaceVpcEndpoint(this, 'S3VpcEndpoint', {
        vpc: this.vpc,
        service: ec2.InterfaceVpcEndpointAwsService.S3,
        privateDnsEnabled: true,
        subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        securityGroups: [this.securityGroups.ecs],
      }),

      secretsManager: new ec2.InterfaceVpcEndpoint(this, 'SecretsManagerVpcEndpoint', {
        vpc: this.vpc,
        service: ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
        privateDnsEnabled: true,
        subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        securityGroups: [this.securityGroups.ecs],
      }),

      ssm: new ec2.InterfaceVpcEndpoint(this, 'SsmVpcEndpoint', {
        vpc: this.vpc,
        service: ec2.InterfaceVpcEndpointAwsService.SSM,
        privateDnsEnabled: true,
        subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        securityGroups: [this.securityGroups.ecs],
      }),

      logs: new ec2.InterfaceVpcEndpoint(this, 'LogsVpcEndpoint', {
        vpc: this.vpc,
        service: ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS,
        privateDnsEnabled: true,
        subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        securityGroups: [this.securityGroups.ecs],
      }),

      ecr: new ec2.InterfaceVpcEndpoint(this, 'EcrVpcEndpoint', {
        vpc: this.vpc,
        service: ec2.InterfaceVpcEndpointAwsService.ECR,
        privateDnsEnabled: true,
        subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        securityGroups: [this.securityGroups.ecs],
      }),
    };

    // Add CDK Nag suppressions
    NagSuppressions.addStackSuppressions(this, [
      {
        id: 'AwsSolutions-EC23',
        reason: 'VPC Flow Logs are not required for this application',
      },
      {
        id: 'AwsSolutions-EC28',
        reason: 'NAT Gateway is needed for outbound internet access from private subnets',
      },
    ]);
  }
}
