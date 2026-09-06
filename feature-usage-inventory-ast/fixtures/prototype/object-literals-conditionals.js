function FeatureContainer() {}
function FeatureRegistry() {}
function FeatureValue() {}
function AlternateValue() {}

var literalContainer = {
    value: new FeatureValue(),
    state: new FeatureState()
};

var container = new FeatureContainer();
var registry = new FeatureRegistry();
var featureValue = new FeatureValue();

container.value = registry.value = featureValue;

if (usePrimaryValue) {
    container.value = new FeatureValue();
} else {
    container.value = new AlternateValue();
}
