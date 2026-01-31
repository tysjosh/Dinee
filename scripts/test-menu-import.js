require("ts-node/register");

const { parseCsvMenu } = require("../src/lib/menuValidation");

const validCsv = `name,price,description,modifiers
Jollof Rice,12.50,Smoky jollof,extra spice;fried plantain`;

const invalidCsv = `name,price
,abc`;

const validResult = parseCsvMenu(validCsv);
if (validResult.items.length !== 1) {
  throw new Error("Expected valid CSV to return one item.");
}
if (validResult.errors.length !== 0) {
  throw new Error("Expected no errors for valid CSV.");
}

const invalidResult = parseCsvMenu(invalidCsv);
if (invalidResult.items.length !== 0) {
  throw new Error("Expected invalid CSV to return no valid items.");
}
if (invalidResult.errors.length === 0) {
  throw new Error("Expected errors for invalid CSV.");
}

console.log("Menu import tests passed.");
