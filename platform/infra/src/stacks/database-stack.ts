import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { NagSuppressions } from 'cdk-nag';

interface DatabaseStackProps extends cdk.StackProps {
  prefix: string;
  vpc: ec2.Vpc;
  securityGroups: {
    rds: ec2.SecurityGroup;
    ecs: ec2.SecurityGroup;
    lambda: ec2.SecurityGroup;
  };
}

export class DatabaseStack extends cdk.Stack {
  // RDS PostgreSQL Database
  readonly database: rds.DatabaseInstance;

  // Database Secret
  readonly databaseSecret: secretsmanager.Secret;

  // Database Proxy (optional)
  readonly databaseProxy?: rds.DatabaseProxy;

  // Database Log Group
  readonly databaseLogGroup: logs.LogGroup;

  constructor(scope: Construct, id: string, props: DatabaseStackProps) {
    super(scope, id, props);

    const { prefix, vpc, securityGroups } = props;

    // Create database secret
    this.databaseSecret = new secretsmanager.Secret(this, 'DatabaseSecret', {
      secretName: `${prefix}/database/credentials`,
      description: 'Database credentials for Amazon DSP application',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          username: 'dsp_admin',
        }),
        generateStringKey: 'password',
        passwordLength: 32,
        excludeCharacters: '"@/\\\'\" ',
      },
    });

    // Create database log group
    this.databaseLogGroup = new logs.LogGroup(this, 'DatabaseLogGroup', {
      logGroupName: `/aws/rds/${prefix}/postgresql`,
      retention: logs.RetentionDays.ONE_WEEK,
    });

    // Create RDS PostgreSQL Database
    this.database = new rds.DatabaseInstance(this, 'Database', {
      databaseName: 'amazondsp',
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_15_4,
      }),
      instanceType: rds.InstanceType.of(
        cdk.Fn.conditionIf(
          new cdk.CfnCondition(this, 'IsProduction', {
            expression: cdk.Fn.equals(
              this.node.tryGetContext('environment'),
              'production'
            ),
          }),
          'db.t3.medium',
          'db.t3.micro'
        ).toString()
      ),
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
      },
      securityGroups: [securityGroups.rds],
      credentials: rds.Credentials.fromSecret(this.databaseSecret),
      allocatedStorage: 20,
      maxAllocatedStorage: 100,
      storageType: rds.StorageType.GP3,
      backupRetention: cdk.Duration.days(7),
      preferredBackupWindow: '03:00-04:00',
      preferredMaintenanceWindow: 'sun:04:00-sun:05:00',
      monitoringInterval: cdk.Duration.minutes(5),
      enablePerformanceInsights: true,
      performanceInsightRetention: cdk.Duration.days(7),
      cloudwatchLogsExports: ['postgresql'],
      cloudwatchLogsRetention: logs.RetentionDays.ONE_WEEK,
      deletionProtection: true,
      enableCloudwatchLogsExports: true,
      parameterGroup: rds.ParameterGroup.fromParameterGroupName(
        this,
        'ParameterGroup',
        'default.postgres15'
      ),
      optionGroup: rds.OptionGroup.fromOptionGroupName(
        this,
        'OptionGroup',
        'default.postgres15'
      ),
      multiAz: false, // Single AZ for cost savings
      publiclyAccessible: false,
      storageEncrypted: true,
      autoMinorVersionUpgrade: true,
      dbInstanceName: `${prefix}-db`,
    });

    // Grant ECS task role access to database secret
    const ecsTaskRole = this.node.tryFindChild('EcsTaskRole') as iam.Role;
    if (ecsTaskRole) {
      this.databaseSecret.grantRead(ecsTaskRole);
    }

    // Grant Lambda execution role access to database secret
    const lambdaExecutionRole = this.node.tryFindChild('LambdaExecutionRole') as iam.Role;
    if (lambdaExecutionRole) {
      this.databaseSecret.grantRead(lambdaExecutionRole);
    }

    // Create database proxy for connection pooling (optional)
    const useProxy = this.node.tryGetContext('useDatabaseProxy') as boolean || false;
    
    if (useProxy) {
      this.databaseProxy = new rds.DatabaseProxy(this, 'DatabaseProxy', {
        proxyName: `${prefix}-db-proxy`,
        vpc,
        vpcSubnets: {
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
        securityGroups: [securityGroups.rds],
        database: this.database,
        requireTls: true,
        idleClientTimeout: cdk.Duration.minutes(30),
        debugLogging: false,
      });

      // Grant access to proxy
      if (ecsTaskRole) {
        this.databaseProxy.grantConnect(ecsTaskRole);
      }
      if (lambdaExecutionRole) {
        this.databaseProxy.grantConnect(lambdaExecutionRole);
      }
    }

    // Add CDK Nag suppressions
    NagSuppressions.addStackSuppressions(this, [
      {
        id: 'AwsSolutions-RDS10',
        reason: 'Multi-AZ is disabled for cost savings in non-production environments',
      },
      {
        id: 'AwsSolutions-RDS14',
        reason: 'Storage encryption is enabled',
      },
      {
        id: 'AwsSolutions-RDS16',
        reason: 'Backup retention is set to 7 days which is acceptable for this application',
      },
    ]);

    // Output database connection information
    new cdk.CfnOutput(this, 'DatabaseEndpoint', {
      value: this.database.dbInstanceEndpointAddress,
      description: 'Database endpoint address',
    });

    new cdk.CfnOutput(this, 'DatabasePort', {
      value: this.database.dbInstanceEndpointPort,
      description: 'Database endpoint port',
    });

    new cdk.CfnOutput(this, 'DatabaseSecretArn', {
      value: this.databaseSecret.secretArn,
      description: 'Database secret ARN',
    });

    if (this.databaseProxy) {
      new cdk.CfnOutput(this, 'DatabaseProxyEndpoint', {
        value: this.databaseProxy.endpoint,
        description: 'Database proxy endpoint',
      });
    }
  }
}
