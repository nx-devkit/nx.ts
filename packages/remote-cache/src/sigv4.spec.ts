import { describe, expect, it } from 'vitest';
import { signRequest } from './sigv4.ts';

// AWS SigV4 documented test vector (GET iam.amazonaws.com ListUsers).
// https://docs.aws.amazon.com/general/latest/gr/sigv4-create-canonical-request.html
const CREDS = {
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
};

describe('signRequest', () => {
  it('produces the AWS documented signature for the canonical example', () => {
    const headers = signRequest({
      method: 'GET',
      host: 'iam.amazonaws.com',
      path: '/',
      query: 'Action=ListUsers&Version=2010-05-08',
      region: 'us-east-1',
      service: 'iam',
      headers: { 'content-type': 'application/x-www-form-urlencoded; charset=utf-8' },
      payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      credentials: CREDS,
      now: new Date('2015-08-30T12:36:00Z'),
    });

    expect(headers['X-Amz-Date']).toBe('20150830T123600Z');
    expect(headers['Authorization']).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/iam/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7',
    );
  });

  it('includes x-amz-content-sha256 and session token when present', () => {
    const headers = signRequest({
      method: 'PUT',
      host: 'bucket.s3.us-east-1.amazonaws.com',
      path: '/key',
      query: '',
      region: 'us-east-1',
      service: 's3',
      headers: {},
      payloadHash: 'abc123',
      credentials: { ...CREDS, sessionToken: 'sess' },
      now: new Date('2026-01-01T00:00:00Z'),
    });
    expect(headers['x-amz-content-sha256']).toBe('abc123');
    expect(headers['x-amz-security-token']).toBe('sess');
    expect(headers['Authorization']).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20260101/us-east-1/s3/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date;x-amz-security-token, Signature=51de0c9adc0e4944740c6bf397a02637c09a29a6b1fe3e45d889ac2bd5da2637',
    );
  });
});
