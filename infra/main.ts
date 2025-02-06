import { App, RemoteBackend, TerraformStack } from 'cdktf';
import { StaticWebsiteWithAuthStack } from './frontend';
import { BedrockAgentStack } from './bedrock';
import { BedrockBackendStack } from './bedrockBackend';
import { AwsProvider } from '@cdktf/provider-aws/lib/provider';
import { Construct } from 'constructs';
import { RAGProcessor } from './rag-processer';
// import { provider as  NullProvider } from '@cdktf/provider-null/lib';

class UnifiedStack extends TerraformStack {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    // Configure the Terraform Cloud backend
    new RemoteBackend(this, {
      hostname: 'app.terraform.io',
      organization: 'gudr33dz',
      workspaces: {
        name: 'main'
      }
    });

    // Initialize AWS Provider
    const provider = new AwsProvider(this, 'AWS', {
      region: 'eu-central-1',
      stsRegion: 'eu-central-1',
    });

    // new NullProvider.NullProvider(this, 'null_provider');

    // Initialize Static Website Resources
    const staticWeb = new StaticWebsiteWithAuthStack(this, provider);

    new BedrockAgentStack(this);

    new BedrockBackendStack(this, 'eu-central-1', staticWeb.userPool);

    new RAGProcessor(this);
  }
}

const app = new App({ skipValidation: true });

new UnifiedStack(app, 'UnifiedStack');

// Synthesize both stacks
app.synth();