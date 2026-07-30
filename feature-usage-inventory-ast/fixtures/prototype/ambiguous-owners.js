function GradFill() {}
function Shape() {}
function Theme() {}
function Cell() {}

var gradFill = new GradFill();
var shape = new Shape();
var theme = new Theme();
var cell = new Cell();

shape.fill = gradFill;
theme.defaultFill = gradFill;
cell.backgroundFill = gradFill;
