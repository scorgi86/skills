interface FillHolder {
    fill: GradFill;
}

export function setFill(holder: FillHolder, fill: GradFill): void {
    holder.fill = fill;
}
