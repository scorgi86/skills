function Shape() {
    this.fill = null;
}

Shape.prototype.setFill = function(fill) {
    this.fill = fill;
};

Shape.prototype.getFill = function() {
    return this.fill;
};

Page.prototype = {
    setMainShape: function(shape) {
        this.mainShape = shape;
    },
    getMainShape: function() {
        return this.mainShape;
    }
};
