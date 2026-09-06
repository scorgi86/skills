function FeatureValue() {}
function FeatureContainer() {}
function FeatureRegistry() {}
function FeatureConsumer() {}

var featureValue = new FeatureValue();
var container = new FeatureContainer();
var registry = new FeatureRegistry();
var consumer = new FeatureConsumer();

container.value = featureValue;
registry.defaultValue = featureValue;
consumer.inputValue = featureValue;
