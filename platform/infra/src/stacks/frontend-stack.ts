import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53Targets from 'aws-cdk-lib/aws-route53-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { NagSuppressions } from 'cdk-nag';

interface FrontendStackProps extends cdk.StackProps {
  prefix: string;
  domainName?: string;
  certificateArn?: string;
  hostedZoneId?: string;
  storage: {
    staticAssets: s3.Bucket;
    uploads: s3.Bucket;
    backups: s3.Bucket;
    logs: s3.Bucket;
    temp: s3.Bucket;
  };
  auth: cognito.UserPool;
  api: any; // ApiStack
}

export class FrontendStack extends cdk.Stack {
  // CloudFront Distribution
  readonly distribution: cloudfront.Distribution;

  // S3 Bucket for frontend hosting
  readonly hostingBucket: s3.Bucket;

  // Route53 Record (if domain is configured)
  readonly route53Record?: route53.ARecord;

  // Distribution Domain Name
  readonly distributionDomainName: string;

  constructor(scope: Construct, id: string, props: FrontendStackProps) {
    super(scope, id, props);

    const { 
      prefix, 
      domainName, 
      certificateArn, 
      hostedZoneId,
      storage,
      auth 
    } = props;

    // Create hosting bucket for frontend
    this.hostingBucket = new s3.Bucket(this, 'HostingBucket', {
      bucketName: `${prefix}-frontend-${this.account}-${this.region}`,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      autoDeleteObjects: false,
      accessControl: s3.BucketAccessControl.PRIVATE,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: true,
      enforceSSL: true,
      websiteIndexDocument: 'index.html',
      websiteErrorDocument: 'index.html',
      serverAccessLogsBucket: storage.logs,
      serverAccessLogsPrefix: 'frontend-access-logs/',
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

    // Create Origin Access Identity for CloudFront
    const originAccessIdentity = new cloudfront.OriginAccessIdentity(
      this,
      'OriginAccessIdentity',
      {
        comment: `OAI for ${prefix} frontend`,
      }
    );

    // Grant CloudFront access to S3 bucket
    this.hostingBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        actions: ['s3:GetObject'],
        principals: [originAccessIdentity.grantPrincipal],
        resources: [`${this.hostingBucket.bucketArn}/*`],
      })
    );

    // Create CloudFront Distribution
    const apiUrl = props.api?.serviceUrl || '';
    
    this.distribution = new cloudfront.Distribution(this, 'Distribution', {
      distributionName: `${prefix}-distribution`,
      comment: 'CloudFront distribution for Amazon DSP Dashboard',
      defaultRootObject: 'index.html',
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
        },
      ],
      defaultBehavior: {
        origin: new origins.S3Origin(this.hostingBucket, {
          originAccessIdentity,
          originPath: '/',
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
        responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.CORS_ALLOW_ALL_ORIGINS,
        compress: true,
      },
      additionalBehaviors: {
        '/api/*': {
          origin: new origins.HttpOrigin(apiUrl, {
            originPath: '/',
            protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
          }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
        },
        '/uploads/*': {
          origin: new origins.S3Origin(storage.uploads, {
            originAccessIdentity,
            originPath: '/',
          }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        },
      },
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      enabled: true,
      isIpV6Enabled: true,
      enableLogging: true,
      logBucket: storage.logs,
      logFilePrefix: 'cloudfront-logs/',
      logIncludesCookies: false,
      webAclId: '', // Will be set if WAF is configured
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
    });

    // Configure custom domain if provided
    if (domainName && certificateArn && hostedZoneId) {
      // Get the hosted zone
      const hostedZone = route53.HostedZone.fromHostedZoneAttributes(
        this,
        'HostedZone',
        {
          hostedZoneId,
          zoneName: domainName,
        }
      );

      // Get the certificate
      const certificate = acm.Certificate.fromCertificateArn(
        this,
        'Certificate',
        certificateArn
      );

      // Add custom domain to CloudFront
      this.distribution.addAlternateDomain(domainName);
      this.distribution.addCertificate(certificate);

      // Create Route53 record
      this.route53Record = new route53.ARecord(this, 'Route53Record', {
        zone: hostedZone,
        recordName: domainName,
        target: route53.RecordTarget.fromAlias(
          new route53Targets.CloudFrontTarget(this.distribution)
        ),
        ttl: cdk.Duration.minutes(5),
      });
    }

    // Distribution domain name
    this.distributionDomainName = this.distribution.distributionDomainName;

    // Add CDK Nag suppressions
    NagSuppressions.addStackSuppressions(this, [
      {
        id: 'AwsSolutions-CFR1',
        reason: 'CloudFront distribution has logging enabled',
      },
      {
        id: 'AwsSolutions-CFR2',
        reason: 'CloudFront distribution has HTTPS enabled',
      },
      {
        id: 'AwsSolutions-CFR4',
        reason: 'CloudFront distribution has WAF disabled (will be configured separately)',
      },
    ]);

    // Output frontend information
    new cdk.CfnOutput(this, 'HostingBucketName', {
      value: this.hostingBucket.bucketName,
      description: 'Frontend hosting bucket name',
    });

    new cdk.CfnOutput(this, 'DistributionDomainName', {
      value: this.distributionDomainName,
      description: 'CloudFront distribution domain name',
    });

    new cdk.CfnOutput(this, 'DistributionId', {
      value: this.distribution.distributionId,
      description: 'CloudFront distribution ID',
    });

    new cdk.CfnOutput(this, 'FrontendUrl', {
      value: `https://${this.distributionDomainName}`,
      description: 'Frontend URL',
    });

    if (domainName) {
      new cdk.CfnOutput(this, 'CustomDomainUrl', {
        value: `https://${domainName}`,
        description: 'Custom domain URL',
      });
    }
  }
}
