import { Construct } from 'constructs';
import { ApiGatewayRestApi } from '@cdktf/provider-aws/lib/api-gateway-rest-api';
import { ApiGatewayResource } from '@cdktf/provider-aws/lib/api-gateway-resource';
import { ApiGatewayMethod } from '@cdktf/provider-aws/lib/api-gateway-method';
import { ApiGatewayDeployment } from '@cdktf/provider-aws/lib/api-gateway-deployment';
import { ApiGatewayStage } from '@cdktf/provider-aws/lib/api-gateway-stage';
import { ApiGatewayIntegration } from '@cdktf/provider-aws/lib/api-gateway-integration';
import { ApiGatewayMethodResponse } from '@cdktf/provider-aws/lib/api-gateway-method-response';
import { ApiGatewayIntegrationResponse } from '@cdktf/provider-aws/lib/api-gateway-integration-response';
import { LambdaPermission } from '@cdktf/provider-aws/lib/lambda-permission';
import { LambdaFunction } from '@cdktf/provider-aws/lib/lambda-function';

export class ApiGatewayStack {
  constructor(scope: Construct, region: string, accountId: string, lambda: LambdaFunction) {
    // Create the REST API
    const api = new ApiGatewayRestApi(scope, 'ApiGateway', {
      name: 'ChatbotAPI',
    });

    // Create the /chat resource
    const chatResource = new ApiGatewayResource(scope, 'ApiResource', {
      parentId: api.rootResourceId,
      pathPart: 'chat',
      restApiId: api.id,
    });

    // Create the OPTIONS method
    const optionsMethod = new ApiGatewayMethod(scope, 'ApiMethodOPTIONS', {
      httpMethod: 'OPTIONS',
      resourceId: chatResource.id,
      restApiId: api.id,
      authorization: 'NONE',
    });

    // Create the OPTIONS integration
    new ApiGatewayIntegration(scope, 'ApiIntegrationOPTIONS', {
      restApiId: api.id,
      resourceId: chatResource.id,
      httpMethod: optionsMethod.httpMethod,
      type: 'MOCK',
      integrationHttpMethod: 'OPTIONS',
      requestTemplates: {
        'application/json': '{"statusCode": 200}',
      },
    });

    // Define the Method Response for OPTIONS
    new ApiGatewayMethodResponse(scope, 'OptionsMethodResponse', {
      restApiId: api.id,
      resourceId: chatResource.id,
      httpMethod: optionsMethod.httpMethod,
      statusCode: '200',
      responseParameters: {
        'method.response.header.Access-Control-Allow-Origin': true,
        'method.response.header.Access-Control-Allow-Headers': true,
        'method.response.header.Access-Control-Allow-Methods': true,
      },
    });

    // Define the Integration Response for OPTIONS
    new ApiGatewayIntegrationResponse(scope, 'OptionsIntegrationResponse', {
      restApiId: api.id,
      resourceId: chatResource.id,
      httpMethod: optionsMethod.httpMethod,
      statusCode: '200',
      selectionPattern: '',
      responseParameters: {
        'method.response.header.Access-Control-Allow-Origin': "'*'",
        'method.response.header.Access-Control-Allow-Headers': "'Content-Type,Authorization'",
        'method.response.header.Access-Control-Allow-Methods': "'OPTIONS,POST'",
      },
    });

    // Create the POST method
    const postMethod = new ApiGatewayMethod(scope, 'ApiMethodPOST', {
      httpMethod: 'POST',
      resourceId: chatResource.id,
      restApiId: api.id,
      authorization: 'NONE',
    });

    // Create the POST integration
    new ApiGatewayIntegration(scope, 'ApiIntegrationPOST', {
      restApiId: api.id,
      resourceId: chatResource.id,
      httpMethod: postMethod.httpMethod,
      type: 'AWS_PROXY',
      integrationHttpMethod: 'POST',
      uri: `arn:aws:apigateway:${region}:lambda:path/2015-03-31/functions/${lambda.arn}/invocations`,
    });

    // Deployment of the API
    const deployment = new ApiGatewayDeployment(scope, 'ApiDeployment', {
      restApiId: api.id,
      triggers: { redeployment: `${new Date().toISOString()}` },
    });

    deployment.addOverride('depends_on', [
      'aws_api_gateway_method.ApiMethodOPTIONS',
      'aws_api_gateway_method.ApiMethodPOST',
      'aws_api_gateway_integration.ApiIntegrationOPTIONS',
      'aws_api_gateway_integration.ApiIntegrationPOST',
    ]);

    // Stage for the deployment
    new ApiGatewayStage(scope, 'ApiStage', {
      restApiId: api.id,
      deploymentId: deployment.id,
      stageName: 'prod',
    });

    new LambdaPermission(scope, 'ApiGatewayInvokePermission', {
        action: 'lambda:InvokeFunction',
        functionName: lambda.functionName,
        principal: 'apigateway.amazonaws.com',
        sourceArn: `arn:aws:execute-api:${region}:${accountId}:${api.id}/*/*`,
    });
  }
}
