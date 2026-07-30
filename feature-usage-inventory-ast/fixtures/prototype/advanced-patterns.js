class ShapeStore {
    add(shape) {
        this.items.push(shape);
    }
}

function Shape() {}
var shapeProto = Shape.prototype;
shapeProto.setFill = function(fill) {
    this.fill = fill;
};

var shape = new Shape();
var fill = new GradFill();
renderer.draw(shape.fill);
shape.fill = createFill();
store.items.set("shape", shape);
