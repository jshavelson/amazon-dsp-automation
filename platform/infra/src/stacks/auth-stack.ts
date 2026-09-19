import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { NagSuppressions } from 'cdk-nag';

interface AuthStackProps extends cdk.StackProps {
  prefix: string;
}

export class AuthStack extends cdk.Stack {
  // Cognito User Pool
  readonly userPool: cognito.UserPool;

  // Cognito User Pool Client
  readonly userPoolClient: cognito.UserPoolClient;

  // Cognito Identity Pool (optional)
  readonly identityPool?: cognito.CfnIdentityPool;

  // Custom Domain (optional)
  readonly customDomain?: cognito.CfnUserPoolDomain;

  // Auth Lambda Functions
  readonly authLambda?: lambda.Function;

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props);

    const { prefix } = props;

    // Create User Pool
    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: `${prefix}-user-pool`,
      selfSignUpEnabled: false, // Disable self sign-up for security
      signInAliases: {
        email: true,
        username: false,
      },
      signInCaseSensitive: false,
      autoVerify: {
        email: true,
      },
      standardAttributes: {
        email: {
          required: true,
          mutable: true,
        },
        givenName: {
          required: true,
          mutable: true,
        },
        familyName: {
          required: true,
          mutable: true,
        },
        phoneNumber: {
          required: false,
          mutable: true,
        },
      },
      customAttributes: {
        role: new cognito.StringAttribute({
          mutable: true,
        }),
        tenantId: new cognito.StringAttribute({
          mutable: true,
        }),
        employeeId: new cognito.StringAttribute({
          mutable: true,
        }),
      },
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
        tempPasswordValidity: cdk.Duration.days(7),
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      mfa: cognito.Mfa.REQUIRED,
      mfaSecondFactor: {
        sms: false,
        otp: true,
      },
      softwareTokenMfaSettings: {
        enabled: true,
      },
      advancedSecurityMode: cognito.AdvancedSecurityMode.ENFORCED,
      deviceTracking: {
        challengeRequiredOnNewDevice: true,
        deviceOnlyRememberedOnUserPrompt: false,
      },
      emailSettings: {
        from: 'noreply@amazondsp.com',
        replyTo: 'support@amazondsp.com',
      },
      smsSettings: {
        externalId: 'amazon-dsp-auth',
        snsCallerArn: '', // Will be set if SMS is configured
      },
      userInvitation: {
        emailSubject: 'Invitation to join Amazon DSP Dashboard',
        emailBody: 'Hello {username}, you have been invited to join Amazon DSP Dashboard. Please use the following temporary password: {####}',
        smsMessage: 'Hello {username}, your temporary password for Amazon DSP Dashboard is {####}',
      },
      userPoolAddOns: {
        advancedSecurity: {
          mode: cognito.AdvancedSecurityMode.ENFORCED,
        },
      },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // Add custom domain if configured
    const domainName = this.node.tryGetContext('cognitoDomain') as string;
    const certificateArn = this.node.tryGetContext('cognitoCertificateArn') as string;

    if (domainName && certificateArn) {
      this.customDomain = new cognito.CfnUserPoolDomain(this, 'CustomDomain', {
        domain: domainName,
        userPoolId: this.userPool.userPoolId,
        customDomainConfig: {
          certificate: certificateArn,
        },
      });
    }

    // Create User Pool Client
    this.userPoolClient = new cognito.UserPoolClient(this, 'UserPoolClient', {
      userPool: this.userPool,
      authFlows: {
        userPassword: true,
        userSrp: true,
        custom: true,
        adminUserPassword: true,
      },
      oAuth: {
        flows: {
          implicitCodeGrant: true,
          authorizationCodeGrant: true,
          clientCredentials: false,
        },
        callbackUrls: [
          'https://localhost:3000/callback',
          'https://localhost:8080/callback',
        ],
        logoutUrls: [
          'https://localhost:3000/logout',
          'https://localhost:8080/logout',
        ],
        scopes: [
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.PROFILE,
          cognito.OAuthScope.COGNITO_ADMIN,
        ],
      },
      generateSecret: true,
      preventUserExistenceErrors: true,
      refreshTokenValidity: cdk.Duration.days(30),
      accessTokenValidity: cdk.Duration.minutes(60),
      idTokenValidity: cdk.Duration.minutes(60),
      tokenValidityUnits: {
        accessToken: cdk.Duration.minutes(60),
        idToken: cdk.Duration.minutes(60),
        refreshToken: cdk.Duration.days(30),
      },
      clientName: `${prefix}-client`,
      enableTokenRevocation: true,
      explicitAuthFlows: [
        {
          allowAdminUserPasswordAuth: true,
          allowCustomAuth: true,
          allowRefreshTokenAuth: true,
          allowUserPasswordAuth: true,
          allowUserSrpAuth: true,
        },
      ],
    });

    // Create Identity Pool for unauthenticated access (optional)
    const createIdentityPool = this.node.tryGetContext('createIdentityPool') as boolean || false;
    
    if (createIdentityPool) {
      this.identityPool = new cognito.CfnIdentityPool(this, 'IdentityPool', {
        identityPoolName: `${prefix}-identity-pool`,
        allowUnauthenticatedIdentities: true,
        cognitoIdentityProviders: [
          {
            providerName: this.userPool.userPoolName,
            userPoolId: this.userPool.userPoolId,
            clientId: this.userPoolClient.userPoolClientId,
          },
        ],
      });
    }

    // Create auth-related Lambda functions
    this.createAuthLambdaFunctions();

    // Add CDK Nag suppressions
    NagSuppressions.addStackSuppressions(this, [
      {
        id: 'AwsSolutions-COG2',
        reason: 'MFA is required for all users',
      },
      {
        id: 'AwsSolutions-COG3',
        reason: 'Advanced security is enforced',
      },
      {
        id: 'AwsSolutions-COG4',
        reason: 'Password policy meets security requirements',
      },
    ]);

    // Output Cognito information
    new cdk.CfnOutput(this, 'UserPoolId', {
      value: this.userPool.userPoolId,
      description: 'Cognito User Pool ID',
    });

    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: this.userPoolClient.userPoolClientId,
      description: 'Cognito User Pool Client ID',
    });

    new cdk.CfnOutput(this, 'UserPoolClientSecret', {
      value: this.userPoolClient.userPoolClientSecret?.toString() || '',
      description: 'Cognito User Pool Client Secret',
    });

    new cdk.CfnOutput(this, 'UserPoolArn', {
      value: this.userPool.userPoolArn,
      description: 'Cognito User Pool ARN',
    });

    if (this.customDomain) {
      new cdk.CfnOutput(this, 'CognitoDomain', {
        value: this.customDomain.domain,
        description: 'Cognito Custom Domain',
      });
    }
  }

  // Create auth-related Lambda functions
  private createAuthLambdaFunctions(): void {
    // Pre-authentication Lambda
    const preAuthLambda = new lambda.Function(this, 'PreAuthLambda', {
      functionName: `${this.node.tryGetContext('prefix')}-pre-auth`,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/auth/pre-auth'),
      memorySize: 256,
      timeout: cdk.Duration.seconds(10),
      environment: {
        USER_POOL_ID: this.userPool.userPoolId,
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    // Add permissions
    this.userPool.addTrigger(
      cognito.UserPoolTrigger.PRE_AUTHENTICATION,
      preAuthLambda
    );

    // Post-authentication Lambda
    const postAuthLambda = new lambda.Function(this, 'PostAuthLambda', {
      functionName: `${this.node.tryGetContext('prefix')}-post-auth`,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/auth/post-auth'),
      memorySize: 256,
      timeout: cdk.Duration.seconds(10),
      environment: {
        USER_POOL_ID: this.userPool.userPoolId,
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    this.userPool.addTrigger(
      cognito.UserPoolTrigger.POST_AUTHENTICATION,
      postAuthLambda
    );

    // Custom message Lambda
    const customMessageLambda = new lambda.Function(this, 'CustomMessageLambda', {
      functionName: `${this.node.tryGetContext('prefix')}-custom-message`,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/auth/custom-message'),
      memorySize: 256,
      timeout: cdk.Duration.seconds(10),
      environment: {
        USER_POOL_ID: this.userPool.userPoolId,
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    this.userPool.addTrigger(
      cognito.UserPoolTrigger.CUSTOM_MESSAGE,
      customMessageLambda
    );
  }
}
