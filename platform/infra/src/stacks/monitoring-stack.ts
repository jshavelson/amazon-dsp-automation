import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as cloudwatchActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

interface MonitoringStackProps extends cdk.StackProps {
  prefix: string;
  foundation: any;
  network: any;
  database: any;
  storage: any;
  auth: any;
  api: any;
  frontend: any;
}

export class MonitoringStack extends cdk.Stack {
  // CloudWatch Dashboards
  readonly dashboards: {
    overview: cloudwatch.Dashboard;
    api: cloudwatch.Dashboard;
    database: cloudwatch.Dashboard;
    frontend: cloudwatch.Dashboard;
    security: cloudwatch.Dashboard;
  };

  // CloudWatch Alarms
  readonly alarms: {
    api: cloudwatch.Alarm[];
    database: cloudwatch.Alarm[];
    frontend: cloudwatch.Alarm[];
    security: cloudwatch.Alarm[];
  };

  // SNS Topics for notifications
  readonly notificationTopics: {
    critical: sns.Topic;
    warning: sns.Topic;
    info: sns.Topic;
  };

  // Log Groups
  readonly logGroups: {
    api: logs.LogGroup;
    database: logs.LogGroup;
    frontend: logs.LogGroup;
    security: logs.LogGroup;
  };

  constructor(scope: Construct, id: string, props: MonitoringStackProps) {
    super(scope, id, props);

    const { prefix } = props;

    // Create SNS topics for notifications
    this.notificationTopics = {
      critical: new sns.Topic(this, 'CriticalTopic', {
        topicName: `${prefix}-critical-alerts`,
        displayName: 'Amazon DSP - Critical Alerts',
        masterKey: props.foundation?.dataKey,
      }),
      warning: new sns.Topic(this, 'WarningTopic', {
        topicName: `${prefix}-warning-alerts`,
        displayName: 'Amazon DSP - Warning Alerts',
        masterKey: props.foundation?.dataKey,
      }),
      info: new sns.Topic(this, 'InfoTopic', {
        topicName: `${prefix}-info-alerts`,
        displayName: 'Amazon DSP - Info Alerts',
        masterKey: props.foundation?.dataKey,
      }),
    };

    // Create Log Groups
    this.logGroups = {
      api: new logs.LogGroup(this, 'ApiLogGroup', {
        logGroupName: `/aws/${prefix}/api`,
        retention: logs.RetentionDays.ONE_MONTH,
        encryptionKey: props.foundation?.dataKey,
      }),
      database: new logs.LogGroup(this, 'DatabaseLogGroup', {
        logGroupName: `/aws/${prefix}/database`,
        retention: logs.RetentionDays.ONE_MONTH,
        encryptionKey: props.foundation?.dataKey,
      }),
      frontend: new logs.LogGroup(this, 'FrontendLogGroup', {
        logGroupName: `/aws/${prefix}/frontend`,
        retention: logs.RetentionDays.ONE_MONTH,
        encryptionKey: props.foundation?.dataKey,
      }),
      security: new logs.LogGroup(this, 'SecurityLogGroup', {
        logGroupName: `/aws/${prefix}/security`,
        retention: logs.RetentionDays.SIX_MONTHS,
        encryptionKey: props.foundation?.dataKey,
      }),
    };

    // Create CloudWatch Dashboards
    this.createDashboards();

    // Create CloudWatch Alarms
    this.createAlarms();

    // Output monitoring information
    new cdk.CfnOutput(this, 'CriticalTopicArn', {
      value: this.notificationTopics.critical.topicArn,
      description: 'Critical alerts SNS topic ARN',
    });

    new cdk.CfnOutput(this, 'WarningTopicArn', {
      value: this.notificationTopics.warning.topicArn,
      description: 'Warning alerts SNS topic ARN',
    });

    new cdk.CfnOutput(this, 'InfoTopicArn', {
      value: this.notificationTopics.info.topicArn,
      description: 'Info alerts SNS topic ARN',
    });
  }

  // Create CloudWatch Dashboards
  private createDashboards(): void {
    const { prefix } = this.node.tryGetContext('prefix') || 'amazon-dsp';

    // Overview Dashboard
    this.dashboards.overview = new cloudwatch.Dashboard(this, 'OverviewDashboard', {
      dashboardName: `${prefix}-overview`,
      start: '-PT1H',
      end: 'PT0S',
      periodOverride: cloudwatch.GraphWidgetPeriodOverride.INHERIT,
      widgets: [
        this.createOverviewWidgets(),
      ].flat(),
    });

    // API Dashboard
    this.dashboards.api = new cloudwatch.Dashboard(this, 'ApiDashboard', {
      dashboardName: `${prefix}-api`,
      start: '-PT1H',
      end: 'PT0S',
      periodOverride: cloudwatch.GraphWidgetPeriodOverride.INHERIT,
      widgets: [
        this.createApiWidgets(),
      ].flat(),
    });

    // Database Dashboard
    this.dashboards.database = new cloudwatch.Dashboard(this, 'DatabaseDashboard', {
      dashboardName: `${prefix}-database`,
      start: '-PT1H',
      end: 'PT0S',
      periodOverride: cloudwatch.GraphWidgetPeriodOverride.INHERIT,
      widgets: [
        this.createDatabaseWidgets(),
      ].flat(),
    });

    // Frontend Dashboard
    this.dashboards.frontend = new cloudwatch.Dashboard(this, 'FrontendDashboard', {
      dashboardName: `${prefix}-frontend`,
      start: '-PT1H',
      end: 'PT0S',
      periodOverride: cloudwatch.GraphWidgetPeriodOverride.INHERIT,
      widgets: [
        this.createFrontendWidgets(),
      ].flat(),
    });

    // Security Dashboard
    this.dashboards.security = new cloudwatch.Dashboard(this, 'SecurityDashboard', {
      dashboardName: `${prefix}-security`,
      start: '-PT1H',
      end: 'PT0S',
      periodOverride: cloudwatch.GraphWidgetPeriodOverride.INHERIT,
      widgets: [
        this.createSecurityWidgets(),
      ].flat(),
    });
  }

  // Create Overview Widgets
  private createOverviewWidgets(): cloudwatch.IWidget[] {
    const { prefix } = this;

    return [
      new cloudwatch.GraphWidget({
        title: 'API Requests',
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/ApplicationELB',
            metricName: 'RequestCount',
            dimensionsMap: {
              LoadBalancer: this.node.tryGetContext('loadBalancerName') || '',
            },
            statistic: 'Sum',
            period: cdk.Duration.minutes(5),
          }),
        ],
        width: 12,
        height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: 'Database Connections',
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/RDS',
            metricName: 'DatabaseConnections',
            dimensionsMap: {
              DBInstanceIdentifier: this.node.tryGetContext('databaseName') || '',
            },
            statistic: 'Average',
            period: cdk.Duration.minutes(5),
          }),
        ],
        width: 12,
        height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: 'ECS CPU Utilization',
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/ECS',
            metricName: 'CPUUtilization',
            dimensionsMap: {
              ClusterName: this.node.tryGetContext('clusterName') || '',
              ServiceName: this.node.tryGetContext('serviceName') || '',
            },
            statistic: 'Average',
            period: cdk.Duration.minutes(5),
          }),
        ],
        width: 12,
        height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: 'ECS Memory Utilization',
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/ECS',
            metricName: 'MemoryUtilization',
            dimensionsMap: {
              ClusterName: this.node.tryGetContext('clusterName') || '',
              ServiceName: this.node.tryGetContext('serviceName') || '',
            },
            statistic: 'Average',
            period: cdk.Duration.minutes(5),
          }),
        ],
        width: 12,
        height: 6,
      }),
    ];
  }

  // Create API Widgets
  private createApiWidgets(): cloudwatch.IWidget[] {
    return [
      new cloudwatch.GraphWidget({
        title: 'API Latency',
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/ApplicationELB',
            metricName: 'TargetResponseTime',
            dimensionsMap: {
              LoadBalancer: this.node.tryGetContext('loadBalancerName') || '',
            },
            statistic: 'Average',
            period: cdk.Duration.minutes(1),
          }),
        ],
        width: 12,
        height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: 'API 5XX Errors',
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/ApplicationELB',
            metricName: 'HTTPCode_Target_5XX_Count',
            dimensionsMap: {
              LoadBalancer: this.node.tryGetContext('loadBalancerName') || '',
            },
            statistic: 'Sum',
            period: cdk.Duration.minutes(1),
          }),
        ],
        width: 12,
        height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: 'API 4XX Errors',
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/ApplicationELB',
            metricName: 'HTTPCode_Target_4XX_Count',
            dimensionsMap: {
              LoadBalancer: this.node.tryGetContext('loadBalancerName') || '',
            },
            statistic: 'Sum',
            period: cdk.Duration.minutes(1),
          }),
        ],
        width: 12,
        height: 6,
      }),
    ];
  }

  // Create Database Widgets
  private createDatabaseWidgets(): cloudwatch.IWidget[] {
    return [
      new cloudwatch.GraphWidget({
        title: 'Database CPU Utilization',
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/RDS',
            metricName: 'CPUUtilization',
            dimensionsMap: {
              DBInstanceIdentifier: this.node.tryGetContext('databaseName') || '',
            },
            statistic: 'Average',
            period: cdk.Duration.minutes(1),
          }),
        ],
        width: 12,
        height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: 'Database Free Storage Space',
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/RDS',
            metricName: 'FreeStorageSpace',
            dimensionsMap: {
              DBInstanceIdentifier: this.node.tryGetContext('databaseName') || '',
            },
            statistic: 'Average',
            period: cdk.Duration.minutes(5),
          }),
        ],
        width: 12,
        height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: 'Database Connections',
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/RDS',
            metricName: 'DatabaseConnections',
            dimensionsMap: {
              DBInstanceIdentifier: this.node.tryGetContext('databaseName') || '',
            },
            statistic: 'Average',
            period: cdk.Duration.minutes(1),
          }),
        ],
        width: 12,
        height: 6,
      }),
    ];
  }

  // Create Frontend Widgets
  private createFrontendWidgets(): cloudwatch.IWidget[] {
    return [
      new cloudwatch.GraphWidget({
        title: 'CloudFront Requests',
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/CloudFront',
            metricName: 'Requests',
            dimensionsMap: {
              DistributionId: this.node.tryGetContext('distributionId') || '',
            },
            statistic: 'Sum',
            period: cdk.Duration.minutes(5),
          }),
        ],
        width: 12,
        height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: 'CloudFront 5XX Errors',
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/CloudFront',
            metricName: '5xxErrorRate',
            dimensionsMap: {
              DistributionId: this.node.tryGetContext('distributionId') || '',
            },
            statistic: 'Average',
            period: cdk.Duration.minutes(5),
          }),
        ],
        width: 12,
        height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: 'CloudFront Latency',
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/CloudFront',
            metricName: 'TotalErrorRate',
            dimensionsMap: {
              DistributionId: this.node.tryGetContext('distributionId') || '',
            },
            statistic: 'Average',
            period: cdk.Duration.minutes(5),
          }),
        ],
        width: 12,
        height: 6,
      }),
    ];
  }

  // Create Security Widgets
  private createSecurityWidgets(): cloudwatch.IWidget[] {
    return [
      new cloudwatch.GraphWidget({
        title: 'Cognito Authentication Attempts',
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/Cognito',
            metricName: 'AuthenticationAttempts',
            dimensionsMap: {
              UserPool: this.node.tryGetContext('userPoolId') || '',
            },
            statistic: 'Sum',
            period: cdk.Duration.minutes(5),
          }),
        ],
        width: 12,
        height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: 'Cognito Authentication Successes',
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/Cognito',
            metricName: 'AuthenticationSuccesses',
            dimensionsMap: {
              UserPool: this.node.tryGetContext('userPoolId') || '',
            },
            statistic: 'Sum',
            period: cdk.Duration.minutes(5),
          }),
        ],
        width: 12,
        height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: 'Cognito Authentication Failures',
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/Cognito',
            metricName: 'AuthenticationFailures',
            dimensionsMap: {
              UserPool: this.node.tryGetContext('userPoolId') || '',
            },
            statistic: 'Sum',
            period: cdk.Duration.minutes(5),
          }),
        ],
        width: 12,
        height: 6,
      }),
    ];
  }

  // Create CloudWatch Alarms
  private createAlarms(): void {
    // API Alarms
    this.alarms.api = [
      new cloudwatch.Alarm(this, 'ApiHighLatencyAlarm', {
        alarmName: `${this.node.tryGetContext('prefix')}-api-high-latency`,
        metric: new cloudwatch.Metric({
          namespace: 'AWS/ApplicationELB',
          metricName: 'TargetResponseTime',
          dimensionsMap: {
            LoadBalancer: this.node.tryGetContext('loadBalancerName') || '',
          },
          statistic: 'Average',
          period: cdk.Duration.minutes(1),
        }),
        threshold: 1000, // 1 second
        evaluationPeriods: 3,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        alarmDescription: 'API latency is high',
        alarmActions: [this.notificationTopics.critical],
      }),
      new cloudwatch.Alarm(this, 'ApiHighErrorRateAlarm', {
        alarmName: `${this.node.tryGetContext('prefix')}-api-high-error-rate`,
        metric: new cloudwatch.Metric({
          namespace: 'AWS/ApplicationELB',
          metricName: 'HTTPCode_Target_5XX_Count',
          dimensionsMap: {
            LoadBalancer: this.node.tryGetContext('loadBalancerName') || '',
          },
          statistic: 'Sum',
          period: cdk.Duration.minutes(1),
        }),
        threshold: 10,
        evaluationPeriods: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        alarmDescription: 'API 5XX error rate is high',
        alarmActions: [this.notificationTopics.critical],
      }),
    ];

    // Database Alarms
    this.alarms.database = [
      new cloudwatch.Alarm(this, 'DatabaseHighCpuAlarm', {
        alarmName: `${this.node.tryGetContext('prefix')}-database-high-cpu`,
        metric: new cloudwatch.Metric({
          namespace: 'AWS/RDS',
          metricName: 'CPUUtilization',
          dimensionsMap: {
            DBInstanceIdentifier: this.node.tryGetContext('databaseName') || '',
          },
          statistic: 'Average',
          period: cdk.Duration.minutes(5),
        }),
        threshold: 80,
        evaluationPeriods: 3,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        alarmDescription: 'Database CPU utilization is high',
        alarmActions: [this.notificationTopics.warning],
      }),
      new cloudwatch.Alarm(this, 'DatabaseLowStorageAlarm', {
        alarmName: `${this.node.tryGetContext('prefix')}-database-low-storage`,
        metric: new cloudwatch.Metric({
          namespace: 'AWS/RDS',
          metricName: 'FreeStorageSpace',
          dimensionsMap: {
            DBInstanceIdentifier: this.node.tryGetContext('databaseName') || '',
          },
          statistic: 'Average',
          period: cdk.Duration.minutes(5),
        }),
        threshold: 1000000000, // 1 GB
        evaluationPeriods: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
        alarmDescription: 'Database free storage space is low',
        alarmActions: [this.notificationTopics.critical],
      }),
    ];

    // Frontend Alarms
    this.alarms.frontend = [
      new cloudwatch.Alarm(this, 'FrontendHighErrorRateAlarm', {
        alarmName: `${this.node.tryGetContext('prefix')}-frontend-high-error-rate`,
        metric: new cloudwatch.Metric({
          namespace: 'AWS/CloudFront',
          metricName: '5xxErrorRate',
          dimensionsMap: {
            DistributionId: this.node.tryGetContext('distributionId') || '',
          },
          statistic: 'Average',
          period: cdk.Duration.minutes(5),
        }),
        threshold: 1,
        evaluationPeriods: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        alarmDescription: 'Frontend 5XX error rate is high',
        alarmActions: [this.notificationTopics.critical],
      }),
    ];

    // Security Alarms
    this.alarms.security = [
      new cloudwatch.Alarm(this, 'SecurityHighAuthFailuresAlarm', {
        alarmName: `${this.node.tryGetContext('prefix')}-security-high-auth-failures`,
        metric: new cloudwatch.Metric({
          namespace: 'AWS/Cognito',
          metricName: 'AuthenticationFailures',
          dimensionsMap: {
            UserPool: this.node.tryGetContext('userPoolId') || '',
          },
          statistic: 'Sum',
          period: cdk.Duration.minutes(5),
        }),
        threshold: 10,
        evaluationPeriods: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        alarmDescription: 'High number of authentication failures',
        alarmActions: [this.notificationTopics.warning],
      }),
    ];
  }
}
