import React, {
  ChangeEvent,
  Dispatch,
  SetStateAction,
  useRef,
  useState,
} from "react";
import type { FormData } from "./RestaurantSetup";
import { AppWindowMac, BadgePlus, ScanLine, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  isValidPrice,
  parseCsvMenu,
  validateMenuItems,
  type MenuImportError,
} from "@/lib/menuValidation";

// Type for handling the input change
export type HandleInputChange = (
  field: keyof FormData,
  value: string | FormData["menuDetails"]
) => void;

// When the menu details are empty
function NoMenuDetails({
  setShowManualEntry,
  handleInputChange,
}: {
  setShowManualEntry: Dispatch<SetStateAction<boolean>>;
  handleInputChange: HandleInputChange;
}) {
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [importErrors, setImportErrors] = useState<MenuImportError[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/client/api/v1/extract-menu-data", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error("Failed to extract menu data");
      }

      const data = (await response.json()) as {
        sucess: boolean;
        data: FormData["menuDetails"];
      };
      const validationErrors = validateMenuItems(data.data);
      if (validationErrors.length) {
        setImportErrors(validationErrors);
        throw new Error("Menu validation failed");
      }
      handleInputChange("menuDetails", data.data);
      setErrorMessage(null);
      setImportErrors([]);
      setShowManualEntry(false);
    } catch (error) {
      console.error("Error in extracting menu data:", (error as Error).message);
      setErrorMessage("Unable to extract menu data. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleCsvUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    try {
      const text = await file.text();
      const { items, errors } = parseCsvMenu(text);
      if (!items.length) {
        throw new Error("No menu items found in CSV.");
      }
      if (errors.length) {
        setImportErrors(errors);
        throw new Error("Menu validation failed.");
      }
      handleInputChange("menuDetails", items);
      setErrorMessage(null);
      setImportErrors([]);
      setShowManualEntry(false);
    } catch (error) {
      console.error("Error parsing CSV menu:", (error as Error).message);
      setErrorMessage("Unable to read CSV. Please check the format and try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className={cn("w-full grid grid-cols-1 md:grid-cols-2 gap-6 p-4", {
        "pointer-events-none": loading,
      })}
    >
      {/* AI */}
      <div
        className="group relative flex flex-col justify-center items-center h-full w-full card-minimal rounded-lg cursor-pointer hover:bg-white/5 transition-all duration-300 ease-in-out p-8 text-center"
        onClick={() => !loading && inputRef.current?.click()}
      >
        {loading && (
          <div className="absolute inset-0 bg-black/50 flex flex-col justify-center items-center rounded-lg backdrop-blur-sm">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-emerald-500/30 border-t-emerald-500"></div>
            <p className="text-emerald-400 text-minimal mt-4">Extracting...</p>
          </div>
        )}
        <input
          type="file"
          ref={inputRef}
          className="hidden"
          accept="application/pdf, image/*"
          onChange={handleFileChange}
          disabled={loading}
        />
        <div className="absolute top-3 right-3 bg-emerald-500/10 text-emerald-400 text-xs px-3 py-1 rounded-full border border-emerald-500/20">
          AI
        </div>
        <ScanLine className="text-emerald-400 h-10 w-10 mb-4" />
        <h3 className="text-lg text-white text-minimal">Extract from Image</h3>
        <p className="text-sm text-white/70 mt-2 text-minimal">
          Upload a photo of your menu
        </p>
      </div>

      {/* CSV Import */}
      <div
        className="group relative flex flex-col justify-center items-center h-full w-full card-minimal rounded-lg cursor-pointer hover:bg-white/5 transition-all duration-300 ease-in-out p-8 text-center"
        onClick={() => !loading && csvInputRef.current?.click()}
      >
        <input
          type="file"
          ref={csvInputRef}
          className="hidden"
          accept=".csv,text/csv"
          onChange={handleCsvUpload}
          disabled={loading}
        />
        <div className="absolute top-3 right-3 bg-white/10 text-white/70 text-xs px-3 py-1 rounded-full border border-white/20">
          CSV
        </div>
        <AppWindowMac className="text-white/60 h-10 w-10 mb-4" />
        <h3 className="text-lg text-white text-minimal">Import CSV</h3>
        <p className="text-sm text-white/70 mt-2 text-minimal">
          Upload a CSV with name, price, description
        </p>
      </div>

      {/* Manual entry */}
      <div
        className="group flex flex-col justify-center items-center h-full w-full card-minimal rounded-lg cursor-pointer hover:bg-white/5 transition-all duration-300 ease-in-out p-8 text-center"
        onClick={() => !loading && setShowManualEntry(true)}
      >
        <BadgePlus className="text-white/60 h-10 w-10 mb-4" />
        <h3 className="text-lg text-white text-minimal">Add Manually</h3>
        <p className="text-sm text-white/70 mt-2 text-minimal">
          Enter items one-by-one
        </p>
      </div>

      {errorMessage && (
        <p className="text-sm text-red-400 md:col-span-2" role="alert">
          {errorMessage}
        </p>
      )}
      {importErrors.length > 0 && (
        <div className="md:col-span-2 border border-red-500/40 bg-red-500/10 rounded-lg p-4 text-sm text-red-200 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="font-medium text-red-200">Menu import errors</p>
            <button
              type="button"
              onClick={() => setImportErrors([])}
              className="text-xs text-red-200 underline"
            >
              Clear report
            </button>
          </div>
          <ul className="space-y-1 max-h-40 overflow-y-auto">
            {importErrors.map((error, index) => (
              <li key={`${error.row}-${index}`} className="text-xs text-red-100">
                Row {error.row}: {error.issue}
              </li>
            ))}
          </ul>
          <p className="text-xs text-red-100">
            Fix the issues and re-upload your CSV to retry the import.
          </p>
        </div>
      )}
    </div>
  );
}

// Form to manually add menu items
function ManualEntryForm({
  onAddItem,
  onCancel,
}: {
  onAddItem: (item: FormData["menuDetails"][0]) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [description, setDescription] = useState("");
  const [modifiers, setModifiers] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !price.trim()) {
      setFormError("Name and price are required.");
      return;
    }
    if (!isValidPrice(price)) {
      setFormError("Price must be a number (e.g., 12 or 12.99).");
      return;
    }
    if (name && price) {
      const parsedModifiers = modifiers
        ? modifiers.split(/,|;/).map((value) => value.trim()).filter(Boolean)
        : undefined;
      onAddItem({ name, price, description, modifiers: parsedModifiers });
      setName("");
      setPrice("");
      setDescription("");
      setModifiers("");
      setFormError(null);
    }
  };

  return (
    <div className="w-full h-full p-6 card-minimal rounded-lg">
      <form onSubmit={handleSubmit} className="space-y-5">
        <h3 className="text-lg text-white text-minimal">Add New Menu Item</h3>
        <div>
          <label
            htmlFor="itemName"
            className="block text-sm text-white/70 mb-2 text-minimal"
          >
            Item Name
          </label>
          <input
            id="itemName"
            type="text"
            value={name}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setName(e.target.value)
            }
            placeholder="e.g., Classic Burger"
            className="input-dark w-full px-4 py-3 rounded-lg"
            required
          />
        </div>
        <div>
          <label
            htmlFor="itemPrice"
            className="block text-sm text-white/70 mb-2 text-minimal"
          >
            Price
          </label>
          <input
            id="itemPrice"
            type="number"
            step="0.01"
            value={price}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setPrice(e.target.value)
            }
            placeholder="e.g., 12.99"
            className="input-dark w-full px-4 py-3 rounded-lg"
            required
          />
        </div>
        {formError && (
          <p className="text-sm text-red-400" role="alert">
            {formError}
          </p>
        )}
        <div>
          <label
            htmlFor="itemModifiers"
            className="block text-sm text-white/70 mb-2 text-minimal"
          >
            Modifiers (optional)
          </label>
          <input
            id="itemModifiers"
            type="text"
            value={modifiers}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setModifiers(e.target.value)
            }
            placeholder="e.g., extra cheese; no onions"
            className="input-dark w-full px-4 py-3 rounded-lg"
          />
        </div>
        <div>
          <label
            htmlFor="itemDescription"
            className="block text-sm text-white/70 mb-2 text-minimal"
          >
            Optional Description
          </label>
          <input
            id="itemDescription"
            type="text"
            value={description}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setDescription(e.target.value)
            }
            placeholder="e.g., Served with lettuce, tomato, and fries"
            className="input-dark w-full px-4 py-3 rounded-lg"
          />
        </div>
        <div className="flex justify-end gap-3 pt-3">
          <button
            type="button"
            onClick={onCancel}
            className="btn-minimal btn-secondary-minimal px-6 py-2 rounded-lg text-minimal"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="btn-minimal btn-primary-minimal px-6 py-2 rounded-lg text-minimal"
          >
            Add Item
          </button>
        </div>
      </form>
    </div>
  );
}

// Single menu item component
function MenuItem({
  item,
  onDelete,
}: {
  item: FormData["menuDetails"][0];
  onDelete: () => void;
}) {
  return (
    <div className="menu-item-card rounded-lg p-4 hover:bg-white/5 transition-all duration-200">
      <div className="flex justify-between items-start">
        <div className="flex-1">
          <p className="text-white text-minimal">{item.name}</p>
          {item.description && (
            <p className="text-sm text-white/70 mt-1 text-minimal">
              {item.description}
            </p>
          )}
          {item.modifiers && item.modifiers.length > 0 && (
            <p className="text-xs text-white/50 mt-1 text-minimal">
              Modifiers: {item.modifiers.join(", ")}
            </p>
          )}
        </div>
        <div className="flex items-center gap-4 ml-4">
          <p className="text-emerald-400 text-lg text-minimal">
            ${Number(item.price).toFixed(2)}
          </p>
          <button
            onClick={onDelete}
            className="text-red-400 opacity-60 hover:opacity-100 hover:text-red-300 transition-all duration-200 p-1 rounded hover:bg-red-500/10 cursor-pointer"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

// Parent Component
function MenuDetails({
  handleInputChange,
  menuDetails,
}: {
  menuDetails: FormData["menuDetails"];
  handleInputChange: HandleInputChange;
}) {
  const [showManualEntry, setShowManualEntry] = useState<boolean>(false);

  const handleAddItem = (newItem: FormData["menuDetails"][0]) => {
    const updatedMenu = [...menuDetails, newItem];
    handleInputChange("menuDetails", updatedMenu);
    setShowManualEntry(false);
  };

  const handleDeleteItem = (index: number) => {
    const updatedMenu = menuDetails.filter((_, i) => i !== index);
    handleInputChange("menuDetails", updatedMenu);
  };

  const hasItems = menuDetails.length > 0;

  return (
    <div className="w-full min-h-40 flex">
      {showManualEntry ? (
        <ManualEntryForm
          onAddItem={handleAddItem}
          onCancel={() => setShowManualEntry(false)}
        />
      ) : hasItems ? (
        <div className="w-full p-6  rounded-lg border border-white/10 space-y-4">
          <div className="flex justify-between items-center pb-3 border-b border-white/10">
            <h3 className="text-lg text-white text-minimal">
              Menu Items ({menuDetails.length})
            </h3>
            <button
              onClick={() => setShowManualEntry(true)}
              className="btn-minimal btn-primary-minimal flex items-center gap-2 px-4 py-2 rounded-lg text-minimal"
            >
              <BadgePlus size={16} />
              Add Item
            </button>
          </div>
          <div className="max-h-96 overflow-y-auto flex flex-col gap-3 px-1">
            {menuDetails.map((item, index) => (
              <MenuItem
                key={index}
                item={item}
                onDelete={() => handleDeleteItem(index)}
              />
            ))}
          </div>
        </div>
      ) : (
        <NoMenuDetails
          setShowManualEntry={setShowManualEntry}
          handleInputChange={handleInputChange}
        />
      )}
    </div>
  );
}

export default MenuDetails;
