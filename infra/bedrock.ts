import { Construct } from 'constructs';
import { S3Bucket } from '@cdktf/provider-aws/lib/s3-bucket';
import { S3Object } from '@cdktf/provider-aws/lib/s3-object';
import { IamRole } from '@cdktf/provider-aws/lib/iam-role';
import { IamRolePolicy } from '@cdktf/provider-aws/lib/iam-role-policy';
import { LambdaFunction } from '@cdktf/provider-aws/lib/lambda-function';
import { LambdaPermission } from '@cdktf/provider-aws/lib/lambda-permission';
import { BedrockagentAgent } from '@cdktf/provider-aws/lib/bedrockagent-agent';
import { BedrockagentAgentActionGroup } from '@cdktf/provider-aws/lib/bedrockagent-agent-action-group';

export class BedrockAgentStack {
  public storeBucket: S3Bucket;
  constructor(scope: Construct) {
    // S3 bucket for Lambda deployment package
    const lambdaCodeBucket = new S3Bucket(scope, 'LambdaBedrockAgentCodeBucket', {
      bucket: 'lambda-bedrock-agent-code-bucket',
      acl: 'private',
    });
    new S3Object(scope, 'FileMoverLambdaCode', {
      bucket: lambdaCodeBucket.bucket,
      key: 'fileMover.zip',
      source: '/home/runner/work/gudr33dz/gudr33dz/infra/fileMover.zip',
    });

    // Data buckets
    const ingestBucket = new S3Bucket(scope, 'S3IngestBucket', {
      bucket: 's3ingestbucket',
      acl: 'private',
    });
    this.storeBucket = new S3Bucket(scope, 'S3DataStoreBucket', {
      bucket: 's3datastorebucket',
      acl: 'private',
    });

    // Bedrock Agent Role – assumed by bedrock.amazonaws.com
    const bedrockAgentRole = new IamRole(scope, 'BedrockBackendAgentRole', {
      name: 'bedrock-mover-agent-role',
      assumeRolePolicy: JSON.stringify({
        Version: '2012-10-17',
        Statement: [{
          Effect: 'Allow',
          Principal: { Service: 'bedrock.amazonaws.com' },
          Action: 'sts:AssumeRole',
        }],
      }),
    });
    new IamRolePolicy(scope, 'BedrockAgentS3Policy', {
      name: 'bedrock-agent-s3-policy',
      role: bedrockAgentRole.name,
      policy: JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          // Bucket-level permissions for listing
          {
            Effect: 'Allow',
            Action: ['s3:ListBucket'],
            Resource: [
              ingestBucket.arn,
              this.storeBucket.arn,
              lambdaCodeBucket.arn,
            ],
          },
          {
            Action: ['bedrock:InvokeModel','bedrock:InvokeAgent'],
            Effect: 'Allow',
            Resource: '*'
          },
          // Object-level permissions for Get/Put
          {
            Effect: 'Allow',
            Action: ['s3:GetObject', 's3:PutObject'],
            Resource: [
              `${ingestBucket.arn}/*`,
              `${this.storeBucket.arn}/*`,
              `${lambdaCodeBucket.arn}/*`,
            ],
          },
          {
            Effect: 'Allow',
            Action: ['s3:ListBucket'],
            Resource: [
              `${ingestBucket.arn}`,
            ],
          },
        ],
      }),
    });

    // Lambda Role – assumed by lambda.amazonaws.com
    const lambdaRole = new IamRole(scope, 'LambdaExecutionRole', {
      name: 'lambda-bedrock-agent-execution-role',
      assumeRolePolicy: JSON.stringify({
        Version: '2012-10-17',
        Statement: [{
          Effect: 'Allow',
          Principal: { Service: 'lambda.amazonaws.com' },
          Action: 'sts:AssumeRole',
        }],
      }),
    });
    new IamRolePolicy(scope, 'LambdaBedrockPolicy', {
      role: lambdaRole.name,
      policy: JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          // S3 access for objects
          {
            Effect: 'Allow',
            Action: ['s3:GetObject', 's3:PutObject'],
            Resource: [
              `${ingestBucket.arn}/*`,
              `${this.storeBucket.arn}/*`,
              `${lambdaCodeBucket.arn}/*`,
            ],
          },
          // CloudWatch Logs for Lambda logging
          {
            Effect: 'Allow',
            Action: [
              'logs:CreateLogGroup',
              'logs:CreateLogStream',
              'logs:PutLogEvents'
            ],
            Resource: 'arn:aws:logs:*:*:*',
          },
          // Allow invoking the specific Lambda and bedrock actions
          {
            Effect: 'Allow',
            Action: ['bedrock:InvokeModel', 'bedrock:InvokeAgent', 'lambda:InvokeFunction'],
            Resource: ['arn:aws:lambda:eu-central-1:686255962392:function:move-files-lambda'],
          },
          {
            Effect: 'Allow',
            Action: ['s3:ListBucket'],
            Resource: [
              `${lambdaCodeBucket.arn}`,
            ],
          },
        ],
      }),
    });

    // Lambda function for file moving
    const moveFilesLambda = new LambdaFunction(scope, 'MoveFilesLambda', {
      functionName: 'move-files-lambda',
      runtime: 'nodejs18.x',
      handler: 'index.handler',
      role: lambdaRole.arn,
      s3Bucket: lambdaCodeBucket.bucket,
      s3Key: 'fileMover.zip',
      environment: {
        variables: {
          SOURCE_BUCKET: ingestBucket.bucket,
          DEST_BUCKET: this.storeBucket.bucket,
        },
      },
    });

    // Allow bedrock.amazonaws.com to invoke the Lambda function
    new LambdaPermission(scope, 'BedrockAgentInvokePermission', {
      action: 'lambda:InvokeFunction',
      functionName: moveFilesLambda.functionName,
      principal: 'bedrock.amazonaws.com',
    });

    // Bedrock Agent using the specified function and role
    const bedrockAgent = new BedrockagentAgent(scope, 'BedrockAgent', {
      agentName: 'bedrock-agent',
      agentResourceRoleArn: bedrockAgentRole.arn,
      foundationModel: 'anthropic.claude-3-haiku-20240307-v1:0',
      instruction: 'you are an agent that moves files from one S3 bucket to another',
    });

    // Agent Action Group configuration
    new BedrockagentAgentActionGroup(scope, 'AgentActionGroup', {
      agentId: bedrockAgent.id,
      actionGroupName: 'bedrock-agent-action-group',
      agentVersion: 'DRAFT', // Use a valid agent version
      actionGroupExecutor: [{ lambda: moveFilesLambda.arn }],
      functionSchema: [{
        memberFunctions: [{
          functions: [{
            name: "moveFiles",
            description: "Moves files from sourceBucket to destinationBucket.",
            parameters: [
              {
                mapBlockKey: "sourceBucket",
                type: "string",
                description: "The name of the source bucket.",
                required: true,
              },
              {
                mapBlockKey: "destinationBucket",
                type: "string",
                description: "The name of the destination bucket.",
                required: true,
              },
            ],
          }],
        }],
      }],
    });
  }
}
