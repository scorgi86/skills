function FeatureValue() {}
function FeatureContainer() {}
function ContainerGroup() {}
function AggregateRoot() {}

var featureValue = new FeatureValue();
var container = new FeatureContainer();
var group = new ContainerGroup();
var aggregate = new AggregateRoot();

container.value = featureValue;
group.mainContainer = container;
aggregate.activeGroup = group;
container["fallbackValue"] = featureValue;
container[propertyName] = featureValue;
