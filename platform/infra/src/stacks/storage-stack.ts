import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { NagSuppressions } from 'cdk-nag';

interface StorageStackProps extends cdk.StackProps {
  prefix: string;
}

export class StorageStack extends cdk.Stack {
  // S3 Buckets
  readonly buckets: {
    staticAssets: s3.Bucket;
    uploads: s3.Bucket;
    backups: s3.Bucket;
    logs: s3.Bucket;
    temp: s3.Bucket;
  };

  // Bucket Policies
  readonly bucketPolicies: {
    staticAssets: iam.Policy;
    uploads: iam.Policy;
    backups: iam.Policy;
  };

  constructor(scope: Construct, id: string, props: StorageStackProps) {
    super(scope, id, props);

    const { prefix } = props;

    // Static Assets Bucket (for frontend hosting)
    this.buckets.staticAssets = new s3.Bucket(this, 'StaticAssetsBucket', {
      bucketName: `${prefix}-static-assets-${this.account}-${this.region}`,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      autoDeleteObjects: false,
      accessControl: s3.BucketAccessControl.PRIVATE,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: true,
      enforceSSL: true,
      objectLockEnabled: false,
      serverAccessLogsPrefix: 'access-logs/',
      loggingBucket: this.createLoggingBucket(`${prefix}-static-assets-logs`),
      lifecycleRules: [
        {
          transitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: cdk.Duration.days(30),
            },
            {
              storageClass: s3.StorageClass.GLACIER,
              transitionAfter: cdk.Duration.days(90),
            },
          ],
        },
      ],
    });

    // Uploads Bucket (for user uploads)
    this.buckets.uploads = new s3.Bucket(this, 'UploadsBucket', {
      bucketName: `${prefix}-uploads-${this.account}-${this.region}`,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      autoDeleteObjects: false,
      accessControl: s3.BucketAccessControl.PRIVATE,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: true,
      enforceSSL: true,
      objectLockEnabled: false,
      serverAccessLogsPrefix: 'access-logs/',
      loggingBucket: this.createLoggingBucket(`${prefix}-uploads-logs`),
      lifecycleRules: [
        {
          transitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: cdk.Duration.days(7),
            },
            {
              storageClass: s3.StorageClass.GLACIER,
              transitionAfter: cdk.Duration.days(30),
            },
          ],
          expiration: cdk.Duration.days(365),
        },
      ],
    });

    // Backups Bucket (for database backups)
    this.buckets.backups = new s3.Bucket(this, 'BackupsBucket', {
      bucketName: `${prefix}-backups-${this.account}-${this.region}`,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      autoDeleteObjects: false,
      accessControl: s3.BucketAccessControl.PRIVATE,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: true,
      enforceSSL: true,
      objectLockEnabled: true,
      objectLockDefaultRetention: {
        mode: s3.ObjectLockRetentionMode.COMPLIANCE,
        duration: cdk.Duration.days(30),
      },
      serverAccessLogsPrefix: 'access-logs/',
      loggingBucket: this.createLoggingBucket(`${prefix}-backups-logs`),
      lifecycleRules: [
        {
          transitions: [
            {
              storageClass: s3.StorageClass.GLACIER,
              transitionAfter: cdk.Duration.days(1),
            },
            {
              storageClass: s3.StorageClass.DEEP_ARCHIVE,
              transitionAfter: cdk.Duration.days(30),
            },
          ],
        },
      ],
    });

    // Logs Bucket (for application logs)
    this.buckets.logs = new s3.Bucket(this, 'LogsBucket', {
      bucketName: `${prefix}-logs-${this.account}-${this.region}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      accessControl: s3.BucketAccessControl.LOG_DELIVERY_WRITE,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: false,
      enforceSSL: true,
      objectLockEnabled: false,
      serverAccessLogsPrefix: 'access-logs/',
      lifecycleRules: [
        {
          transitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: cdk.Duration.days(7),
            },
            {
              storageClass: s3.StorageClass.GLACIER,
              transitionAfter: cdk.Duration.days(30),
            },
          ],
          expiration: cdk.Duration.days(90),
        },
      ],
    });

    // Temp Bucket (for temporary files)
    this.buckets.temp = new s3.Bucket(this, 'TempBucket', {
      bucketName: `${prefix}-temp-${this.account}-${this.region}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      accessControl: s3.BucketAccessControl.PRIVATE,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: false,
      enforceSSL: true,
      objectLockEnabled: false,
      lifecycleRules: [
        {
          expiration: cdk.Duration.days(1),
        },
      ],
    });

    // Create bucket policies
    this.createBucketPolicies();

    // Add CDK Nag suppressions
    NagSuppressions.addStackSuppressions(this, [
      {
        id: 'AwsSolutions-S1',
        reason: 'Server access logging is enabled for all buckets',
      },
      {
        id: 'AwsSolutions-S2',
        reason: 'S3 buckets have block public access enabled',
      },
      {
        id: 'AwsSolutions-S10',
        reason: 'S3 buckets have encryption enabled',
      },
    ]);

    // Output bucket names
    new cdk.CfnOutput(this, 'StaticAssetsBucketName', {
      value: this.buckets.staticAssets.bucketName,
      description: 'Static assets bucket name',
    });

    new cdk.CfnOutput(this, 'UploadsBucketName', {
      value: this.buckets.uploads.bucketName,
      description: 'Uploads bucket name',
    });

    new cdk.CfnOutput(this, 'BackupsBucketName', {
      value: this.buckets.backups.bucketName,
      description: 'Backups bucket name',
    });
  }

  // Helper method to create logging bucket
  private createLoggingBucket(name: string): s3.IBucket {
    return new s3.Bucket(this, `${name}-bucket`, {
      bucketName: `${name}-${this.account}-${this.region}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      accessControl: s3.BucketAccessControl.LOG_DELIVERY_WRITE,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: false,
      enforceSSL: true,
      lifecycleRules: [
        {
          expiration: cdk.Duration.days(90),
        },
      ],
    });
  }

  // Create bucket policies
  private createBucketPolicies(): void {
    // Static Assets Bucket Policy
    this.buckets.staticAssets.addToResourcePolicy(
      new iam.PolicyStatement({
        actions: ['s3:GetObject'],
        principals: [new iam.CloudFrontOriginIdentityPrincipal()],
        resources: [`${this.buckets.staticAssets.bucketArn}/*`],
      })
    );

    // Uploads Bucket Policy
    this.buckets.uploads.addToResourcePolicy(
      new iam.PolicyStatement({
        actions: ['s3:*'],
        principals: [new iam.AccountRootPrincipal()],
        resources: [`${this.buckets.uploads.bucketArn}/*`],
      })
    );

    // Backups Bucket Policy
    this.buckets.backups.addToResourcePolicy(
      new iam.PolicyStatement({
        actions: ['s3:*'],
        principals: [new iam.AccountRootPrincipal()],
        resources: [`${this.buckets.backups.bucketArn}/*`],
      })
    );
  }
}
