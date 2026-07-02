/**
 * Cloud storage module for ClaudeBurrow.
 *
 * Uses the AWS SDK (@aws-sdk/client-s3) with S3-compatible API.
 * Primary target: Cloudflare R2 (free tier: 10GB + 10M ops/month).
 * Also compatible with: AWS S3, MinIO, Backblaze B2, etc.
 *
 * R2-specific notes:
 * - Endpoint format: https://<account-id>.r2.cloudflarestorage.com
 * - Region should be set to 'auto'
 * - ETag-based conditional writes are supported for optimistic locking
 */

const { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');

// ---- Client factory ----

/**
 * Create an S3 client from ClaudeBurrow config.
 *
 * @param {Object} storageConfig - config.storage section
 * @param {string} storageConfig.type - 'r2' | 'oss' | 's3' | 'custom'
 * @param {string} storageConfig.endpoint
 * @param {string} storageConfig.bucket
 * @param {string} storageConfig.accessKeyId
 * @param {string} storageConfig.secretAccessKey
 * @param {string} [storageConfig.region='auto']
 * @returns {S3Client}
 */
function createClient(storageConfig) {
  // forcePathStyle differs by storage backend:
  //   R2:  true  — bucket is in the URL path, not hostname
  //   OSS: false — uses virtual-hosted style (bucket.oss-{region}.aliyuncs.com)
  //   S3:  false — standard virtual-hosted style
  const forcePathStyle = storageConfig.type === 'r2';

  return new S3Client({
    region: storageConfig.region || 'auto',
    endpoint: storageConfig.endpoint,
    credentials: {
      accessKeyId: storageConfig.accessKeyId,
      secretAccessKey: storageConfig.secretAccessKey,
    },
    forcePathStyle,
  });
}

/**
 * Validate storage credentials by attempting a HEAD or LIST operation.
 *
 * @param {Object} storageConfig
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
async function testConnection(storageConfig) {
  const client = createClient(storageConfig);
  try {
    // Lightweight check: list with max 1 key
    await client.send(new ListObjectsV2Command({
      Bucket: storageConfig.bucket,
      MaxKeys: 1,
    }));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ---- Object operations ----

/**
 * Upload an object to the bucket.
 *
 * @param {S3Client} client
 * @param {string} bucket
 * @param {string} key - Object key (path in bucket)
 * @param {Buffer|string} body - Content to upload
 * @param {Object} [options]
 * @param {string} [options.contentType='application/octet-stream']
 * @returns {Promise<{ etag: string, key: string }>}
 */
async function putObject(client, bucket, key, body, options = {}) {
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: options.contentType || 'application/octet-stream',
  });
  const response = await client.send(command);
  return {
    etag: response.ETag ? response.ETag.replace(/"/g, '') : '',
    key,
  };
}

/**
 * Upload with If-Match condition (for optimistic locking).
 * Fails with 412 Precondition Failed if the remote ETag doesn't match.
 *
 * @param {S3Client} client
 * @param {string} bucket
 * @param {string} key
 * @param {Buffer|string} body
 * @param {string} expectedEtag - Expected remote ETag
 * @returns {Promise<{ etag: string, key: string }>}
 * @throws {Error} with code 'PreconditionFailed' if ETag mismatch
 */
async function putObjectIfMatch(client, bucket, key, body, expectedEtag) {
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    IfMatch: expectedEtag,
  });
  try {
    const response = await client.send(command);
    return {
      etag: response.ETag ? response.ETag.replace(/"/g, '') : '',
      key,
    };
  } catch (err) {
    if (err.name === 'PreconditionFailed' || err.$metadata?.httpStatusCode === 412) {
      const preconditionErr = new Error('ETag mismatch — remote has been modified since last read');
      preconditionErr.code = 'PreconditionFailed';
      throw preconditionErr;
    }
    // Aliyun OSS doesn't support If-Match on PutObject (returns NotImplemented).
    // Fall back to unconditional write — acceptable for single-user manual sync.
    if (err.name === 'NotImplemented' || err.Code === 'NotImplemented') {
      // Remove If-Match and retry as a plain put
      const retryCmd = new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
      });
      const retryResp = await client.send(retryCmd);
      return {
        etag: retryResp.ETag ? retryResp.ETag.replace(/"/g, '') : '',
        key,
      };
    }
    throw err;
  }
}

/**
 * Download an object from the bucket.
 *
 * @param {S3Client} client
 * @param {string} bucket
 * @param {string} key
 * @returns {Promise<{ body: Buffer, etag: string, contentType: string }>}
 * @throws {Error} if object not found (code: 'NoSuchKey')
 */
async function getObject(client, bucket, key) {
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  });
  try {
    const response = await client.send(command);
    // Convert stream/body to Buffer
    const chunks = [];
    if (response.Body && typeof response.Body.on === 'function') {
      // Node.js Readable stream
      for await (const chunk of response.Body) {
        chunks.push(chunk);
      }
    } else if (response.Body) {
      // Already a Buffer or Uint8Array
      chunks.push(response.Body);
    }
    return {
      body: Buffer.concat(chunks),
      etag: response.ETag ? response.ETag.replace(/"/g, '') : '',
      contentType: response.ContentType || 'application/octet-stream',
    };
  } catch (err) {
    if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
      const notFoundErr = new Error(`Object not found: ${key}`);
      notFoundErr.code = 'NoSuchKey';
      throw notFoundErr;
    }
    throw err;
  }
}

/**
 * Check if an object exists (HEAD request — no body download).
 *
 * @param {S3Client} client
 * @param {string} bucket
 * @param {string} key
 * @returns {Promise<{ exists: boolean, etag?: string, contentLength?: number }>}
 */
async function headObject(client, bucket, key) {
  try {
    const command = new HeadObjectCommand({ Bucket: bucket, Key: key });
    const response = await client.send(command);
    return {
      exists: true,
      etag: response.ETag ? response.ETag.replace(/"/g, '') : '',
      contentLength: response.ContentLength || 0,
    };
  } catch (err) {
    if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
      return { exists: false };
    }
    throw err;
  }
}

/**
 * List objects under a prefix.
 *
 * @param {S3Client} client
 * @param {string} bucket
 * @param {string} prefix
 * @param {number} [maxKeys=100]
 * @returns {Promise<Array<{ key: string, size: number, etag: string, lastModified: Date }>>}
 */
async function listObjects(client, bucket, prefix, maxKeys = 100) {
  const command = new ListObjectsV2Command({
    Bucket: bucket,
    Prefix: prefix,
    MaxKeys: maxKeys,
  });
  const response = await client.send(command);

  if (!response.Contents) return [];

  return response.Contents.map(obj => ({
    key: obj.Key,
    size: obj.Size || 0,
    etag: obj.ETag ? obj.ETag.replace(/"/g, '') : '',
    lastModified: obj.LastModified || new Date(0),
  }));
}

module.exports = {
  createClient,
  testConnection,
  putObject,
  putObjectIfMatch,
  getObject,
  headObject,
  listObjects,
};
