import { TerraformResource } from "cdktf";
import { Construct as BaseConstruct } from "constructs";

export interface OpensearchIndexHclConfig {
  name: string;
  numberOfShards: string;
  numberOfReplicas: string;
  mappings: string;
}

export class OpensearchIndexHcl extends TerraformResource {
  private _name: string;
  private _numberOfShards: string;
  private _numberOfReplicas: string;
  private _mappings: string;

  constructor(scope: BaseConstruct, id: string, config: OpensearchIndexHclConfig) {
    super(scope, id, {
      terraformResourceType: "opensearch_index",
      terraformGeneratorMetadata: { providerName: "opensearch" }
    });
    this._name = config.name;
    this._numberOfShards = config.numberOfShards;
    this._numberOfReplicas = config.numberOfReplicas;
    this._mappings = config.mappings;
    // Tell this resource to use the dummy opensearch provider
    this.addOverride("provider", "opensearch.dummyOpensearchProvider");
  }

  protected synthesizeAttributes(): { [name: string]: any } {
    return {
      name: this._name,
      number_of_shards: this._numberOfShards,
      number_of_replicas: this._numberOfReplicas,
      mappings: this._mappings,
    };
  }
}
