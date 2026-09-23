import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';

export class AwsConnectorQueue {
  #client;
  #queueUrl;

  constructor({ client, queueUrl }) {
    if (!client?.send) throw new Error('SQS client is required');
    if (!queueUrl) throw new Error('connector queue URL is required');
    this.#client = client;
    this.#queueUrl = queueUrl;
  }

  async enqueue(message) {
    const safe = {
      version: 1,
      jobId: message.jobId,
      tenantId: message.tenantId,
      integrationType: message.integrationType,
      jobType: message.jobType,
      requestedAt: message.requestedAt
    };
    if (message.sessionId) safe.sessionId = message.sessionId;
    if (message.jobType === 'sync') {
      safe.feedGroup = message.feedGroup;
      safe.periodStart = message.periodStart;
      safe.periodEnd = message.periodEnd;
    }
    if (Object.values(safe).some((value) => value == null || value === '')) {
      throw new Error('connector job message is incomplete');
    }
    if (message.jobType === 'connect' && !safe.sessionId) throw new Error('connector session is required');
    await this.#client.send(new SendMessageCommand({
      QueueUrl: this.#queueUrl,
      MessageBody: JSON.stringify(safe),
      MessageGroupId: message.tenantId,
      MessageDeduplicationId: message.jobId
    }));
  }
}

export function createAwsConnectorQueue({ region, queueUrl }) {
  if (!queueUrl) return null;
  return new AwsConnectorQueue({ client: new SQSClient({ region }), queueUrl });
}
