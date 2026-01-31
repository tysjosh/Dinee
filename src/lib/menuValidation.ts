export type MenuItemInput = {
  name: string;
  price: string;
  description?: string;
  modifiers?: string[];
};

export type MenuImportError = {
  row: number;
  issue: string;
  raw: string;
};

const PRICE_PATTERN = /^\d+(\.\d{1,2})?$/;

export function isValidPrice(price: string) {
  return PRICE_PATTERN.test(price.trim());
}

export function validateMenuItems(items: MenuItemInput[]) {
  const errors: MenuImportError[] = [];

  items.forEach((item, index) => {
    if (!item.name.trim()) {
      errors.push({
        row: index + 1,
        issue: "Missing item name",
        raw: JSON.stringify(item),
      });
    }
    if (!item.price.trim()) {
      errors.push({
        row: index + 1,
        issue: "Missing price",
        raw: JSON.stringify(item),
      });
    } else if (!PRICE_PATTERN.test(item.price.trim())) {
      errors.push({
        row: index + 1,
        issue: "Invalid price format",
        raw: JSON.stringify(item),
      });
    }
    if (item.modifiers && item.modifiers.some((modifier) => !modifier.trim())) {
      errors.push({
        row: index + 1,
        issue: "Modifiers contain empty values",
        raw: JSON.stringify(item),
      });
    }
  });

  return errors;
}

export function parseCsvMenu(csvText: string) {
  const rows = csvText
    .split(/\r?\n/)
    .map((row) => row.trim())
    .filter(Boolean);

  if (!rows.length) {
    return { items: [], errors: [] };
  }

  const header = rows[0].split(",").map((value) => value.trim().toLowerCase());
  const hasHeader = header.includes("name") && header.includes("price");
  const startIndex = hasHeader ? 1 : 0;

  const nameIndex = hasHeader ? header.indexOf("name") : 0;
  const priceIndex = hasHeader ? header.indexOf("price") : 1;
  const descriptionIndex = hasHeader ? header.indexOf("description") : 2;
  const modifiersIndex = hasHeader ? header.indexOf("modifiers") : 3;

  const parsedItems = rows.slice(startIndex).map((row) => {
    const columns = row.split(",").map((value) => value.trim());
    const modifiersRaw = modifiersIndex >= 0 ? columns[modifiersIndex] : "";
    const modifiers = modifiersRaw
      ? modifiersRaw.split(/;|\|/).map((value) => value.trim()).filter(Boolean)
      : undefined;

    return {
      name: columns[nameIndex] || "",
      price: columns[priceIndex] || "",
      description: columns[descriptionIndex] || undefined,
      modifiers,
    };
  });

  const errors = validateMenuItems(parsedItems);
  const validItems = parsedItems.filter(
    (item) => item.name.trim() && item.price.trim() && PRICE_PATTERN.test(item.price.trim())
  );

  return { items: validItems, errors };
}
