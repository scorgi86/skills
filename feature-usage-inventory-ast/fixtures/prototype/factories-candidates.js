function FeatureContainer() {}

var container = new FeatureContainer();
var value = new FeatureValue();
var sourceValue = new AlternateValue();

container.value = FeatureNamespace.createValue();
container.cloneValue = value.clone();
container.duplicateValue = sourceValue.createDuplicate();
container.readValue = reader.readValue();
