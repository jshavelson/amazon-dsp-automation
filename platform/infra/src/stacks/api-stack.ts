import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecsPatterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { NagSuppressions } from 'cdk-nag';

interface ApiStackProps extends cdk.StackProps {
  prefix: string;
  vpc: ec2.Vpc;
  securityGroups: {
    alb: ec2.SecurityGroup;
    ecs: ec2.SecurityGroup;
    rds: ec2.SecurityGroup;
  };
  database: rds.DatabaseInstance;
  databaseSecret: secretsmanager.Secret;
}

export class ApiStack extends cdk.Stack {
  // ECS Cluster
  readonly cluster: ecs.Cluster;

  // ECS Service
  readonly service: ecsPatterns.ApplicationLoadBalancedFargateService;

  // Load Balancer
  readonly loadBalancer: elbv2.ApplicationLoadBalancer;

  // Target Group
  readonly targetGroup: elbv2.ApplicationTargetGroup;

  // Listener
  readonly listener: elbv2.ApplicationListener;

  // ECS Task Definition
  readonly taskDefinition: ecs.FargateTaskDefinition;

  // Service URL
  readonly serviceUrl: string;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const { prefix, vpc, securityGroups, database, databaseSecret } = props;

    // Get foundation stack resources
    const ecsTaskRole = this.node.tryFindChild('EcsTaskRole') as iam.Role;
    const ecsExecutionRole = this.node.tryFindChild('EcsExecutionRole') as iam.Role;

    // Create ECS Cluster
    this.cluster = new ecs.Cluster(this, 'Cluster', {
      clusterName: `${prefix}-cluster`,
      vpc,
      containerInsights: true,
      enableFargateCapacityProviders: true,
      executeCommandConfiguration: {
        logConfiguration: {
          cloudWatchLogGroup: new logs.LogGroup(this, 'EcsExecuteCommandLogGroup', {
            logGroupName: `/aws/ecs/${prefix}/execute-command`,
            retention: logs.RetentionDays.ONE_WEEK,
          }),
        },
        logging: ecs.ExecuteCommandLogging.OVERRIDE,
      },
    });

    // Create Task Definition
    this.taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDefinition', {
      family: `${prefix}-task`,
      memoryLimitMiB: 2048,
      cpu: 1024,
      runtimePlatform: {
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
        cpuArchitecture: ecs.CpuArchitecture.ARM64,
      },
      ephemeralStorageGiB: 20,
    });

    // Add container to task definition
    const container = this.taskDefinition.addContainer('ApiContainer', {
      containerName: `${prefix}-api`,
      image: ecs.ContainerImage.fromAsset('../frontend'),
      logging: new ecs.AwsLogDriver({
        streamPrefix: `${prefix}-api`,
        logRetention: logs.RetentionDays.ONE_WEEK,
      }),
      environment: {
        NODE_ENV: 'production',
        DATABASE_HOST: database.dbInstanceEndpointAddress,
        DATABASE_PORT: database.dbInstanceEndpointPort,
        DATABASE_NAME: 'amazondsp',
        DATABASE_SSL: 'true',
        REDIS_HOST: '', // Will be set if Redis is configured
        REDIS_PORT: '6379',
        AWS_REGION: this.region,
        LOG_LEVEL: 'info',
      },
      secrets: {
        DATABASE_USERNAME: ecs.Secret.fromSecretsManager(databaseSecret, 'username'),
        DATABASE_PASSWORD: ecs.Secret.fromSecretsManager(databaseSecret, 'password'),
      },
      portMappings: [
        {
          containerPort: 8080,
          protocol: ecs.Protocol.TCP,
        },
      ],
      healthCheck: {
        command: ['CMD-SHELL', 'curl -f http://localhost:8080/health || exit 1'],
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        retries: 3,
        startPeriod: cdk.Duration.seconds(60),
      },
      user: 'node',
      workingDirectory: '/app',
    });

    // Grant permissions to task role
    if (ecsTaskRole) {
      databaseSecret.grantRead(ecsTaskRole);
      
      // Grant S3 access
      ecsTaskRole.addToPolicy(new iam.PolicyStatement({
        actions: [
          's3:GetObject',
          's3:PutObject',
          's3:DeleteObject',
          's3:ListBucket',
        ],
        resources: ['*'],
      }));

      // Grant Secrets Manager access
      ecsTaskRole.addToPolicy(new iam.PolicyStatement({
        actions: [
          'secretsmanager:GetSecretValue',
          'secretsmanager:DescribeSecret',
        ],
        resources: ['*'],
      }));

      // Grant SSM Parameter Store access
      ecsTaskRole.addToPolicy(new iam.PolicyStatement({
        actions: [
          'ssm:GetParameter',
          'ssm:GetParameters',
        ],
        resources: ['*'],
      }));

      // Grant CloudWatch Logs access
      ecsTaskRole.addToPolicy(new iam.PolicyStatement({
        actions: [
          'logs:CreateLogGroup',
          'logs:CreateLogStream',
          'logs:PutLogEvents',
          'logs:DescribeLogGroups',
        ],
        resources: ['*'],
      }));
    }

    // Create Load Balancer
    this.loadBalancer = new elbv2.ApplicationLoadBalancer(this, 'LoadBalancer', {
      loadBalancerName: `${prefix}-alb`,
      vpc,
      internetFacing: true,
      securityGroup: securityGroups.alb,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC,
      },
      idleTimeout: cdk.Duration.seconds(60),
      deletionProtection: false,
    });

    // Create Target Group
    this.targetGroup = new elbv2.ApplicationTargetGroup(this, 'TargetGroup', {
      targetGroupName: `${prefix}-tg`,
      vpc,
      protocol: elbv2.ApplicationProtocol.HTTP,
      port: 8080,
      targetType: elbv2.TargetType.IP,
      healthCheck: {
        path: '/health',
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
        protocol: elbv2.Protocol.HTTP,
        port: '8080',
      },
      slowStart: cdk.Duration.seconds(30),
    });

    // Create Listener
    this.listener = this.loadBalancer.addListener('Listener', {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      defaultAction: elbv2.ListenerAction.forward([this.targetGroup]),
      defaultTargetGroups: [this.targetGroup],
    });

    // Create HTTPS Listener (if certificate is provided)
    const certificateArn = this.node.tryGetContext('albCertificateArn') as string;
    
    if (certificateArn) {
      this.loadBalancer.addListener('HttpsListener', {
        port: 443,
        protocol: elbv2.ApplicationProtocol.HTTPS,
        certificates: [elbv2.ListenerCertificate.fromArn(certificateArn)],
        sslPolicy: elbv2.SslPolicy.RECOMMENDED,
        defaultAction: elbv2.ListenerAction.forward([this.targetGroup]),
        defaultTargetGroups: [this.targetGroup],
      });
    }

    // Create ECS Service with Load Balancer
    this.service = new ecsPatterns.ApplicationLoadBalancedFargateService(
      this,
      'Service',
      {
        serviceName: `${prefix}-service`,
        cluster: this.cluster,
        taskDefinition: this.taskDefinition,
        desiredCount: 2,
        minHealthyPercent: 50,
        maxHealthyPercent: 200,
        loadBalancer: this.loadBalancer,
        targetGroup: this.targetGroup,
        listener: this.listener,
        securityGroups: [securityGroups.ecs],
        vpcSubnets: {
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
        assignPublicIp: false,
        enableECSManagedTags: true,
        propagateTags: true,
        healthCheckGracePeriod: cdk.Duration.seconds(60),
        circuitBreaker: {
          rollback: true,
        },
      }
    );

    // Configure Auto Scaling
    const scalableTarget = this.service.service.autoScaleTaskCount({
      minCapacity: 2,
      maxCapacity: 10,
    });

    scalableTarget.scaleOnCpuUtilization('CpuScaling', {
      targetUtilizationPercent: 70,
      scaleInCooldown: cdk.Duration.seconds(60),
      scaleOutCooldown: cdk.Duration.seconds(60),
    });

    scalableTarget.scaleOnMemoryUtilization('MemoryScaling', {
      targetUtilizationPercent: 70,
      scaleInCooldown: cdk.Duration.seconds(60),
      scaleOutCooldown: cdk.Duration.seconds(60),
    });

    scalableTarget.scaleOnRequestCount('RequestScaling', {
      requestsPerTarget: 1000,
      scaleInCooldown: cdk.Duration.seconds(60),
      scaleOutCooldown: cdk.Duration.seconds(60),
      targetGroup: this.targetGroup,
    });

    // Service URL
    this.serviceUrl = this.loadBalancer.loadBalancerDnsName;

    // Add CDK Nag suppressions
    NagSuppressions.addStackSuppressions(this, [
      {
        id: 'AwsSolutions-ECS2',
        reason: 'Fargate is used for serverless containers',
      },
      {
        id: 'AwsSolutions-ELB2',
        reason: 'Load balancer has deletion protection disabled for development',
      },
    ]);

    // Output service information
    new cdk.CfnOutput(this, 'LoadBalancerDnsName', {
      value: this.loadBalancer.loadBalancerDnsName,
      description: 'Load Balancer DNS Name',
    });

    new cdk.CfnOutput(this, 'ServiceUrl', {
      value: `http://${this.serviceUrl}`,
      description: 'API Service URL',
    });

    new cdk.CfnOutput(this, 'TargetGroupArn', {
      value: this.targetGroup.targetGroupArn,
      description: 'Target Group ARN',
    });

    new cdk.CfnOutput(this, 'ClusterName', {
      value: this.cluster.clusterName,
      description: 'ECS Cluster Name',
    });

    new cdk.CfnOutput(this, 'ServiceName', {
      value: this.service.service.serviceName,
      description: 'ECS Service Name',
    });
  }
}
