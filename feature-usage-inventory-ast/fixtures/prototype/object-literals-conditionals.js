function Shape() {}
function Theme() {}
function GradFill() {}
function SolidFill() {}

var literalShape = {
    fill: new GradFill(),
    spPr: new CSpPr()
};

var shape = new Shape();
var theme = new Theme();
var gradFill = new GradFill();

shape.fill = theme.fill = gradFill;

if (useGradient) {
    shape.fill = new GradFill();
} else {
    shape.fill = new SolidFill();
}
