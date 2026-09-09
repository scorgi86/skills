function FeatureContainer() {
    this.value = null;
}

FeatureContainer.prototype.setValue = function(value) {
    this.value = value;
};

FeatureContainer.prototype.getValue = function() {
    return this.value;
};

FeaturePanel.prototype = {
    setMainContainer: function(container) {
        this.mainContainer = container;
    },
    getMainContainer: function() {
        return this.mainContainer;
    }
};
