/**
 * Type definitions for self-serve signup flow
 * Requirements: 26.1, 26.2
 */

/**
 * Account creation data (Step 1)
 */
export interface AccountData {
  email: string;
  password: string;
  confirmPassword: string;
}

/**
 * Business information data (Step 2)
 */
export interface BusinessData {
  restaurantName: string;
  ownerName: string;
  address: string;
  phoneNumber: string;
  city: string;
  state: string;
}

/**
 * Verification document types
 */
export type DocumentType = 'business_registration' | 'owner_id' | 'tax_certificate';

/**
 * Verification document data
 */
export interface VerificationDocument {
  type: DocumentType;
  fileName: string;
  fileUrl: string;
  uploadedAt: number;
}

/**
 * Document upload data (Step 3)
 */
export interface DocumentData {
  businessRegistration?: VerificationDocument;
  ownerId?: VerificationDocument;
  taxCertificate?: VerificationDocument;
}

/**
 * Complete signup form data
 */
export interface SignupFormData {
  account: AccountData;
  business: BusinessData;
  documents: DocumentData;
}

/**
 * Signup status
 */
export type SignupStatus = 
  | 'pending'           // Initial state
  | 'email_verified'    // Email has been verified
  | 'documents_pending' // Waiting for document verification
  | 'documents_verified'// Documents have been verified
  | 'active'            // Account is fully active
  | 'suspended';        // Account has been suspended

/**
 * Signup result from the backend
 */
export interface SignupResult {
  success: boolean;
  userId?: string;
  restaurantId?: string;
  error?: string;
}

/**
 * Document submission result
 */
export interface DocumentSubmissionResult {
  success: boolean;
  documentId?: string;
  error?: string;
}

/**
 * Signup status response
 */
export interface SignupStatusResponse {
  status: SignupStatus;
  userId?: string;
  restaurantId?: string;
  email?: string;
  documentsSubmitted: boolean;
  documentsVerified: boolean;
  createdAt?: number;
}

/**
 * Form validation errors
 */
export interface SignupFormErrors {
  // Account errors
  email?: string;
  password?: string;
  confirmPassword?: string;
  // Business errors
  restaurantName?: string;
  ownerName?: string;
  address?: string;
  phoneNumber?: string;
  city?: string;
  state?: string;
  // Document errors
  businessRegistration?: string;
  ownerId?: string;
  general?: string;
}

/**
 * Signup step configuration
 */
export interface SignupStep {
  id: string;
  title: string;
  description: string;
}

/**
 * Nigerian states for address selection
 */
export const NIGERIAN_STATES = [
  'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue',
  'Borno', 'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu',
  'FCT', 'Gombe', 'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi',
  'Kogi', 'Kwara', 'Lagos', 'Nasarawa', 'Niger', 'Ogun', 'Ondo', 'Osun',
  'Oyo', 'Plateau', 'Rivers', 'Sokoto', 'Taraba', 'Yobe', 'Zamfara'
] as const;

export type NigerianState = typeof NIGERIAN_STATES[number];
