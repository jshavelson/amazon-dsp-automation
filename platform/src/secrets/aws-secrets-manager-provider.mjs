import { CreateSecretCommand, GetSecretValueCommand, PutSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

export class AwsSecretsManagerProvider {
  #audit;
  #client;
  #prefix;

  constructor({ client, audit, prefix = 'dsp-platform' }) {
    if (!client?.send) throw new Error('Secrets Manager client is required');
    if (typeof audit !== 'function') throw new Error('secret access audit writer is required');
    this.#client = client;
    this.#audit = audit;
    this.#prefix = prefix.replace(/^\/+|\/+$/g, '');
  }

  async read(parsed, context) {
    if (parsed.provider !== 'aws') throw new Error('secret reference provider must be aws');
    const secretId = `${this.#prefix}/${parsed.tenantId}/${parsed.integration}/${parsed.name}`;
    await this.#audit({
      tenantId: context.tenantId,
      action: 'secret.read',
      provider: 'aws',
      integration: parsed.integration,
      secretName: parsed.name,
      purpose: context.purpose
    });
    const response = await this.#client.send(new GetSecretValueCommand({ SecretId: secretId, VersionStage: 'AWSCURRENT' }));
    if (typeof response.SecretString === 'string') return response.SecretString;
    if (response.SecretBinary) return Buffer.from(response.SecretBinary).toString('utf8');
    throw new Error('Secrets Manager returned no current secret value');
  }

  async write(parsed, context) {
    if (parsed.provider !== 'aws') throw new Error('secret reference provider must be aws');
    if (typeof context.value !== 'string' || context.value.length === 0) throw new Error('secret value is required');
    const secretId = `${this.#prefix}/${parsed.tenantId}/${parsed.integration}/${parsed.name}`;
    await this.#audit({
      tenantId: context.tenantId,
      actorSubject: context.actorSubject,
      action: 'secret.write',
      provider: 'aws',
      integration: parsed.integration,
      secretName: parsed.name,
      purpose: context.purpose
    });
    try {
      await this.#client.send(new PutSecretValueCommand({ SecretId: secretId, SecretString: context.value }));
    } catch (error) {
      if (error?.name !== 'ResourceNotFoundException') throw error;
      await this.#client.send(new CreateSecretCommand({
        Name: secretId,
        SecretString: context.value,
        Description: 'Tenant-managed connector credential bundle'
      }));
    }
    return parsed.value;
  }
}

export function createAwsSecretsManagerProvider({ region, audit, prefix }) {
  if (!region) throw new Error('AWS region is required');
  return new AwsSecretsManagerProvider({
    client: new SecretsManagerClient({ region }),
    audit,
    prefix
  });
}
