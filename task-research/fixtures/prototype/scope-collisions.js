function Holder() {}

Holder.prototype.first = function() {
    var item = new TypeA();
    item.value = new ValueA();
};

Holder.prototype.second = function() {
    var item = new TypeB();
    item.value = new ValueB();
};
