export const INV_SLOTS = 8;

export function usedSlots(inventory) {
  return inventory.reduce((sum, it) => sum + (it.slot ?? 1), 0);
}

export function canFit(inventory, item) {
  return usedSlots(inventory) + (item.slot ?? 1) <= INV_SLOTS;
}

export function addItem(inventory, item) {
  if (!canFit(inventory, item)) return false;
  inventory.push(item);
  return true;
}

export function removeItem(inventory, itemId) {
  const idx = inventory.findIndex(i => i.id === itemId);
  if (idx === -1) return null;
  return inventory.splice(idx, 1)[0];
}

export function totalValue(inventory) {
  return inventory.reduce((sum, it) => sum + (it.value ?? 0), 0);
}

export function heavyItemCount(inventory) {
  return inventory.filter(i => (i.slot ?? 1) >= 2).length;
}
