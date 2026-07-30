function Shape() {}
function Page() {}
function Document() {}
function GradFill() {}
function Theme() {}

var shape = new Shape();
var page = new Page();
var doc = new Document();
var gradFill = new GradFill();
var theme = new Theme();

page.shapes.push(shape);
doc.pages.push(page);
theme.fills[id] = gradFill;
theme.fills["default"] = gradFill;
