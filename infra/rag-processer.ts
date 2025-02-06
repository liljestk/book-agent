import {
    lambdaFunction,
    iamRole,
    iamRolePolicy,
    s3BucketNotification,
    lambdaPermission,
    s3Bucket,
  } from "@cdktf/provider-aws";
import { S3Object } from "@cdktf/provider-aws/lib/s3-object";
  import { Construct } from "constructs";
  
  export class RAGProcessor {
    constructor(scope: Construct) {
      // Source bucket containing files for the RAG model
      const existingBucketName = "s3datastorebucket";
      const existingDynamoTable = "RagMetadata";
  
      // --- S3 Buckets to host Lambda code (uploaded via GitHub Action) ---
      const agentLambdaBucket = new s3Bucket.S3Bucket(scope, "AgentLambdaBucket", {
        bucket: "agent-lambda-code-bucket",
      });

      new S3Object(scope, 'agentLambdaCode', {
            bucket: agentLambdaBucket.bucket,
            key: 'agentLambda.zip',
            source: '/home/runner/work/gudr33dz/gudr33dz/infra/agentLambda.zip',
          });
  
      const processingLambdaBucket = new s3Bucket.S3Bucket(scope, "ProcessingLambdaBucket", {
        bucket: "processing-lambda-code-bucket",
      });

      new S3Object(scope, 'processingLambdaCode', {
            bucket: processingLambdaBucket.bucket,
            key: 'processingLambda.zip',
            source: '/home/runner/work/gudr33dz/gudr33dz/infra/processingLambda.zip',
          });
  
      // --- Processing Lambda IAM Role ---
      const processingLambdaRole = new iamRole.IamRole(scope, "ProcessingLambdaRole", {
        name: "processingLambdaRole",
        assumeRolePolicy: JSON.stringify({
          Version: "2012-10-17",
          Statement: [{
            Action: "sts:AssumeRole",
            Principal: { Service: "lambda.amazonaws.com" },
            Effect: "Allow",
          }],
        }),
      });
  
      new iamRolePolicy.IamRolePolicy(scope, "ProcessingLambdaPolicy", {
        name: "processingLambdaPolicy",
        role: processingLambdaRole.name,
        policy: JSON.stringify({
          Version: "2012-10-17",
          Statement: [
            // Allow reading individual objects…
            {
              Action: ["s3:GetObject"],
              Resource: `arn:aws:s3:::${existingBucketName}/*`,
              Effect: "Allow",
            },
            // …and listing the bucket so the Lambda can process all files
            {
              Action: ["s3:ListBucket"],
              Resource: `arn:aws:s3:::${existingBucketName}`,
              Effect: "Allow",
            },
            {
              Action: ["dynamodb:PutItem"],
              Resource: `arn:aws:dynamodb:*:*:table/${existingDynamoTable}`,
              Effect: "Allow",
            },
            {
              Action: ["lambda:InvokeFunction"],
              Resource: "*",
              Effect: "Allow",
            },
            {
              Action: [
                "logs:CreateLogGroup",
                "logs:CreateLogStream",
                "logs:PutLogEvents",
              ],
              Resource: "*",
              Effect: "Allow",
            },
          ],
        }),
      });
  
      // --- Agent Lambda IAM Role ---
      const agentLambdaRole = new iamRole.IamRole(scope, "AgentLambdaRole", {
        name: "agentLambdaRole",
        assumeRolePolicy: JSON.stringify({
          Version: "2012-10-17",
          Statement: [{
            Action: "sts:AssumeRole",
            Principal: { Service: "lambda.amazonaws.com" },
            Effect: "Allow",
          }],
        }),
      });
  
      new iamRolePolicy.IamRolePolicy(scope, "AgentLambdaPolicy", {
        name: "agentLambdaPolicy",
        role: agentLambdaRole.name,
        policy: JSON.stringify({
          Version: "2012-10-17",
          Statement: [{
            Action: [
              "logs:CreateLogGroup",
              "logs:CreateLogStream",
              "logs:PutLogEvents",
            ],
            Resource: "*",
            Effect: "Allow",
          }],
        }),
      });
  
      // --- Agent Lambda Function using code from S3 ---
      const agentLambda = new lambdaFunction.LambdaFunction(scope, "AgentLambda", {
        functionName: "agentLambda",
        runtime: "nodejs18.x",
        handler: "index.handler",
        role: agentLambdaRole.arn,
        s3Bucket: agentLambdaBucket.bucket,
        s3Key: "agentLambda.zip",
        dependsOn: [agentLambdaBucket],
      });
  
      // --- Processing Lambda Function using code from S3 ---
      const processingLambda = new lambdaFunction.LambdaFunction(scope, "ProcessingLambda", {
        functionName: "processingLambda",
        runtime: "nodejs18.x",
        handler: "index.handler",
        role: processingLambdaRole.arn,
        s3Bucket: processingLambdaBucket.bucket,
        s3Key: "processingLambda.zip",
        environment: {
          variables: {
            TABLE_NAME: existingDynamoTable,
            BUCKET_NAME: existingBucketName, // bucket with files for RAG model
            AGENT_LAMBDA_NAME: agentLambda.functionName,
          },
        },
      });
  
      // Trigger processing Lambda on new files
      new s3BucketNotification.S3BucketNotification(scope, "S3Notification", {
        bucket: existingBucketName,
        lambdaFunction: [{
          events: ["s3:ObjectCreated:*"],
          lambdaFunctionArn: processingLambda.arn,
        }],
      });
      
      // Allow S3 to invoke the processing Lambda
      new lambdaPermission.LambdaPermission(scope, "S3InvokePermission", {
        statementId: "AllowS3Invoke",
        action: "lambda:InvokeFunction",
        functionName: processingLambda.functionName,
        principal: "s3.amazonaws.com",
        sourceArn: `arn:aws:s3:::${existingBucketName}`,
      });
    }
  }
  