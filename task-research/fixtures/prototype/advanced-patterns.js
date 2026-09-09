class FeatureStore {
    add(container) {
        this.items.push(container);
    }
}

function FeatureContainer() {}
var containerProto = FeatureContainer.prototype;
containerProto.setValue = function(value) {
    this.value = value;
};

var container = new FeatureContainer();
var value = new FeatureValue();
consumer.accept(container.value);
container.value = createValue();
store.items.set("container", container);
