import { Construct } from 'constructs';
import { AwsProvider } from '@cdktf/provider-aws/lib/provider';
import { DataAwsRoute53Zone } from '@cdktf/provider-aws/lib/data-aws-route53-zone';
import { AcmCertificate } from '@cdktf/provider-aws/lib/acm-certificate';
import { AcmCertificateValidation } from '@cdktf/provider-aws/lib/acm-certificate-validation';
import { Route53Record } from '@cdktf/provider-aws/lib/route53-record';
import { S3Bucket } from '@cdktf/provider-aws/lib/s3-bucket';
import { S3BucketPublicAccessBlock } from '@cdktf/provider-aws/lib/s3-bucket-public-access-block';
import { S3BucketPolicy } from '@cdktf/provider-aws/lib/s3-bucket-policy';
import { CloudfrontOriginAccessIdentity } from '@cdktf/provider-aws/lib/cloudfront-origin-access-identity';
import { CloudfrontDistribution } from '@cdktf/provider-aws/lib/cloudfront-distribution';
import { CognitoUserPool } from '@cdktf/provider-aws/lib/cognito-user-pool';
import { CognitoUserPoolDomain } from '@cdktf/provider-aws/lib/cognito-user-pool-domain';
import { CognitoUserPoolClient } from '@cdktf/provider-aws/lib/cognito-user-pool-client';
import { CognitoUserPoolUiCustomization } from '@cdktf/provider-aws/lib/cognito-user-pool-ui-customization';
import { TerraformOutput } from 'cdktf';

export class StaticWebsiteWithAuthStack {
  public userPool: CognitoUserPool;
  public userPoolClient: CognitoUserPoolClient;
  public userPoolDomain: CognitoUserPoolDomain;

  constructor(scope: Construct, provider: AwsProvider) {
    const domainName = 'not-a-wise.click';
    const cognitoSubdomain = 'auth'; // e.g. auth.not-a-wise.click

    // Providers:
    // Use the default (EU) provider for most resources.
    const euProvider = provider; // e.g. eu-central-1
    // US-East-1 is required for CloudFront certificates.
    const usEastProvider = new AwsProvider(scope, 'aws-us-east-1', {
      region: 'us-east-1',
      alias: 'us-east-1',
    });

    // Hosted zone (EU)
    const hostedZone = new DataAwsRoute53Zone(scope, 'ExistingHostedZone', {
      name: domainName,
      privateZone: false,
      provider: euProvider,
    });

    // ===============================
    // Cognito Custom Domain Certificate (US)
    // ===============================
    const cognitoCertificate = new AcmCertificate(scope, 'CognitoCertificate', {
      domainName: `${cognitoSubdomain}.${domainName}`,
      validationMethod: 'DNS',
      provider: usEastProvider,
    });
    const cognitoCertValidationRecord = new Route53Record(scope, 'CognitoCertValidationRecord', {
      name: "${each.value.name}",
      type: "${each.value.type}",
      records: ["${each.value.record}"],
      zoneId: hostedZone.zoneId,
      ttl: 60,
      allowOverwrite: true,
      provider: euProvider,
    });
    cognitoCertValidationRecord.addOverride(
      'for_each',
      `\${{
  for dvo in ${cognitoCertificate.fqn}.domain_validation_options : dvo.domain_name => {
    name   = dvo.resource_record_name,
    record = dvo.resource_record_value,
    type   = dvo.resource_record_type
  }
}}`
    );
    const cognitoCertValidation = new AcmCertificateValidation(scope, 'CognitoCertValidation', {
      certificateArn: cognitoCertificate.arn,
      provider: usEastProvider,
    });
    cognitoCertValidation.addOverride(
      'validation_record_fqdns',
      `\${[for record in ${cognitoCertValidationRecord.fqn} : record.fqdn]}`
    );

    // ===============================
    // Website Domain Certificate (US for CloudFront)
    // ===============================
    const websiteCertificate = new AcmCertificate(scope, 'WebsiteCertificate', {
      domainName,
      validationMethod: 'DNS',
      provider: usEastProvider,
    });
    const websiteCertValidationRecord = new Route53Record(scope, 'WebsiteCertValidationRecord', {
      name: "${each.value.name}",
      type: "${each.value.type}",
      records: ["${each.value.record}"],
      zoneId: hostedZone.zoneId,
      ttl: 60,
      allowOverwrite: true,
      provider: euProvider,
    });
    websiteCertValidationRecord.addOverride(
      'for_each',
      `\${{
  for dvo in ${websiteCertificate.fqn}.domain_validation_options : dvo.domain_name => {
    name   = dvo.resource_record_name,
    record = dvo.resource_record_value,
    type   = dvo.resource_record_type
  }
}}`
    );
    const websiteCertValidation = new AcmCertificateValidation(scope, 'WebsiteCertValidation', {
      certificateArn: websiteCertificate.arn,
      provider: usEastProvider,
    });
    websiteCertValidation.addOverride(
      'validation_record_fqdns',
      `\${[for record in ${websiteCertValidationRecord.fqn} : record.fqdn]}`
    );

    // ===============================
    // S3 Bucket & CloudFront Distribution (Website)
    // ===============================
    const websiteBucket = new S3Bucket(scope, 'StaticWebsiteBucket', {
      bucket: domainName,
      provider: euProvider,
    });
    new S3BucketPublicAccessBlock(scope, 'PublicAccessBlock', {
      bucket: websiteBucket.bucket,
      blockPublicPolicy: true,
      blockPublicAcls: true,
      ignorePublicAcls: true,
      restrictPublicBuckets: true,
      provider: euProvider,
    });
    const oai = new CloudfrontOriginAccessIdentity(scope, 'WebsiteOAI', {
      comment: 'OAI for not-a-wise.click website',
      provider: euProvider,
    });
    new S3BucketPolicy(scope, 'BucketPolicy', {
      bucket: websiteBucket.bucket,
      policy: JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Sid: 'AllowCloudFrontAccess',
            Effect: 'Allow',
            Principal: { AWS: oai.iamArn },
            Action: 's3:GetObject',
            Resource: `arn:aws:s3:::${websiteBucket.bucket}/*`,
          },
        ],
      }),
      provider: euProvider,
    });
    const websiteDistribution = new CloudfrontDistribution(scope, 'WebsiteDistribution', {
      enabled: true,
      aliases: [domainName],
      defaultRootObject: 'index.html',
      origin: [
        {
          domainName: websiteBucket.bucketDomainName,
          originId: websiteBucket.bucket,
          s3OriginConfig: {
            originAccessIdentity: oai.cloudfrontAccessIdentityPath,
          },
        },
      ],
      defaultCacheBehavior: {
        targetOriginId: websiteBucket.bucket,
        viewerProtocolPolicy: 'redirect-to-https',
        allowedMethods: ['GET', 'HEAD'],
        cachedMethods: ['GET', 'HEAD'],
        forwardedValues: {
          queryString: false,
          cookies: { forward: 'none' },
        },
      },
      viewerCertificate: {
        acmCertificateArn: websiteCertificate.arn,
        sslSupportMethod: 'sni-only',
      },
      restrictions: {
        geoRestriction: { restrictionType: 'none' },
      },
      priceClass: 'PriceClass_100',
      dependsOn: [websiteCertValidation],
      provider: usEastProvider,
    });

    // ===============================
    // Cognito Resources
    // ===============================
    // Create the Cognito User Pool (EU)
    this.userPool = new CognitoUserPool(scope, 'UserPool', {
      name: 'StaticWebsiteUserPool',
      autoVerifiedAttributes: ['email'],
      provider: euProvider,
    });
    // Create the Cognito User Pool Domain using the US certificate ARN.
    this.userPoolDomain = new CognitoUserPoolDomain(scope, 'UserPoolDomain', {
      domain: `${cognitoSubdomain}.${domainName}`,
      userPoolId: this.userPool.id,
      certificateArn: cognitoCertificate.arn,
      provider: euProvider,
      dependsOn: [cognitoCertValidation],
    });
    // Use the computed attribute "cloudfrontDistributionDomain" directly.
    new Route53Record(scope, 'FinalCognitoAliasRecord', {
      name: `${cognitoSubdomain}.${domainName}`,
      type: 'A',
      zoneId: hostedZone.zoneId,
      alias: {
        name: this.userPoolDomain.cloudfrontDistribution,
        zoneId: this.userPoolDomain.cloudfrontDistributionZoneId,
        evaluateTargetHealth: false,
      },
      allowOverwrite: true,
      provider: euProvider,
    });

    // Final website alias record.
    new Route53Record(scope, 'FinalWebsiteAliasRecord', {
      name: domainName,
      type: 'A',
      zoneId: hostedZone.zoneId,
      alias: {
        name: websiteDistribution.domainName,
        zoneId: 'Z2FDTNDATAQYW2',
        evaluateTargetHealth: false,
      },
      allowOverwrite: true,
      provider: euProvider,
      dependsOn: [websiteDistribution],
    });

    // ===============================
    // Cognito User Pool Client & UI Customization
    // ===============================
    this.userPoolClient = new CognitoUserPoolClient(scope, 'UserPoolClient', {
      name: 'StaticWebsiteUserPoolClient',
      userPoolId: this.userPool.id,
      generateSecret: false,
      allowedOauthFlowsUserPoolClient: true,
      allowedOauthFlows: ['code', 'implicit'],
      allowedOauthScopes: ['email', 'openid', 'profile'],
      callbackUrls: [`https://${domainName}/index.html`],
      logoutUrls: [`https://${domainName}/logout`],
      supportedIdentityProviders: ['COGNITO'],
      accessTokenValidity: 10,
      idTokenValidity: 10,
      provider: euProvider,
    });
    new CognitoUserPoolUiCustomization(scope, 'CognitoUICustomization', {
      userPoolId: this.userPool.id,
      clientId: this.userPoolClient.id,
      css: '.label-customizable {font-weight: 400;}',
      provider: euProvider,
    });

    // ===============================
    // Outputs
    // ===============================
    new TerraformOutput(scope, 'website_url', {
      value: websiteDistribution.domainName,
      description: 'Domain name of the website CloudFront distribution',
    });
    new TerraformOutput(scope, 'user_pool_id', {
      value: this.userPool.id,
      description: 'Cognito User Pool ID',
    });
    new TerraformOutput(scope, 'user_pool_client_id', {
      value: this.userPoolClient.id,
      description: 'Cognito User Pool Client ID',
    });
    new TerraformOutput(scope, 'cognito_domain_url', {
      value: `https://${this.userPoolDomain.domain}.auth.${usEastProvider.region}.amazoncognito.com`,
      description: 'Cognito User Pool Domain URL',
    });
    new TerraformOutput(scope, 'custom_cognito_domain_url', {
      value: `https://${this.userPoolDomain.domain}`,
      description: 'Custom Cognito Domain URL',
    });
  }
}