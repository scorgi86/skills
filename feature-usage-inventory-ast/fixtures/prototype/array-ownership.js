function FeatureContainer() {}
function ContainerGroup() {}
function AggregateRoot() {}
function FeatureValue() {}
function FeatureRegistry() {}

var container = new FeatureContainer();
var group = new ContainerGroup();
var aggregate = new AggregateRoot();
var featureValue = new FeatureValue();
var registry = new FeatureRegistry();

group.containers.push(container);
aggregate.groups.push(group);
registry.values[id] = featureValue;
registry.values["default"] = featureValue;
