function Shape() {}

var shape = new Shape();
var fill = new GradFill();
var sourceFill = new SolidFill();

shape.fill = AscFormat.CreateGradFill();
shape.cloneFill = fill.clone();
shape.duplicateFill = sourceFill.createDuplicate();
shape.readFill = reader.ReadGradFill();
