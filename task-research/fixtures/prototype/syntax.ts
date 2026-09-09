interface FeatureHolder {
    value: FeatureValue;
}

export function setValue(holder: FeatureHolder, value: FeatureValue): void {
    holder.value = value;
}
