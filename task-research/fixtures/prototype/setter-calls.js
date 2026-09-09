function FeatureValue() {}
function FeatureContainer() {}

FeatureContainer.prototype.setValue = function(value) {
    this.value = value;
};

var featureValue = new FeatureValue();
var container = new FeatureContainer();

container.setValue(featureValue);
