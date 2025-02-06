const {
  S3Client,
  ListObjectsV2Command,
  CopyObjectCommand,
  DeleteObjectCommand,
} = require('@aws-sdk/client-s3');
const s3Client = new S3Client();

exports.handler = async (event) => {
  console.log('Event:', JSON.stringify(event, null, 2));

  // Get bucket names from event parameters (fallback to env variables)
  let sourceBucket = process.env.SOURCE_BUCKET;
  let destinationBucket = process.env.DEST_BUCKET;

  if (event.parameters && Array.isArray(event.parameters)) {
    for (const param of event.parameters) {
      if (param.name === 'sourceBucket' && param.value) {
        sourceBucket = param.value;
      }
      if (param.name === 'destinationBucket' && param.value) {
        destinationBucket = param.value;
      }
    }
  }

  if (!sourceBucket || !destinationBucket) {
    throw new Error('Missing sourceBucket or destinationBucket parameter');
  }

  // List all objects in the source bucket
  let continuationToken;
  const objects = [];

  do {
    const listResponse = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: sourceBucket,
        ContinuationToken: continuationToken,
      })
    );

    if (listResponse.Contents) {
      objects.push(...listResponse.Contents);
    }
    continuationToken = listResponse.IsTruncated ? listResponse.NextContinuationToken : undefined;
  } while (continuationToken);

  console.log(`Found ${objects.length} object(s) in ${sourceBucket}`);

  // Process each object: copy then delete
  for (const obj of objects) {
    try {
      const key = decodeURIComponent(obj.Key.replace(/\+/g, ' '));

      // Copy the object to the destination bucket
      await s3Client.send(
        new CopyObjectCommand({
          CopySource: `${sourceBucket}/${key}`,
          Bucket: destinationBucket,
          Key: key,
        })
      );
      console.log(`Copied ${key} from ${sourceBucket} to ${destinationBucket}`);

      // Delete the object from the source bucket
      await s3Client.send(
        new DeleteObjectCommand({
          Bucket: sourceBucket,
          Key: key,
        })
      );
      console.log(`Deleted ${key} from ${sourceBucket}`);
    } catch (err) {
      console.error(`Error processing file ${obj.Key}: ${err.message}`);
      // Decide if you want to continue processing or throw the error
      // throw err;
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ message: 'File processing complete' }),
  };
};
