/**
 * PromptManagement - Dashboard component for managing upsell/cross-sell prompts
 * 
 * This component provides:
 * - List view of all prompts with status indicators
 * - Create/Edit form with trigger condition selection
 * - Pre-built templates for common upsell scenarios
 * - Activate/Deactivate toggle
 * - Delete functionality with confirmation
 * 
 * @see Requirements: 24.4, 24.5
 */

import React, { useState, useMemo, useCallback } from 'react';
import {
  Plus,
  Edit2,
  Trash2,
  ToggleLeft,
  ToggleRight,
  MessageSquare,
  Clock,
  ShoppingCart,
  Users,
  Tag,
  Sparkles,
  Filter,
  Search,
  X,
  ChevronDown,
  AlertCircle,
  CheckCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import { Modal } from '@/components/ui/Modal';
import ConfirmationModal from '@/components/ui/ConfirmationModal';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';

// ============================================================================
// Types
// ============================================================================

export interface PromptManagementProps {
  /** Restaurant ID for filtering prompts */
  restaurantId: string;
  /** Optional branch ID for branch-specific prompts */
  branchId?: string;
  /** Available branches for selection */
  branches?: Array<{ id: string; name: string }>;
  /** Optional class name */
  className?: string;
}


type TriggerCondition = 'order_total_below' | 'item_category' | 'time_of_day' | 'customer_history';

interface Prompt {
  _id: string;
  promptId: string;
  restaurantId: string;
  branchId?: string;
  triggerCondition: TriggerCondition;
  triggerValue: string;
  promptText: string;
  isActive: boolean;
  createdAt: number;
}

interface PromptFormData {
  branchId?: string;
  triggerCondition: TriggerCondition;
  triggerValue: string;
  promptText: string;
  isActive: boolean;
}

interface PromptTemplate {
  id: string;
  name: string;
  description: string;
  triggerCondition: TriggerCondition;
  triggerValue: string;
  promptText: string;
  icon: React.ElementType;
}

// ============================================================================
// Constants
// ============================================================================

const TRIGGER_CONDITIONS: Array<{
  value: TriggerCondition;
  label: string;
  description: string;
  icon: React.ElementType;
  placeholder: string;
  helpText: string;
}> = [
  {
    value: 'order_total_below',
    label: 'Order Total Below',
    description: 'Trigger when order total is below a threshold',
    icon: ShoppingCart,
    placeholder: '5000',
    helpText: 'Enter amount in Naira (e.g., 5000 for ₦5,000)',
  },
  {
    value: 'item_category',
    label: 'Item Category',
    description: 'Trigger when order contains items from specific categories',
    icon: Tag,
    placeholder: 'main,rice',
    helpText: 'Enter comma-separated categories (e.g., main,rice,chicken)',
  },
  {
    value: 'time_of_day',
    label: 'Time of Day',
    description: 'Trigger during specific hours',
    icon: Clock,
    placeholder: '12-14',
    helpText: 'Enter time range in 24h format (e.g., 12-14 for lunch)',
  },
  {
    value: 'customer_history',
    label: 'Customer History',
    description: 'Trigger based on customer order count',
    icon: Users,
    placeholder: '3',
    helpText: 'Enter minimum order count (e.g., 3 for returning customers)',
  },
];


/**
 * Pre-built templates for common upsell scenarios
 * @see Requirements: 24.4
 */
const PROMPT_TEMPLATES: PromptTemplate[] = [
  {
    id: 'add-drink',
    name: 'Add a Drink',
    description: 'Suggest adding a drink to the order',
    triggerCondition: 'item_category',
    triggerValue: 'main,rice,chicken,beef',
    promptText: 'Would you like to add a refreshing drink to go with your meal? We have soft drinks, fresh juice, and water available.',
    icon: Sparkles,
  },
  {
    id: 'dessert-special',
    name: 'Dessert Special',
    description: 'Promote dessert after main course',
    triggerCondition: 'item_category',
    triggerValue: 'main,rice',
    promptText: 'Save room for dessert! Our special today is freshly made puff puff with chocolate sauce. Would you like to add it to your order?',
    icon: Sparkles,
  },
  {
    id: 'lunch-combo',
    name: 'Lunch Combo Deal',
    description: 'Offer combo during lunch hours',
    triggerCondition: 'time_of_day',
    triggerValue: '11-14',
    promptText: 'Great timing! We have a special lunch combo - add a drink and side for just ₦500 extra. Would you like to upgrade?',
    icon: Clock,
  },
  {
    id: 'small-order-upsell',
    name: 'Small Order Upsell',
    description: 'Suggest additions for small orders',
    triggerCondition: 'order_total_below',
    triggerValue: '3000',
    promptText: 'Your order is looking good! Would you like to add some sides like plantain, coleslaw, or extra sauce to complete your meal?',
    icon: ShoppingCart,
  },
  {
    id: 'loyalty-reward',
    name: 'Loyalty Reward',
    description: 'Special offer for returning customers',
    triggerCondition: 'customer_history',
    triggerValue: '5',
    promptText: 'Thank you for being a loyal customer! As a special thank you, would you like to try our new menu item at 10% off?',
    icon: Users,
  },
  {
    id: 'breakfast-addon',
    name: 'Breakfast Add-on',
    description: 'Morning beverage suggestion',
    triggerCondition: 'time_of_day',
    triggerValue: '6-11',
    promptText: 'Good morning! Would you like to add a hot cup of coffee or tea to start your day right?',
    icon: Clock,
  },
];

const DEFAULT_FORM_DATA: PromptFormData = {
  triggerCondition: 'order_total_below',
  triggerValue: '',
  promptText: '',
  isActive: true,
};


// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Format trigger value for display
 */
function formatTriggerValue(condition: TriggerCondition, value: string): string {
  switch (condition) {
    case 'order_total_below':
      return `Below ₦${Number(value).toLocaleString()}`;
    case 'item_category':
      return value.split(',').map(c => c.trim()).join(', ');
    case 'time_of_day': {
      const [start, end] = value.split('-');
      return `${start}:00 - ${end}:00`;
    }
    case 'customer_history':
      return `${value}+ orders`;
    default:
      return value;
  }
}

/**
 * Get trigger condition display info
 */
function getTriggerInfo(condition: TriggerCondition) {
  return TRIGGER_CONDITIONS.find(tc => tc.value === condition) || TRIGGER_CONDITIONS[0];
}

/**
 * Format date for display
 */
function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('en-NG', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// ============================================================================
// Sub-components
// ============================================================================

/**
 * Status badge component
 */
function StatusBadge({ isActive }: { isActive: boolean }) {
  return (
    <Badge variant={isActive ? 'success' : 'neutral'}>
      {isActive ? (
        <>
          <CheckCircle size={12} className="mr-1" />
          Active
        </>
      ) : (
        <>
          <AlertCircle size={12} className="mr-1" />
          Inactive
        </>
      )}
    </Badge>
  );
}


/**
 * Trigger condition badge component
 */
function TriggerBadge({ condition }: { condition: TriggerCondition }) {
  const info = getTriggerInfo(condition);
  const Icon = info.icon;
  
  return (
    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-white/5 text-white/60 text-xs">
      <Icon size={12} />
      {info.label}
    </span>
  );
}

/**
 * Empty state component
 */
function EmptyState({ onCreateClick }: { onCreateClick: () => void }) {
  return (
    <div className="text-center py-12">
      <MessageSquare className="h-12 w-12 text-white/20 mx-auto mb-4" />
      <h3 className="text-lg font-medium text-white mb-2">No prompts yet</h3>
      <p className="text-white/60 text-sm mb-6 max-w-md mx-auto">
        Create upsell and cross-sell prompts to increase your average order value. 
        Start with a template or create your own.
      </p>
      <Button onClick={onCreateClick} className="btn btn-primary btn-md">
        <Plus size={16} className="mr-2" />
        Create Your First Prompt
      </Button>
    </div>
  );
}

/**
 * Template card component
 */
function TemplateCard({
  template,
  onSelect,
}: {
  template: PromptTemplate;
  onSelect: (template: PromptTemplate) => void;
}) {
  const Icon = template.icon;
  const triggerInfo = getTriggerInfo(template.triggerCondition);
  
  return (
    <button
      onClick={() => onSelect(template)}
      className="w-full text-left p-4 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 hover:border-emerald-500/30 transition-all group"
    >
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 group-hover:bg-emerald-500/20 transition-colors">
          <Icon size={20} />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-medium text-white mb-1">{template.name}</h4>
          <p className="text-xs text-white/60 mb-2">{template.description}</p>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white/5 text-white/40 text-xs">
              <triggerInfo.icon size={10} />
              {triggerInfo.label}
            </span>
          </div>
        </div>
      </div>
    </button>
  );
}


/**
 * Prompt card component for list view
 */
function PromptCard({
  prompt,
  branchName,
  onEdit,
  onToggle,
  onDelete,
  isToggling,
}: {
  prompt: Prompt;
  branchName?: string;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
  isToggling: boolean;
}) {
  const triggerInfo = getTriggerInfo(prompt.triggerCondition);
  
  return (
    <div className="card-minimal rounded-lg p-4 hover:bg-white/5 transition-colors">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <StatusBadge isActive={prompt.isActive} />
            <TriggerBadge condition={prompt.triggerCondition} />
            {branchName && (
              <span className="text-xs text-white/40 px-2 py-0.5 rounded bg-white/5">
                {branchName}
              </span>
            )}
          </div>
          
          <p className="text-sm text-white/80 mb-2 line-clamp-2">
            {prompt.promptText}
          </p>
          
          <div className="flex items-center gap-4 text-xs text-white/40">
            <span className="flex items-center gap-1">
              <triggerInfo.icon size={12} />
              {formatTriggerValue(prompt.triggerCondition, prompt.triggerValue)}
            </span>
            <span>Created {formatDate(prompt.createdAt)}</span>
          </div>
        </div>
        
        <div className="flex items-center gap-1">
          <button
            onClick={onToggle}
            disabled={isToggling}
            className={cn(
              "p-2 rounded-lg transition-colors",
              prompt.isActive
                ? "text-emerald-400 hover:bg-emerald-500/10"
                : "text-white/40 hover:bg-white/10"
            )}
            title={prompt.isActive ? 'Deactivate' : 'Activate'}
          >
            {prompt.isActive ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
          </button>
          
          <button
            onClick={onEdit}
            className="p-2 rounded-lg text-white/40 hover:text-white hover:bg-white/10 transition-colors"
            title="Edit"
          >
            <Edit2 size={16} />
          </button>
          
          <button
            onClick={onDelete}
            className="p-2 rounded-lg text-white/40 hover:text-red-400 hover:bg-red-500/10 transition-colors"
            title="Delete"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}


/**
 * Prompt form component for create/edit
 */
function PromptForm({
  formData,
  onChange,
  onSubmit,
  onCancel,
  isSubmitting,
  isEdit,
  branches,
}: {
  formData: PromptFormData;
  onChange: (data: Partial<PromptFormData>) => void;
  onSubmit: () => void;
  onCancel: () => void;
  isSubmitting: boolean;
  isEdit: boolean;
  branches?: Array<{ id: string; name: string }>;
}) {
  const selectedTrigger = getTriggerInfo(formData.triggerCondition);
  
  return (
    <div className="space-y-4">
      {/* Branch Selection (optional) */}
      {branches && branches.length > 0 && (
        <div>
          <label className="block text-sm font-medium text-white mb-2">
            Branch (Optional)
          </label>
          <div className="relative">
            <select
              value={formData.branchId || ''}
              onChange={(e) => onChange({ branchId: e.target.value || undefined })}
              className="input-dark w-full pr-10 rounded-lg appearance-none cursor-pointer"
            >
              <option value="">All Branches (Restaurant-wide)</option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40 pointer-events-none" />
          </div>
          <p className="text-xs text-white/40 mt-1">
            Leave empty to apply this prompt to all branches
          </p>
        </div>
      )}
      
      {/* Trigger Condition */}
      <div>
        <label className="block text-sm font-medium text-white mb-2">
          Trigger Condition <span className="text-red-400">*</span>
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {TRIGGER_CONDITIONS.map((trigger) => {
            const Icon = trigger.icon;
            const isSelected = formData.triggerCondition === trigger.value;
            
            return (
              <button
                key={trigger.value}
                type="button"
                onClick={() => onChange({ triggerCondition: trigger.value, triggerValue: '' })}
                className={cn(
                  "flex items-start gap-3 p-3 rounded-lg border text-left transition-all",
                  isSelected
                    ? "bg-emerald-500/10 border-emerald-500/30 text-white"
                    : "bg-white/5 border-white/10 text-white/60 hover:bg-white/10"
                )}
              >
                <Icon size={18} className={isSelected ? "text-emerald-400" : "text-white/40"} />
                <div>
                  <p className="text-sm font-medium">{trigger.label}</p>
                  <p className="text-xs text-white/40 mt-0.5">{trigger.description}</p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      
      {/* Trigger Value */}
      <div>
        <label className="block text-sm font-medium text-white mb-2">
          Trigger Value <span className="text-red-400">*</span>
        </label>
        <input
          type="text"
          value={formData.triggerValue}
          onChange={(e) => onChange({ triggerValue: e.target.value })}
          placeholder={selectedTrigger.placeholder}
          className="input-dark w-full rounded-lg"
        />
        <p className="text-xs text-white/40 mt-1">{selectedTrigger.helpText}</p>
      </div>
      
      {/* Prompt Text */}
      <div>
        <label className="block text-sm font-medium text-white mb-2">
          Prompt Text <span className="text-red-400">*</span>
        </label>
        <textarea
          value={formData.promptText}
          onChange={(e) => onChange({ promptText: e.target.value })}
          placeholder="Enter the upsell message the AI agent will deliver..."
          rows={4}
          className="input-dark w-full rounded-lg resize-none"
        />
        <p className="text-xs text-white/40 mt-1">
          This is what the AI agent will say to the customer when the trigger condition is met.
        </p>
      </div>
      
      {/* Active Toggle */}
      <div className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/10">
        <div>
          <p className="text-sm font-medium text-white">Active Status</p>
          <p className="text-xs text-white/40">Enable this prompt immediately after creation</p>
        </div>
        <button
          type="button"
          onClick={() => onChange({ isActive: !formData.isActive })}
          className={cn(
            "p-1 rounded-full transition-colors",
            formData.isActive ? "text-emerald-400" : "text-white/40"
          )}
        >
          {formData.isActive ? <ToggleRight size={32} /> : <ToggleLeft size={32} />}
        </button>
      </div>
      
      {/* Actions */}
      <div className="flex justify-end gap-3 pt-4 border-t border-white/10">
        <Button
          variant="outline"
          onClick={onCancel}
          disabled={isSubmitting}
          className="btn btn-outline btn-md"
        >
          Cancel
        </Button>
        <Button
          onClick={onSubmit}
          disabled={isSubmitting || !formData.triggerValue || !formData.promptText}
          loading={isSubmitting}
          className="btn btn-primary btn-md"
        >
          {isEdit ? 'Update Prompt' : 'Create Prompt'}
        </Button>
      </div>
    </div>
  );
}


// ============================================================================
// Main Component
// ============================================================================

/**
 * PromptManagement - Main prompt management dashboard component
 * 
 * Provides CRUD operations for upsell/cross-sell prompts with
 * pre-built templates and status management.
 * 
 * @see Requirements: 24.4, 24.5
 */
export function PromptManagement({
  restaurantId,
  branchId,
  branches = [],
  className,
}: PromptManagementProps) {
  // State
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState<Prompt | null>(null);
  const [deletingPrompt, setDeletingPrompt] = useState<Prompt | null>(null);
  const [formData, setFormData] = useState<PromptFormData>(DEFAULT_FORM_DATA);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCondition, setFilterCondition] = useState<TriggerCondition | 'all'>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'inactive'>('all');
  const [togglingPromptId, setTogglingPromptId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Convex queries and mutations
  const prompts = useQuery(api.prompts.getPromptsByRestaurant, { restaurantId });
  const createPrompt = useMutation(api.prompts.createPrompt);
  const updatePrompt = useMutation(api.prompts.updatePrompt);
  const activatePrompt = useMutation(api.prompts.activatePrompt);
  const deactivatePrompt = useMutation(api.prompts.deactivatePrompt);
  const deletePromptMutation = useMutation(api.prompts.deletePrompt);

  // Build branch name map
  const branchNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const branch of branches) {
      map[branch.id] = branch.name;
    }
    return map;
  }, [branches]);

  // Filter prompts
  const filteredPrompts = useMemo(() => {
    if (!prompts) return [];
    
    return prompts.filter((prompt: Prompt) => {
      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        if (!prompt.promptText.toLowerCase().includes(query) &&
            !prompt.triggerValue.toLowerCase().includes(query)) {
          return false;
        }
      }
      
      // Condition filter
      if (filterCondition !== 'all' && prompt.triggerCondition !== filterCondition) {
        return false;
      }
      
      // Status filter
      if (filterStatus === 'active' && !prompt.isActive) return false;
      if (filterStatus === 'inactive' && prompt.isActive) return false;
      
      // Branch filter (if branchId is provided)
      if (branchId && prompt.branchId && prompt.branchId !== branchId) {
        return false;
      }
      
      return true;
    });
  }, [prompts, searchQuery, filterCondition, filterStatus, branchId]);


  // Handlers
  const handleFormChange = useCallback((data: Partial<PromptFormData>) => {
    setFormData(prev => ({ ...prev, ...data }));
  }, []);

  const handleOpenCreate = useCallback(() => {
    setFormData(DEFAULT_FORM_DATA);
    setEditingPrompt(null);
    setIsCreateModalOpen(true);
  }, []);

  const handleOpenEdit = useCallback((prompt: Prompt) => {
    setFormData({
      branchId: prompt.branchId,
      triggerCondition: prompt.triggerCondition,
      triggerValue: prompt.triggerValue,
      promptText: prompt.promptText,
      isActive: prompt.isActive,
    });
    setEditingPrompt(prompt);
    setIsCreateModalOpen(true);
  }, []);

  const handleSelectTemplate = useCallback((template: PromptTemplate) => {
    setFormData({
      triggerCondition: template.triggerCondition,
      triggerValue: template.triggerValue,
      promptText: template.promptText,
      isActive: true,
    });
    setIsTemplateModalOpen(false);
    setIsCreateModalOpen(true);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!formData.triggerValue || !formData.promptText) return;
    
    setIsSubmitting(true);
    try {
      if (editingPrompt) {
        await updatePrompt({
          promptId: editingPrompt.promptId,
          triggerCondition: formData.triggerCondition,
          triggerValue: formData.triggerValue,
          promptText: formData.promptText,
          isActive: formData.isActive,
        });
      } else {
        await createPrompt({
          restaurantId,
          branchId: formData.branchId,
          triggerCondition: formData.triggerCondition,
          triggerValue: formData.triggerValue,
          promptText: formData.promptText,
          isActive: formData.isActive,
        });
      }
      setIsCreateModalOpen(false);
      setEditingPrompt(null);
      setFormData(DEFAULT_FORM_DATA);
    } catch (error) {
      console.error('Failed to save prompt:', error);
    } finally {
      setIsSubmitting(false);
    }
  }, [formData, editingPrompt, restaurantId, createPrompt, updatePrompt]);


  const handleToggle = useCallback(async (prompt: Prompt) => {
    setTogglingPromptId(prompt.promptId);
    try {
      if (prompt.isActive) {
        await deactivatePrompt({ promptId: prompt.promptId });
      } else {
        await activatePrompt({ promptId: prompt.promptId });
      }
    } catch (error) {
      console.error('Failed to toggle prompt:', error);
    } finally {
      setTogglingPromptId(null);
    }
  }, [activatePrompt, deactivatePrompt]);

  const handleDelete = useCallback(async () => {
    if (!deletingPrompt) return;
    
    try {
      await deletePromptMutation({ promptId: deletingPrompt.promptId });
      setDeletingPrompt(null);
    } catch (error) {
      console.error('Failed to delete prompt:', error);
    }
  }, [deletingPrompt, deletePromptMutation]);

  const handleCloseModal = useCallback(() => {
    setIsCreateModalOpen(false);
    setEditingPrompt(null);
    setFormData(DEFAULT_FORM_DATA);
  }, []);

  // Stats
  const stats = useMemo(() => {
    if (!prompts) return { total: 0, active: 0, inactive: 0 };
    return {
      total: prompts.length,
      active: prompts.filter((p: Prompt) => p.isActive).length,
      inactive: prompts.filter((p: Prompt) => !p.isActive).length,
    };
  }, [prompts]);

  // Loading state
  if (prompts === undefined) {
    return (
      <div className={cn("space-y-6", className)}>
        <div className="flex items-center justify-center py-16">
          <div className="flex flex-col items-center space-y-4">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-white/20 border-t-emerald-500" />
            <p className="text-white/60 text-sm">Loading prompts...</p>
          </div>
        </div>
      </div>
    );
  }


  return (
    <div className={cn("space-y-6", className)}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <MessageSquare className="h-6 w-6 text-emerald-400" />
            <h1 className="text-2xl font-semibold text-white">Upsell Prompts</h1>
          </div>
          <p className="text-white/60 text-minimal mt-1">
            Configure AI agent prompts to increase average order value
          </p>
        </div>
        
        <div className="flex items-center gap-2">
          <Button
            onClick={() => setIsTemplateModalOpen(true)}
            className="btn btn-outline btn-md"
          >
            <Sparkles size={16} className="mr-2" />
            Templates
          </Button>
          <Button
            onClick={handleOpenCreate}
            className="btn btn-primary btn-md"
          >
            <Plus size={16} className="mr-2" />
            Create Prompt
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="card-minimal rounded-lg p-4">
          <p className="text-xs text-white/40 text-minimal mb-1">Total Prompts</p>
          <p className="text-2xl font-semibold text-white">{stats.total}</p>
        </div>
        <div className="card-minimal rounded-lg p-4">
          <p className="text-xs text-white/40 text-minimal mb-1">Active</p>
          <p className="text-2xl font-semibold text-emerald-400">{stats.active}</p>
        </div>
        <div className="card-minimal rounded-lg p-4">
          <p className="text-xs text-white/40 text-minimal mb-1">Inactive</p>
          <p className="text-2xl font-semibold text-white/60">{stats.inactive}</p>
        </div>
      </div>


      {/* Filters */}
      <div className="card-minimal rounded-lg p-4">
        <div className="flex flex-col sm:flex-row gap-4">
          {/* Search */}
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search prompts..."
              className="input-dark w-full pl-10 rounded-lg"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white"
              >
                <X size={16} />
              </button>
            )}
          </div>
          
          {/* Condition Filter */}
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" />
            <select
              value={filterCondition}
              onChange={(e) => setFilterCondition(e.target.value as TriggerCondition | 'all')}
              className="input-dark pl-10 pr-8 rounded-lg appearance-none cursor-pointer min-w-[180px]"
            >
              <option value="all">All Conditions</option>
              {TRIGGER_CONDITIONS.map((tc) => (
                <option key={tc.value} value={tc.value}>{tc.label}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40 pointer-events-none" />
          </div>
          
          {/* Status Filter */}
          <div className="flex rounded-lg bg-white/5 p-1">
            {(['all', 'active', 'inactive'] as const).map((status) => (
              <button
                key={status}
                onClick={() => setFilterStatus(status)}
                className={cn(
                  "px-3 py-1.5 rounded-md text-sm capitalize transition-colors",
                  filterStatus === status
                    ? "bg-emerald-500/20 text-emerald-400"
                    : "text-white/60 hover:text-white/80"
                )}
              >
                {status}
              </button>
            ))}
          </div>
        </div>
      </div>


      {/* Prompts List */}
      <div className="space-y-3">
        {filteredPrompts.length === 0 ? (
          prompts.length === 0 ? (
            <EmptyState onCreateClick={handleOpenCreate} />
          ) : (
            <div className="text-center py-12">
              <Search className="h-12 w-12 text-white/20 mx-auto mb-4" />
              <p className="text-white/60">No prompts match your filters</p>
              <button
                onClick={() => {
                  setSearchQuery('');
                  setFilterCondition('all');
                  setFilterStatus('all');
                }}
                className="text-emerald-400 text-sm mt-2 hover:underline"
              >
                Clear filters
              </button>
            </div>
          )
        ) : (
          filteredPrompts.map((prompt: Prompt) => (
            <PromptCard
              key={prompt._id}
              prompt={prompt as Prompt}
              branchName={prompt.branchId ? branchNameMap[prompt.branchId] : undefined}
              onEdit={() => handleOpenEdit(prompt as Prompt)}
              onToggle={() => handleToggle(prompt as Prompt)}
              onDelete={() => setDeletingPrompt(prompt as Prompt)}
              isToggling={togglingPromptId === prompt.promptId}
            />
          ))
        )}
      </div>

      {/* Create/Edit Modal */}
      <Modal
        isOpen={isCreateModalOpen}
        onClose={handleCloseModal}
        title={editingPrompt ? 'Edit Prompt' : 'Create New Prompt'}
        description={editingPrompt 
          ? 'Update the prompt configuration below'
          : 'Configure a new upsell prompt for your AI agent'
        }
        size="lg"
      >
        <PromptForm
          formData={formData}
          onChange={handleFormChange}
          onSubmit={handleSubmit}
          onCancel={handleCloseModal}
          isSubmitting={isSubmitting}
          isEdit={!!editingPrompt}
          branches={branches}
        />
      </Modal>


      {/* Templates Modal */}
      <Modal
        isOpen={isTemplateModalOpen}
        onClose={() => setIsTemplateModalOpen(false)}
        title="Prompt Templates"
        description="Choose a pre-built template to get started quickly"
        size="lg"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[60vh] overflow-y-auto pr-2">
          {PROMPT_TEMPLATES.map((template) => (
            <TemplateCard
              key={template.id}
              template={template}
              onSelect={handleSelectTemplate}
            />
          ))}
        </div>
      </Modal>

      {/* Delete Confirmation Modal */}
      <ConfirmationModal
        isOpen={!!deletingPrompt}
        onClose={() => setDeletingPrompt(null)}
        onConfirm={handleDelete}
        title="Delete Prompt"
        message={`Are you sure you want to delete this prompt? This action cannot be undone.`}
        confirmText="Delete"
        cancelText="Cancel"
        variant="danger"
      />
    </div>
  );
}

export default PromptManagement;
