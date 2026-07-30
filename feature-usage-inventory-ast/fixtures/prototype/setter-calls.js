function GradFill() {}
function Shape() {}

Shape.prototype.setFill = function(fill) {
    this.fill = fill;
};

var gradFill = new GradFill();
var shape = new Shape();

shape.setFill(gradFill);
