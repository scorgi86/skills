function GradFill() {}
function Shape() {}
function Page() {}
function Document() {}

var gradFill = new GradFill();
var shape = new Shape();
var page = new Page();
var doc = new Document();

shape.fill = gradFill;
page.mainShape = shape;
doc.activePage = page;
shape["fallbackFill"] = gradFill;
shape[propName] = gradFill;
