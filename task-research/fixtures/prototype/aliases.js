function FeatureContainer() {}

var value = new FeatureNamespace.FeatureValue();
var alias = value;
var container = new FeatureContainer();

container.value = alias;
