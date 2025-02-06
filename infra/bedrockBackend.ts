import { Construct } from 'constructs';
import { CognitoUserPool } from '@cdktf/provider-aws/lib/cognito-user-pool';
import { S3Bucket } from '@cdktf/provider-aws/lib/s3-bucket';
import { S3Object } from '@cdktf/provider-aws/lib/s3-object';
import { LambdaFunction } from '@cdktf/provider-aws/lib/lambda-function';
import { IamRole } from '@cdktf/provider-aws/lib/iam-role';
import { IamPolicy } from '@cdktf/provider-aws/lib/iam-policy';
import { IamRolePolicyAttachment } from '@cdktf/provider-aws/lib/iam-role-policy-attachment';
import { ApiGatewayRestApi } from '@cdktf/provider-aws/lib/api-gateway-rest-api';
import { ApiGatewayResource } from '@cdktf/provider-aws/lib/api-gateway-resource';
import { ApiGatewayMethod } from '@cdktf/provider-aws/lib/api-gateway-method';
import { ApiGatewayMethodResponse } from '@cdktf/provider-aws/lib/api-gateway-method-response';
import { ApiGatewayIntegration } from '@cdktf/provider-aws/lib/api-gateway-integration';
import { ApiGatewayDeployment } from '@cdktf/provider-aws/lib/api-gateway-deployment';
import { ApiGatewayStage } from '@cdktf/provider-aws/lib/api-gateway-stage';
import { ApiGatewayAuthorizer } from '@cdktf/provider-aws/lib/api-gateway-authorizer';
import { LambdaPermission } from '@cdktf/provider-aws/lib/lambda-permission';
import { DataAwsCallerIdentity } from '@cdktf/provider-aws/lib/data-aws-caller-identity';
import { DataAwsKmsKey } from '@cdktf/provider-aws/lib/data-aws-kms-key';
import { BedrockagentAgent } from '@cdktf/provider-aws/lib/bedrockagent-agent';
import { AcmCertificate } from '@cdktf/provider-aws/lib/acm-certificate';
import { AcmCertificateValidation } from '@cdktf/provider-aws/lib/acm-certificate-validation';
import { Route53Record } from '@cdktf/provider-aws/lib/route53-record';
import { ApiGatewayDomainName } from '@cdktf/provider-aws/lib/api-gateway-domain-name';
import { ApiGatewayBasePathMapping } from '@cdktf/provider-aws/lib/api-gateway-base-path-mapping';
import { TerraformOutput } from 'cdktf';
import { DataAwsRoute53Zone } from '@cdktf/provider-aws/lib/data-aws-route53-zone';
import { ApiGatewayIntegrationResponse } from '@cdktf/provider-aws/lib/api-gateway-integration-response';

// New imports for Bedrock Knowledge Base and OpenSearch Serverless collection
import { BedrockagentKnowledgeBase } from '@cdktf/provider-aws/lib/bedrockagent-knowledge-base';
import { BedrockagentDataSource } from '@cdktf/provider-aws/lib/bedrockagent-data-source';
import { BedrockagentAgentKnowledgeBaseAssociation } from '@cdktf/provider-aws/lib/bedrockagent-agent-knowledge-base-association';
import { OpensearchserverlessCollection } from '@cdktf/provider-aws/lib/opensearchserverless-collection';
import { OpensearchserverlessSecurityPolicy } from '@cdktf/provider-aws/lib/opensearchserverless-security-policy';
import { OpensearchserverlessAccessPolicy } from '@cdktf/provider-aws/lib/opensearchserverless-access-policy';
//import { resource as NullResource } from '@cdktf/provider-null'

export class BedrockBackendStack {
  constructor(scope: Construct, region: string, userPool: CognitoUserPool) {
    // Account & KMS key info
    const callerIdentity = new DataAwsCallerIdentity(scope, 'CallerIdentity');
    const accountId = callerIdentity.accountId;
    const kmsKey = new DataAwsKmsKey(scope, 'DefaultKmsKey', { keyId: 'alias/aws/lambda' });

    // S3 bucket for Lambda code
    const lambdaCodeBucket = new S3Bucket(scope, 'LambdaBedrockBackendCodeBucket', {
      bucket: 'lambda-bedrock-backend-code-bucket',
      acl: 'private',
    });
    new S3Object(scope, 'ChatRAGLambdaCode', {
      bucket: lambdaCodeBucket.bucket,
      key: 'chatRAG.zip',
      source: '/home/runner/work/gudr33dz/gudr33dz/infra/chatRAG.zip',
    });

    // IAM Role for Lambda execution
    const lambdaRole = new IamRole(scope, 'LambdaBedrockBackendExecutionRole', {
      name: 'lambda_bedrock_backend_execution_role',
      assumeRolePolicy: JSON.stringify({
        Version: '2012-10-17',
        Statement: [{
          Effect: 'Allow',
          Principal: { Service: 'lambda.amazonaws.com' },
          Action: 'sts:AssumeRole'
        }],
      }),
    });
    const backendLambdaPolicy = new IamPolicy(scope, 'LambdaBackendPolicy', {
      policy: JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: ['s3:GetObject', 's3:ListBucket'],
            Resource: [
              `arn:aws:s3:::s3datastorebucket`,
              `arn:aws:s3:::s3datastorebucket/*`,
              `${lambdaCodeBucket.arn}/*`,
            ],
          },
          {
            Effect: 'Allow',
            Action: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
            Resource: 'arn:aws:logs:*:*:*',
          },
          {
            Effect: 'Allow',
            Action: ['bedrock:InvokeModel', 'bedrock:InvokeAgent'],
            Resource: '*',
          },
          {
            Effect: 'Allow',
            Action: ['kms:Decrypt', 'kms:Encrypt', 'kms:GenerateDataKey*'],
            Resource: kmsKey.arn,
          },
        ],
      }),
    });
    new IamRolePolicyAttachment(scope, 'LambdaRolePolicyAttachment', {
      policyArn: backendLambdaPolicy.arn,
      role: lambdaRole.name,
    });

    // Create a dedicated IAM role for the Bedrock Knowledge Base with the required trust policy.
    const bedrockRole = new IamRole(scope, 'BedrockAgentRole', {
      name: 'bedrock_agent_backend_role',
      assumeRolePolicy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [{
          Effect: "Allow",
          Principal: { Service: "bedrock.amazonaws.com" },
          Action: "sts:AssumeRole",
          Condition: {
            StringEquals: {
              "aws:SourceAccount": accountId
            },
            ArnLike: {
              "AWS:SourceArn": `arn:aws:bedrock:${region}:${accountId}:knowledge-base/*`
            }
          }
        }]
      }),
    });

    // Encryption Security Policy (for type "encryption" an object with a "Rules" array is expected)
    const securityPolicy = new OpensearchserverlessSecurityPolicy(scope, 'OpensearchSecurityPolicy', {
      name: "example",
      type: "encryption",
      policy: JSON.stringify({
        Rules: [
          {
            Resource: ["collection/example"],
            ResourceType: "collection"
          }
        ],
        AWSOwnedKey: true
      })
    });

    // Create an OpenSearch Serverless collection.
    const opensearchCollection = new OpensearchserverlessCollection(scope, 'OpensearchCollection', {
      name: 'example',
      description: 'OpenSearch Serverless collection for Bedrock Knowledge Base',
      type: 'SEARCH',
      tags: {
        Environment: 'prod',
        Project: 'BedrockKnowledgeBase',
      },
      dependsOn: [securityPolicy],
    });
    

    // 2. Use a null_resource with a local-exec to create your index
    /*const createIndex = new NullResource.Resource(scope, 'CreateOpenSearchIndex', {
      provisioners: [
        {
          type: "local-exec",
          command: `
              # Example using AWS CLI. Adjust your index settings/mappings as needed.
              aws opensearchserverless create-index \\
                --name example \\
                --type search \\
                --collection ${opensearchCollection.name} \\
                --region ${region} \\
                --schema '{
                  "mappings": {
                    "properties": {
                      "name": {"type": "text"}
                    }
                  },
                  "settings": {
                    "index": {
                      "number_of_shards": 1,
                      "number_of_replicas": 1
                    }
                  }
                }'
            `,
          },
      ],
    });

    // Make sure the NullResource waits for the collection to be ready
    createIndex.node.addDependency(opensearchCollection);
*/
    // Network Policy for OpenSearch Serverless allowing access from Bedrock.
    const opensearchNetworkPolicy = new OpensearchserverlessSecurityPolicy(scope, 'OpensearchNetworkPolicy', {
      name: 'opensearch-network-policy',
      type: 'network',
      policy: JSON.stringify([
        {
          Rules: [
            {
              Resource: ["collection/example"],
              ResourceType: "collection"
            }
          ],
          SourceServices: ["bedrock.amazonaws.com"]
        }
      ])
    });    
    

     // Data Access Policy for OpenSearch Serverless (type "data") that controls user access to collections and indexes.
     const opensearchDataAccessPolicy = new OpensearchserverlessAccessPolicy(scope, 'OpensearchDataAccessPolicy', {
      name: 'opensearch-data-access-policy',
      type: 'data',
      policy: JSON.stringify({
        Rules: [
          {
            Effect: "Allow",
            Actions: [
              "aoss:ESHttpGet",
              "aoss:ESHttpPost",
              "aoss:ESHttpPut",
              "aoss:ESHttpDelete",
              "aoss:ESHttpHead",
              "aoss:CreateCollectionItems",
              "aoss:DeleteCollectionItems",
              "aoss:UpdateCollectionItems",
              "aoss:DescribeCollectionItems"
            ],
            Principal: { AWS: "*" },
            Resource: [
              `arn:aws:aoss:${region}:${accountId}:collection/${opensearchCollection.id}`,
              `arn:aws:aoss:${region}:${accountId}:index/${opensearchCollection.id}/*`
            ]
          }
        ]
      })
    });
    
    // Attach a policy to the Bedrock service role.
    const bedrockPolicy = new IamPolicy(scope, 'BedrockAgentPolicy', {
      policy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Action: [
              "opensearchserverless:ESHttpPost",
              "opensearchserverless:ESHttpPut",
              "opensearchserverless:ESHttpGet",
              "opensearchserverless:ESHttpDelete",
              "opensearchserverless:ESHttpHead",
              "opensearchserverless:ListCollections",
              "opensearchserverless:UpdateCollection",
              "opensearchserverless:ListSecurityConfigs",
              "opensearchserverless:UpdateSecurityConfig"
            ],
            Resource: "*"
          },
          {
            Effect: "Allow",
            Action: ["aoss:APIAccessAll"],
            Resource: `arn:aws:aoss:${region}:${accountId}:collection/${opensearchCollection.id}`
          },
          {
            Effect: "Allow",
            Action: ["kms:Decrypt", "kms:Encrypt", "kms:GenerateDataKey*"],
            Resource: kmsKey.arn
          }
        ]
      })
    });
    new IamRolePolicyAttachment(scope, 'BedrockRolePolicyAttachment', {
      role: bedrockRole.name,
      policyArn: bedrockPolicy.arn,
    });


    // Bedrock Agent using the Haiku Anthropic model.
    const bedrockAgent = new BedrockagentAgent(scope, 'BedrockBackendAgent', {
      agentName: 'chatbot-agent',
      agentResourceRoleArn: lambdaRole.arn,
      foundationModel: 'anthropic.claude-3-haiku-20240307-v1:0',
      instruction: 'you are a chatbot agent expert in recommending books with a snarky attitude, expressed in haiku'
    });

    // Bedrock Knowledge Base using OpenSearch Serverless as the vector DB.
    const knowledgeBase = new BedrockagentKnowledgeBase(scope, 'ExampleKnowledgeBase', {
      name: "example",
      roleArn: bedrockRole.arn,
      knowledgeBaseConfiguration: [{
        type: "VECTOR",
        vectorKnowledgeBaseConfiguration: [{
          embeddingModelArn: "arn:aws:bedrock:eu-central-1::foundation-model/amazon.titan-embed-text-v2:0"
        }]
      }],
      storageConfiguration: [{
        type: "OPENSEARCH_SERVERLESS",
        opensearchServerlessConfiguration: [{
          collectionArn: opensearchCollection.arn,
          vectorIndexName: "example",
          fieldMapping: [{
            vectorField: "bedrock-knowledge-base-default-vector",
            textField: "AMAZON_BEDROCK_TEXT_CHUNK",
            metadataField: "AMAZON_BEDROCK_METADATA"
          }]
        }]
      }]
    });
    // Ensure the knowledge base depends on the collection and both security policies.
    knowledgeBase.node.addDependency(opensearchCollection, opensearchNetworkPolicy, opensearchDataAccessPolicy);

    // Create a data source pointing to the S3 datastore bucket.
    new BedrockagentDataSource(scope, 's3datastorebucketDataSource', {
      knowledgeBaseId: knowledgeBase.id,
      name: "DataSource",
      dataSourceConfiguration: [{
        type: "S3",
        s3Configuration: [{
          bucketArn: "arn:aws:s3:::s3datastorebucket"
        }]
      }]
    });

    // Associate the Bedrock agent with the Knowledge Base and its data source.
    new BedrockagentAgentKnowledgeBaseAssociation(scope, 'AgentKnowledgeBaseAssociation', {
      agentId: bedrockAgent.id,
      knowledgeBaseId: knowledgeBase.id,
      description: "Example Knowledge base",
      knowledgeBaseState: "ENABLED"
    });

    // Simplified Lambda function.
    const lambdaBackend = new LambdaFunction(scope, 'BackendLambda', {
      functionName: 'chatbot-backend',
      runtime: 'nodejs18.x',
      handler: 'index.handler',
      role: lambdaRole.arn,
      s3Bucket: lambdaCodeBucket.bucket,
      s3Key: 'chatRAG.zip',
      timeout: 20,
      kmsKeyArn: kmsKey.arn,
      environment: {
        variables: {
          S3_BUCKET_NAME: 's3datastorebucket',
          BEDROCK_AGENT_NAME: bedrockAgent.agentName
        }
      }
    });

    // API Gateway with Cognito OAuth authorizer.
    const api = new ApiGatewayRestApi(scope, 'ApiGateway', {
      name: 'ChatbotAPI',
      endpointConfiguration: { types: ['REGIONAL'] }
    });
    new LambdaPermission(scope, 'ApiGatewayInvokePermission', {
      action: 'lambda:InvokeFunction',
      functionName: lambdaBackend.functionName,
      principal: 'apigateway.amazonaws.com',
      sourceArn: `arn:aws:execute-api:${region}:${accountId}:${api.id}/*/*`
    });
    const apiResource = new ApiGatewayResource(scope, 'ApiResource', {
      parentId: api.rootResourceId,
      pathPart: 'chat',
      restApiId: api.id
    });
    const authorizer = new ApiGatewayAuthorizer(scope, 'CognitoAuthorizer', {
      name: 'CognitoAuthorizer',
      restApiId: api.id,
      type: 'COGNITO_USER_POOLS',
      providerArns: [userPool.arn],
      identitySource: 'method.request.header.Authorization'
    });
    const apiMethodOPTIONS = new ApiGatewayMethod(scope, 'ApiMethodOPTIONS', {
      httpMethod: 'OPTIONS',
      resourceId: apiResource.id,
      restApiId: api.id,
      authorization: 'NONE'
    });
    const apiIntegrationOPTIONS = new ApiGatewayIntegration(scope, 'ApiIntegrationOPTIONS', {
      restApiId: api.id,
      resourceId: apiResource.id,
      httpMethod: apiMethodOPTIONS.httpMethod,
      type: 'MOCK',
      integrationHttpMethod: 'OPTIONS',
      requestTemplates: { 'application/json': '{"statusCode": 200}' }
    });
    const optionsMethodResponse = new ApiGatewayMethodResponse(scope, 'OptionsMethodResponse', {
      restApiId: api.id,
      resourceId: apiResource.id,
      httpMethod: 'OPTIONS',
      statusCode: '200',
      responseParameters: {
        'method.response.header.Access-Control-Allow-Origin': true,
        'method.response.header.Access-Control-Allow-Headers': true,
        'method.response.header.Access-Control-Allow-Methods': true
      },
      dependsOn: [apiMethodOPTIONS, apiIntegrationOPTIONS]
    });
    new ApiGatewayIntegrationResponse(scope, 'OptionsIntegrationResponse', {
      restApiId: api.id,
      resourceId: apiResource.id,
      httpMethod: 'OPTIONS',
      statusCode: '200',
      responseParameters: {
        'method.response.header.Access-Control-Allow-Origin': "'*'",
        'method.response.header.Access-Control-Allow-Headers': "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'",
        'method.response.header.Access-Control-Allow-Methods': "'POST,OPTIONS'"
      },
      responseTemplates: {
        'application/json': ''
      },
      dependsOn: [apiMethodOPTIONS, apiIntegrationOPTIONS, optionsMethodResponse]
    });
    const apiMethodPOST = new ApiGatewayMethod(scope, 'ApiMethodPOST', {
      httpMethod: 'POST',
      resourceId: apiResource.id,
      restApiId: api.id,
      authorization: 'COGNITO_USER_POOLS',
      authorizerId: authorizer.id
    });
    const apiIntegrationPOST = new ApiGatewayIntegration(scope, 'ApiIntegrationPOST', {
      restApiId: api.id,
      resourceId: apiResource.id,
      httpMethod: apiMethodPOST.httpMethod,
      type: 'AWS_PROXY',
      integrationHttpMethod: 'POST',
      uri: `arn:aws:apigateway:${region}:lambda:path/2015-03-31/functions/${lambdaBackend.arn}/invocations`
    });
    const deployment = new ApiGatewayDeployment(scope, 'ApiDeployment', {
      restApiId: api.id,
      triggers: { redeployment: `${new Date().toISOString()}` },
      dependsOn: [apiMethodPOST, apiMethodOPTIONS, apiIntegrationPOST, apiIntegrationOPTIONS]
    });
    const stage = new ApiGatewayStage(scope, 'ApiStage', {
      restApiId: api.id,
      deploymentId: deployment.id,
      stageName: 'prod'
    });
    const customDomain = 'api.not-a-wise.click';
    const customApiCertificate = new AcmCertificate(scope, 'CustomApiAcmCertificate', {
      domainName: customDomain,
      validationMethod: 'DNS'
    });
    const hostedZoneForCustomDomain = new DataAwsRoute53Zone(scope, 'ExistingCustomHostedZone', {
      name: 'not-a-wise.click',
      privateZone: false
    });
    const validationRecord = new Route53Record(scope, 'CustomCertValidationRecord', {
      zoneId: hostedZoneForCustomDomain.zoneId,
      ttl: 300,
      allowOverwrite: true,
      name: `\${each.value.name}`,
      type: `\${each.value.type}`,
      records: [ `\${each.value.record}` ]
    });
    validationRecord.addOverride(
      'for_each',
      `\${{
        for dvo in ${customApiCertificate.fqn}.domain_validation_options : dvo.domain_name => {
          name   = dvo.resource_record_name,
          record = dvo.resource_record_value,
          type   = dvo.resource_record_type
        }
      }}`
    );
    const acmValidation = new AcmCertificateValidation(scope, 'ApiCertValidation', {
      certificateArn: customApiCertificate.arn
    });
    acmValidation.addOverride(
      'validation_record_fqdns',
      `\${[for record in ${validationRecord.fqn} : record.fqdn]}`
    );
    const apiGatewayCustomDomain = new ApiGatewayDomainName(scope, 'ApiGatewayCustomDomain', {
      domainName: customDomain,
      regionalCertificateArn: customApiCertificate.arn,
      endpointConfiguration: { types: ['REGIONAL'] },
      dependsOn: [acmValidation]
    });
    new Route53Record(scope, 'ApiGatewayAliasRecord', {
      name: customDomain,
      type: 'A',
      zoneId: hostedZoneForCustomDomain.zoneId,
      alias: {
        name: apiGatewayCustomDomain.regionalDomainName,
        zoneId: apiGatewayCustomDomain.regionalZoneId,
        evaluateTargetHealth: false
      },
      dependsOn: [apiGatewayCustomDomain]
    });
    new ApiGatewayBasePathMapping(scope, 'ApiGatewayBasePathMapping', {
      domainName: apiGatewayCustomDomain.domainName,
      apiId: api.id,
      stageName: stage.stageName
    });
    new TerraformOutput(scope, 'custom_api_gateway_url', {
      value: `https://${customDomain}/chat`
    });
    new TerraformOutput(scope, 'api_gateway_url', {
      value: `https://${api.id}.execute-api.${region}.amazonaws.com/prod/chat`
    });
  }
}
