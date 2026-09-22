import assert from 'node:assert/strict';
import test from 'node:test';
import { CognitoMemberProvisioner } from '../src/auth/cognito-member-provisioner.mjs';

test('creates a Cognito user with tenant and role attributes', async () => {
  const sent = [];
  const client = { async send(command) { sent.push(command.input); return { User: { UserAttributes: [{ Name: 'sub', Value: 'sub-1' }] } }; } };
  const provisioner = new CognitoMemberProvisioner({ userPoolId: 'pool-1', client });
  const result = await provisioner.invite({ email: 'alex@example.com', givenName: 'Alex', familyName: 'Driver', tenantId: 'jecs', role: 'viewer' });
  assert.deepEqual(result, { identitySubject: 'sub-1', invitationSent: true });
  assert.equal(sent[0].Username, 'alex@example.com');
  assert.ok(sent[0].UserAttributes.some((item) => item.Name === 'custom:tenantId' && item.Value === 'jecs'));
  assert.ok(sent[0].UserAttributes.some((item) => item.Name === 'custom:role' && item.Value === 'viewer'));
});

test('reuses an existing Cognito identity without sending another invitation', async () => {
  let call = 0;
  const client = { async send() { call += 1; if (call === 1) throw Object.assign(new Error('exists'), { name: 'UsernameExistsException' }); return { UserAttributes: [{ Name: 'sub', Value: 'sub-existing' }] }; } };
  const provisioner = new CognitoMemberProvisioner({ userPoolId: 'pool-1', client });
  assert.deepEqual(await provisioner.invite({ email: 'alex@example.com', givenName: 'Alex', familyName: 'Driver', tenantId: 'jecs', role: 'viewer' }), { identitySubject: 'sub-existing', invitationSent: false });
});
