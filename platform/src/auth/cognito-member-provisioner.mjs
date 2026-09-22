import {
  AdminCreateUserCommand,
  AdminGetUserCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';

const attribute = (user, name) => user?.UserAttributes?.find((item) => item.Name === name)?.Value || null;

export class CognitoMemberProvisioner {
  constructor({ userPoolId, region = 'us-east-2', client = new CognitoIdentityProviderClient({ region }) }) {
    if (!userPoolId) throw new Error('Cognito user pool ID is required');
    this.userPoolId = userPoolId;
    this.client = client;
  }

  async invite({ email, givenName, familyName, tenantId, role }) {
    const attributes = [
      { Name: 'email', Value: email },
      { Name: 'email_verified', Value: 'true' },
      { Name: 'given_name', Value: givenName },
      { Name: 'family_name', Value: familyName },
      { Name: 'custom:tenantId', Value: tenantId },
      { Name: 'custom:role', Value: role },
    ];
    try {
      const result = await this.client.send(new AdminCreateUserCommand({
        UserPoolId: this.userPoolId,
        Username: email,
        UserAttributes: attributes,
        DesiredDeliveryMediums: ['EMAIL'],
      }));
      return { identitySubject: attribute(result.User, 'sub'), invitationSent: true };
    } catch (error) {
      if (error?.name !== 'UsernameExistsException') throw error;
      const existing = await this.client.send(new AdminGetUserCommand({ UserPoolId: this.userPoolId, Username: email }));
      return { identitySubject: attribute(existing, 'sub'), invitationSent: false };
    }
  }
}
